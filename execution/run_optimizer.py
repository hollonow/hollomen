#!/usr/bin/env python3
"""
AGENT 4 ORCHESTRATOR: The Optimizer
Main entry point for media optimization - viewpoint classification, WebP compression, SEO renaming.

Features:
- GPT-4o Vision viewpoint classification (Front, Side, Back, Sole, etc.)
- WebP compression via Pillow (target <100KB, 1000px wide)
- SEO-rich filenames: {slug}-{viewpoint}.webp
- Original JPG deletion + WebP re-upload to same Drive folder
- Rate limiting for batch processing
- Manual override protection
- Automatic retry with exponential backoff
"""

import argparse
import json
import logging
import os
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional

from dotenv import load_dotenv

from supabase_manager import SupabaseManager
from optimizers.media_optimizer import MediaOptimizer, OptimizationResult
from retry_handler import (
    RetryStats, RetryableOperation, ErrorCategory
)
sys.path.insert(0, str(Path(__file__).parent))
from notifiers.notifier import notify_agent_complete, notify_error, notify_agent_start

# Configure logging
log_dir = Path(__file__).parent.parent / 'logs'
log_dir.mkdir(exist_ok=True)

# Pipeline config (set from dashboard Settings page)
def _load_pipeline_config() -> dict:
    cfg_path = Path(__file__).parent.parent / 'config' / 'pipeline_config.json'
    try:
        with open(cfg_path) as f:
            return json.load(f)
    except Exception:
        return {}

_PIPELINE_CFG = _load_pipeline_config()
BATCH_SIZE = int(_PIPELINE_CFG.get('batch_size', 20))

logging.basicConfig(
    level=logging.INFO,
    format='[AGENT_4] [%(asctime)s] [%(levelname)s] %(message)s',
    handlers=[
        logging.StreamHandler(sys.stderr),
        logging.FileHandler(log_dir / f'optimizer_{Path(__file__).stem}.log')
    ]
)
logger = logging.getLogger(__name__)


@dataclass
class BatchStats:
    """Statistics for batch processing summary."""
    total: int = 0
    success: int = 0
    failed: int = 0
    skipped_override: int = 0
    skipped_already_optimized: int = 0
    images_processed: int = 0
    images_compressed: int = 0
    total_bytes_saved: int = 0
    start_time: datetime = None
    end_time: datetime = None
    # Retry statistics
    retry_stats: RetryStats = None
    transient_failures: int = 0
    permanent_failures: int = 0

    def __post_init__(self):
        if self.start_time is None:
            self.start_time = datetime.now()
        if self.retry_stats is None:
            self.retry_stats = RetryStats()


