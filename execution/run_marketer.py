#!/usr/bin/env python3
"""
AGENT 3 ORCHESTRATOR: The Voice
Main entry point for SEO content generation and CMS preparation.

Features:
- GPT-4o content generation (titles, descriptions, FAQs)
- Valid JSON-LD schema generation (Product + FAQPage)
- SEO-optimized image renaming on Google Drive
- Price extraction from Chinese supplier text
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
from marketers.product_marketer import ProductMarketer, MarketingResult
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
    format='[AGENT_3] [%(asctime)s] [%(levelname)s] %(message)s',
    handlers=[
        logging.StreamHandler(sys.stderr),
        logging.FileHandler(log_dir / f'marketer_{Path(__file__).stem}.log')
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
    images_renamed: int = 0
    prices_extracted: int = 0
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


class MarketerOrchestrator:
    """Orchestrates the SEO content generation process."""

    # Status constants
    TARGET_STATUS   = 'READY_FOR_SEO'
    CLAIMING_STATUS = 'WRITING_SEO'
    SUCCESS_STATUS  = 'READY_FOR_PUBLISH'
    FAILURE_STATUS  = 'SEO_FAILED'

    def __init__(self):
        """Initialize orchestrator with credentials from environment."""
        load_dotenv()

        # Required environment variables
        self.openai_api_key = os.getenv('OPENAI_API_KEY')

        # Cloudinary config
        self.cloudinary_cloud_name = os.getenv('CLOUDINARY_CLOUD_NAME', '')
        self.cloudinary_api_key = os.getenv('CLOUDINARY_API_KEY', '')
        self.cloudinary_api_secret = os.getenv('CLOUDINARY_API_SECRET', '')

        # Rate limiting config
        self.api_delay_ms = int(os.getenv('MARKETER_DELAY_MS', '1000'))

        # Retry configuration
        self.max_retries = int(os.getenv('MAX_RETRIES', '3'))
        self.retry_base_delay = float(os.getenv('RETRY_BASE_DELAY', '1.0'))

        # Validate config
        self._validate_config()

        # Initialize components
        self.sheets = SupabaseManager()
        self.marketer = ProductMarketer(
            openai_api_key=self.openai_api_key,
            cloudinary_cloud_name=self.cloudinary_cloud_name,
            cloudinary_api_key=self.cloudinary_api_key,
            cloudinary_api_secret=self.cloudinary_api_secret,
        )

        logger.info("Marketer Orchestrator initialized")
        logger.info(f"Rate limiting: {self.api_delay_ms}ms between products")
        logger.info(f"Retry config: max_retries={self.max_retries}, base_delay={self.retry_base_delay}s")

    def _validate_config(self) -> None:
        """Validate all required environment variables are set."""
        missing = []

        if not self.openai_api_key:
            missing.append('OPENAI_API_KEY')

        if missing:
            logger.error(f"Missing required configuration: {', '.join(missing)}")
            logger.error("Please check your .env file")
            sys.exit(1)

    def process_row(self, row_data: dict, stats: BatchStats) -> bool:
        """
        Process a single row through the marketing pipeline.

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
        logger.info(f"{'='*60}")

        # Process with retry
        with RetryableOperation(
            stats.retry_stats,
            operation_name=f"market {product_id}",
            max_retries=self.max_retries,
            base_delay=self.retry_base_delay
        ) as op:
            result = op.execute(lambda: self.marketer.process_product(row_data))

        if result.success and result.result.status == "COMPLETE":
            marketing_result: MarketingResult = result.result

            # Update sheet with all marketing data
            update_data = {
                'Product_ID': product_id,
                'Status': self.SUCCESS_STATUS,
                'SEO_Slug': marketing_result.seo_slug,
                'CMS_Title': marketing_result.cms_title,
                'CMS_Body_HTML': marketing_result.cms_body_html,
                'Meta_Description': marketing_result.meta_description,
                'FAQ_JSON_LD': marketing_result.faq_json_ld,
                'Product_JSON_LD': marketing_result.product_json_ld,
                'Extracted_Price': marketing_result.extracted_price,
                'Notes': marketing_result.notes
            }

            # Write enhanced Product_Description if generated
            if marketing_result.enhanced_product_description:
                update_data['Product_Description'] = marketing_result.enhanced_product_description

            self.sheets.update_row(row_number, update_data)

            # Track statistics
            stats.images_renamed += marketing_result.images_renamed
            if marketing_result.extracted_price != "0.00":
                stats.prices_extracted += 1

            logger.info(f"✅ Successfully processed {product_id}")
            logger.info(f"   SEO Slug: {marketing_result.seo_slug}")
            logger.info(f"   Images renamed: {marketing_result.images_renamed}")
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

            logger.error(f"❌ Failed to process {product_id}")
            self.sheets.update_status(
                row_number,
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
        logger.info(f"  ✅ Complete: {stats.success}")
        logger.info(f"  ❌ Failed: {stats.failed}")
        logger.info(f"  ⏭️  Skipped (Manual Override): {stats.skipped_override}")
        logger.info(f"  📊 Total Processed: {stats.total}")
        logger.info(f"")
        logger.info(f"CONTENT GENERATED:")
        logger.info(f"  🖼️  Images Renamed: {stats.images_renamed}")
        logger.info(f"  💰 Prices Extracted: {stats.prices_extracted}")
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
        Finds all READY_FOR_SEO rows and processes them.
        """
        logger.info("Starting Marketer Agent (The Voice)...")

        # Initialize batch statistics
        stats = BatchStats()

        # Get rows ready for SEO processing, capped at 20 per run (gallery batching)
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
        notify_agent_start('Agent 3 — Voice', stats.total)

        session_id = None
        try:
            session_id = self.sheets.create_run_session('agent3', batch_limit=BATCH_SIZE)
            self.sheets.log_event(session_id, f"Found {stats.total} rows to process", agent='agent3')
        except Exception:
            pass

        # Process each row
        for idx, row in enumerate(pending_rows, 1):
            logger.info(f"\n[{idx}/{stats.total}] Processing row...")

            try:
                # Atomically claim before any OpenAI/write work
                pid = row.get('product_id', '')
                if not self.sheets.try_claim_row(pid, self.TARGET_STATUS, self.CLAIMING_STATUS):
                    stats.total -= 1
                    continue

                if self.process_row(row, stats):
                    stats.success += 1
                    if session_id:
                        self.sheets.log_event(session_id, f"✅ Successfully processed {pid}", agent='agent3', product_id=pid)
                else:
                    stats.failed += 1
                    if session_id:
                        self.sheets.log_event(session_id, f"❌ Failed to process {pid}", agent='agent3', product_id=pid, level='ERROR')
            except Exception as e:
                logger.error(f"Unexpected error processing row: {e}")
                stats.failed += 1
                try:
                    pid = row.get('product_id', '')
                    if pid:
                        self.sheets.update_status(pid, self.FAILURE_STATUS, str(e)[:200])
                    if session_id:
                        self.sheets.log_event(session_id, f"❌ Error processing {pid}: {str(e)[:200]}", agent='agent3', product_id=pid, level='ERROR')
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
        notify_agent_complete('Agent 3 — Voice', stats.success, stats.failed)

        if session_id:
            self.sheets.log_event(session_id, f"  ✅ Successful (READY_FOR_PUBLISH): {stats.success}", agent='agent3')
            self.sheets.log_event(session_id, f"  ❌ Failed (SEO_FAILED): {stats.failed}", agent='agent3')
            self.sheets.log_event(session_id, "BATCH PROCESSING COMPLETE", agent='agent3')

        if session_id:
            try:
                self.sheets.complete_run_session(
                    session_id, succeeded=stats.success,
                    failed=stats.failed, attempted=stats.total,
                    tokens=self.marketer._run_tokens,
                    cost_usd=self.marketer._run_cost,
                )
            except Exception:
                pass


def main():
    """Entry point for Agent 3."""
    parser = argparse.ArgumentParser(description='Agent 3 — The Voice')
    parser.add_argument('--product-id', type=str, default=None, help='Run for a single product only')
    args = parser.parse_args()
    try:
        orchestrator = MarketerOrchestrator()
        orchestrator.run(product_id=args.product_id)
    except KeyboardInterrupt:
        logger.info("\nMarketing interrupted by user")
        sys.exit(0)
    except Exception as e:
        logger.error(f"Fatal error: {e}", exc_info=True)
        notify_error('Agent 3 — Voice', str(e))
        sys.exit(1)


if __name__ == "__main__":
    main()