class OptimizerOrchestrator:
    """Orchestrates the media optimization process."""

    # Status constants
    TARGET_STATUS   = 'READY_FOR_PUBLISH'
    CLAIMING_STATUS = 'OPTIMIZING'
    SUCCESS_STATUS  = 'PUBLISHED'
    FAILURE_STATUS  = 'OPTIMIZE_FAILED'

    def __init__(self):
        """Initialize orchestrator with credentials from environment."""
        load_dotenv()

        # Project root for resolving relative paths
        project_root = Path(__file__).parent.parent

        # Required environment variables
        self.openai_api_key = os.getenv('OPENAI_API_KEY')

        # Cloudinary credentials (primary storage)
        self.cloudinary_cloud_name = os.getenv('CLOUDINARY_CLOUD_NAME')
        self.cloudinary_api_key = os.getenv('CLOUDINARY_API_KEY')
        self.cloudinary_api_secret = os.getenv('CLOUDINARY_API_SECRET')

        # Rate limiting config
        self.api_delay_ms = int(os.getenv('OPTIMIZER_DELAY_MS', '1000'))

        # Retry configuration
        self.max_retries = int(os.getenv('MAX_RETRIES', '3'))
        self.retry_base_delay = float(os.getenv('RETRY_BASE_DELAY', '1.0'))

        # Validate config
        self._validate_config()

        # Initialize components
        self.sheets = SupabaseManager()
        self.optimizer = MediaOptimizer(
            openai_api_key=self.openai_api_key,
            cloudinary_cloud_name=self.cloudinary_cloud_name,
            cloudinary_api_key=self.cloudinary_api_key,
            cloudinary_api_secret=self.cloudinary_api_secret
        )

        logger.info("Optimizer Orchestrator initialized")
        logger.info(f"Rate limiting: {self.api_delay_ms}ms between products")
        logger.info(f"Retry config: max_retries={self.max_retries}, base_delay={self.retry_base_delay}s")

    def _resolve_path(self, path_str: str, project_root: Path) -> str:
        """Resolve path relative to project root if not absolute."""
        path = Path(path_str)
        if path.is_absolute():
            return str(path)
        return str(project_root / path)

    def _validate_config(self) -> None:
        """Validate all required environment variables are set."""
        missing = []

        if not self.openai_api_key:
            missing.append('OPENAI_API_KEY')

        if not (self.cloudinary_cloud_name and self.cloudinary_api_key and self.cloudinary_api_secret):
            missing.append('Cloudinary credentials: CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET')

        if missing:
            logger.error(f"Missing required configuration: {', '.join(missing)}")
            logger.error("Please check your .env file")
            sys.exit(1)

        logger.info(f"Image storage: Cloudinary (cloud: {self.cloudinary_cloud_name})")

    def process_row(self, row_data: dict, stats: BatchStats) -> bool:
        """
        Process a single row through the media optimization pipeline.

        Args:
            row_data: Row data from sheet
            stats: Batch statistics to update

        Returns:
            True if successful, False otherwise
        """
        product_id = row_data.get('product_id')
        row_number = row_data.get('_row_number')

        logger.info(f"{'='*60}")
        logger.info(f"Processing: {product_id}")
        logger.info(f"Product: {row_data.get('final_product_name', 'Unknown')[:50]}...")
        logger.info(f"SEO Slug: {row_data.get('seo_slug', 'N/A')}")
        logger.info(f"{'='*60}")

        # Process with retry
        with RetryableOperation(
            stats.retry_stats,
            operation_name=f"optimize {product_id}",
            max_retries=self.max_retries,
            base_delay=self.retry_base_delay
        ) as op:
            result = op.execute(lambda: self.optimizer.process_product(row_data))

        if result.success and result.result.status == "PUBLISHED":
            opt_result: OptimizationResult = result.result

            # Update sheet with optimization data
            update_data = {
                'Product_ID': product_id,
                'Status': self.SUCCESS_STATUS,
                'Main_Image_File_ID': opt_result.new_main_image_id,
                'Optimized_At': opt_result.optimized_at,
                'WebP_Image_Count': opt_result.webp_image_count,
                'Viewpoint_Labels': opt_result.viewpoint_labels,
                'Notes': opt_result.notes
            }

            self.sheets.update_row(product_id, update_data)

            # Track statistics
            stats.images_processed += opt_result.images_processed
            stats.images_compressed += opt_result.images_compressed
            stats.total_bytes_saved += (
                opt_result.total_original_bytes - opt_result.total_compressed_bytes
            )

            if opt_result.images_compressed == 0 and opt_result.images_processed > 0:
                stats.skipped_already_optimized += 1

            logger.info(f"✅ Successfully optimized {product_id}")
            logger.info(f"   WebP images: {opt_result.webp_image_count}")
            logger.info(f"   Compression: {opt_result.compression_ratio:.0%}")
            return True

        else:
            # Failed
            error_msg = ""
            if result.result:
                error_msg = result.result.notes
            elif result.error_message:
                error_msg = result.error_message

            if result.error_category == ErrorCategory.TRANSIENT:
                stats.transient_failures += 1
            else:
                stats.permanent_failures += 1

            logger.error(f"❌ Failed to optimize {product_id}")
            self.sheets.update_status(
                product_id,
                self.FAILURE_STATUS,
                error_msg[:200]
            )
            return False

    def _print_batch_summary(self, stats: BatchStats) -> None:
        """Print detailed batch processing summary."""
        stats.end_time = datetime.now()
        duration = stats.end_time - stats.start_time

        logger.info(f"\n{'='*60}")
        logger.info(f"BATCH PROCESSING COMPLETE")
        logger.info(f"{'='*60}")
        logger.info(f"Duration: {duration}")
        logger.info(f"")
        logger.info(f"RESULTS:")
        logger.info(f"  ✅ Published: {stats.success}")
        logger.info(f"  ❌ Failed: {stats.failed}")
        logger.info(f"  ⏭️  Skipped (Manual Override): {stats.skipped_override}")
        logger.info(f"  🔄 Skipped (Already Optimized): {stats.skipped_already_optimized}")
        logger.info(f"  📊 Total Processed: {stats.total}")
        logger.info(f"")
        logger.info(f"MEDIA OPTIMIZATION:")
        logger.info(f"  🖼️  Images Processed: {stats.images_processed}")
        logger.info(f"  📦 Images Compressed: {stats.images_compressed}")
        logger.info(f"  💾 Total Bytes Saved: {stats.total_bytes_saved / 1024:.0f} KB")
        logger.info(f"")

        # Retry statistics
        rs = stats.retry_stats
        if rs.total_retries > 0:
            logger.info(f"RETRY STATISTICS:")
            logger.info(f"  🔁 Total Retries: {rs.total_retries}")
            logger.info(f"  ✅ Recovered After Retry: {rs.successful_after_retry}")
            logger.info(f"  ❌ Failed After Retry: {rs.failed_after_retry}")
            logger.info(f"")

        # Error breakdown
        if stats.transient_failures > 0 or stats.permanent_failures > 0:
            logger.info(f"ERROR BREAKDOWN:")
            logger.info(f"  ⚡ Transient Errors: {stats.transient_failures}")
            logger.info(f"  🚫 Permanent Errors: {stats.permanent_failures}")
            logger.info(f"")

        success_rate = (stats.success / stats.total * 100) if stats.total > 0 else 0
        logger.info(f"SUCCESS RATE: {success_rate:.1f}%")
        logger.info(f"{'='*60}")

    def run(self, product_id: Optional[str] = None) -> None:
        """
        Main execution loop.
        Finds all READY_FOR_PUBLISH rows and processes them.
        """
        logger.info("Starting Optimizer Agent (The Optimizer)...")

        # Initialize batch statistics
        stats = BatchStats()

        # Get rows ready for optimization (capped at 20 per run — gallery batching)
        pending_rows = self.sheets.get_rows_by_status(
            self.TARGET_STATUS,
            respect_override=True,
            limit=20
        )

        # Filter to single product if --product-id supplied
        if product_id:
            pending_rows = [r for r in pending_rows if r.get('product_id') == product_id]
            if not pending_rows:
                logger.info(f"Product {product_id} not found or not in {self.TARGET_STATUS} status")
                return

        if not pending_rows:
            logger.info(f"No {self.TARGET_STATUS} rows found - nothing to process")
            return

        stats.total = len(pending_rows)
        logger.info(f"Found {stats.total} rows to process")
        notify_agent_start('Agent 4 — Optimizer', stats.total)

        session_id = None
        try:
            session_id = self.sheets.create_run_session('agent4', batch_limit=BATCH_SIZE)
            self.sheets.log_event(session_id, f"Found {stats.total} rows to process", agent='agent4')
        except Exception:
            pass

        # Process each row
        for idx, row in enumerate(pending_rows, 1):
            logger.info(f"\n[{idx}/{stats.total}] Processing row...")

            try:
                # Atomically claim this row before doing any file/API work.
                # If another optimizer instance already claimed it, skip cleanly.
                pid = row.get('product_id', '')
                if not self.sheets.try_claim_row(pid, self.TARGET_STATUS, self.CLAIMING_STATUS):
                    stats.total -= 1
                    continue

                if self.process_row(row, stats):
                    stats.success += 1
                    if session_id:
                        self.sheets.log_event(session_id, f"✅ Successfully processed {pid}", agent='agent4', product_id=pid)
                else:
                    stats.failed += 1
                    if session_id:
                        self.sheets.log_event(session_id, f"❌ Failed to process {pid}", agent='agent4', product_id=pid, level='ERROR')
            except Exception as e:
                logger.error(f"Unexpected error processing row: {e}")
                stats.failed += 1
                try:
                    pid = row.get('product_id', '')
                    if pid:
                        self.sheets.update_status(pid, self.FAILURE_STATUS, str(e)[:200])
                    if session_id:
                        self.sheets.log_event(session_id, f"❌ Error processing {pid}: {str(e)[:200]}", agent='agent4', product_id=pid, level='ERROR')
                except Exception:
                    pass

            # Rate limiting
            if idx < stats.total and self.api_delay_ms > 0:
                delay_sec = self.api_delay_ms / 1000
                logger.info(f"Rate limiting: waiting {delay_sec}s...")
                time.sleep(delay_sec)

            # Graceful stop — checked after each item so current product always completes
            if session_id and self.sheets.check_stop_requested(session_id):
                logger.info("Stop requested — finishing after this item.")
                break

        # Print batch summary
        self._print_batch_summary(stats)
        notify_agent_complete('Agent 4 — Optimizer', stats.success, stats.failed)

        if session_id:
            self.sheets.log_event(session_id, f"  ✅ Successful (PUBLISHED): {stats.success}", agent='agent4')
            self.sheets.log_event(session_id, f"  ❌ Failed (OPTIMIZE_FAILED): {stats.failed}", agent='agent4')
            self.sheets.log_event(session_id, "BATCH PROCESSING COMPLETE", agent='agent4')

        if session_id:
            try:
                self.sheets.complete_run_session(
                    session_id, succeeded=stats.success,
                    failed=stats.failed, attempted=stats.total,
                    tokens=self.optimizer._run_tokens,
                    cost_usd=self.optimizer._run_cost,
                )
            except Exception:
                pass


def main():
    """Entry point for Agent 4."""
    parser = argparse.ArgumentParser(description='Agent 4 — The Optimizer')
    parser.add_argument('--product-id', type=str, default=None, help='Run for a single product only')
    args = parser.parse_args()
    try:
        orchestrator = OptimizerOrchestrator()
        orchestrator.run(product_id=args.product_id)
    except KeyboardInterrupt:
        logger.info("\nOptimization interrupted by user")
        sys.exit(0)
    except Exception as e:
        logger.error(f"Fatal error: {e}", exc_info=True)
        notify_error('Agent 4 — Optimizer', str(e))
        sys.exit(1)


if __name__ == "__main__":
    main()
