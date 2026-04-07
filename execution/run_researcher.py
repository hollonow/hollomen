#!/usr/bin/env python3
"""
AGENT 2 ORCHESTRATOR: The Architect
Main entry point for visual product identification and research.

Features:
- Visual search with SerpApi Google Lens
- GPT-4o Vision synthesis with Truth Grounding
- Domain reputation scoring for source credibility
- Rate limiting for batch processing
- NEEDS_REVIEW status for low-confidence products
- Manual override protection
- Automatic retry with exponential backoff
- Error categorization (transient vs permanent)
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
from typing import Any, Dict, List, Optional

from dotenv import load_dotenv

from supabase_manager import SupabaseManager
from researchers.base_researcher import BaseResearcher, ResearchResult
from retry_handler import (
    RetryStats, RetryableOperation, ErrorCategory,
    categorize_error, format_error_for_notes
)
sys.path.insert(0, str(Path(__file__).parent))
from notifiers.slack_notifier import notify_agent_complete, notify_error, notify_agent_start

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
CONFIDENCE_THRESHOLD = float(_PIPELINE_CFG.get('confidence_threshold', 0.30))

logging.basicConfig(
    level=logging.INFO,
    format='[AGENT_2] [%(asctime)s] [%(levelname)s] %(message)s',
    handlers=[
        logging.StreamHandler(sys.stderr),
        logging.FileHandler(log_dir / f'researcher_{Path(__file__).stem}.log')
    ]
)
logger = logging.getLogger(__name__)


@dataclass
class BatchStats:
    """Statistics for batch processing summary."""
    total: int = 0
    success: int = 0
    failed: int = 0
    needs_review: int = 0
    skipped_override: int = 0
    brands_found: Dict[str, int] = None
    avg_confidence: float = 0.0
    start_time: datetime = None
    end_time: datetime = None
    # Retry statistics
    retry_stats: RetryStats = None
    transient_failures: int = 0
    permanent_failures: int = 0

    def __post_init__(self):
        if self.brands_found is None:
            self.brands_found = {}
        if self.start_time is None:
            self.start_time = datetime.now()
        if self.retry_stats is None:
            self.retry_stats = RetryStats()


class ProductResearcher(BaseResearcher):
    """Concrete implementation of product researcher."""

    def get_fallback_brand(self) -> str:
        """Return the configured in-house brand as the fallback for unconfirmed products."""
        return self.attribute_matrix.get('brand_name', 'Hollostyle')


class ResearcherOrchestrator:
    """Orchestrates the research process for product identification."""

    # Status constants
    TARGET_STATUS   = 'READY_FOR_RESEARCH'
    CLAIMING_STATUS = 'RESEARCHING'
    SUCCESS_STATUS  = 'READY_FOR_SEO'
    FAILURE_STATUS  = 'RESEARCH_FAILED'
    REVIEW_STATUS   = 'NEEDS_REVIEW'  # For low-confidence products

    # Confidence thresholds (read from pipeline_config.json via dashboard Settings)
    MIN_CONFIDENCE_FOR_SEO = CONFIDENCE_THRESHOLD
    MIN_REPUTATION_FOR_SEO = CONFIDENCE_THRESHOLD

    def __init__(self):
        """Initialize orchestrator with credentials from environment."""
        load_dotenv()

        # Project root for resolving relative paths
        project_root = Path(__file__).parent.parent

        # Required environment variables
        self.openai_api_key = os.getenv('OPENAI_API_KEY')
        self.serpapi_key = os.getenv('SERPAPI_KEY')

        # Attribute matrix path
        self.attribute_matrix_path = self._resolve_path(
            'config/attribute_matrix.json',
            project_root
        )

        # Rate limiting config (milliseconds between API calls)
        self.api_delay_ms = int(os.getenv('SERPAPI_DELAY_MS', '1000'))

        # Retry configuration
        self.max_retries = int(os.getenv('MAX_RETRIES', '3'))
        self.retry_base_delay = float(os.getenv('RETRY_BASE_DELAY', '1.0'))

        # Validate required config
        self._validate_config()

        # Initialize managers
        self.sheets = SupabaseManager()
        self.researcher = ProductResearcher(
            openai_api_key=self.openai_api_key,
            serpapi_key=self.serpapi_key,
            attribute_matrix_path=self.attribute_matrix_path
        )

        logger.info("Researcher Orchestrator initialized")
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
        if not self.serpapi_key:
            missing.append('SERPAPI_KEY')
        if not Path(self.attribute_matrix_path).exists():
            missing.append(f'Attribute matrix not found: {self.attribute_matrix_path}')

        if missing:
            logger.error(f"Missing required configuration: {', '.join(missing)}")
            logger.error("Please check your .env file")
            sys.exit(1)

        logger.info("Configuration validated successfully")
        logger.info(f"SerpApi: Configured")
        logger.info(f"OpenAI: Configured")

    def _determine_final_status(self, result: ResearchResult) -> str:
        """
        Determine final status based on confidence metrics.
        Routes low-confidence products to NEEDS_REVIEW queue.
        """
        # Parse attributes to check confidence
        try:
            attributes = json.loads(result.attribute_json) if result.attribute_json else {}
        except json.JSONDecodeError:
            attributes = {}

        brand_confidence = attributes.get('brand_confidence', 'UNCONFIRMED')
        confidence_score = result.avg_source_reputation

        # Check if product needs human review
        needs_review = False
        review_reasons = []

        # Rule 1: Very low source reputation
        if confidence_score < self.MIN_REPUTATION_FOR_SEO:
            needs_review = True
            review_reasons.append(f"Low source reputation ({confidence_score:.2f})")

        # Rule 2: Unconfirmed brand with low reputation
        if brand_confidence == 'UNCONFIRMED' and confidence_score < 0.5:
            needs_review = True
            review_reasons.append("Unconfirmed brand with low confidence")

        if needs_review:
            logger.warning(f"[REVIEW QUEUE] Product flagged for review: {', '.join(review_reasons)}")
            return self.REVIEW_STATUS

        return self.SUCCESS_STATUS

    def process_row(self, row_data: dict, stats: BatchStats) -> bool:
        """
        Process a single row from the Google Sheet with automatic retry.
        Complete pipeline: Download → Visual Search → Synthesize → Update Sheet.

        Args:
            row_data: Row data from sheet
            stats: Batch statistics to update

        Returns:
            True if successful, False otherwise
        """
        product_id = row_data.get('product_id', 'unknown')
        row_number = row_data.get('_row_number')

        logger.info(f"{'='*60}")
        logger.info(f"Processing: {product_id}")
        logger.info(f"Row: {row_number}")
        logger.info(f"{'='*60}")

        # Step 1: Validate required fields (no retry needed - this is validation)
        main_image_id = row_data.get('main_image_id')
        if not main_image_id:
            logger.error(f"Missing main_image_id for {product_id}")
            self.sheets.update_status(
                row_number,
                self.FAILURE_STATUS,
                '[PERMANENT] Missing hero image file ID'
            )
            stats.permanent_failures += 1
            return False

        # Step 2: Process the product WITH RETRY (this is where transient errors occur)
        with RetryableOperation(
            stats.retry_stats,
            operation_name=f"research {product_id}",
            max_retries=self.max_retries,
            base_delay=self.retry_base_delay
        ) as op:
            retry_result = op.execute(lambda: self.researcher.process_product(row_data))

        if retry_result.success and retry_result.result:
            result = retry_result.result

            # Determine final status based on confidence
            final_status = self._determine_final_status(result)

            # Track if sent to review
            if final_status == self.REVIEW_STATUS:
                stats.needs_review += 1

            # Track brands found
            brand = result.designer_brand
            stats.brands_found[brand] = stats.brands_found.get(brand, 0) + 1

            # Only set fields this agent generates — Supabase partial update
            # preserves all other columns automatically (no need to re-send them)
            update_data = {
                'Product_ID': product_id,
                'Status': final_status,
                'Designer_Brand': result.designer_brand,
                'Product_Type': result.product_type,
                'Final_Product_Name': result.final_product_name,
                'Research_Sources': result.source_summary or None,
                'Research_Source_Links': [u for u in result.source_links.split(' | ') if u] or None,
                'Source_Reputation_Score': result.avg_source_reputation or None,
                'Researched_At': result.researched_at,
                'Notes': f'Attributes: {result.attribute_json}'
            }

            # Update sheet
            self.sheets.update_row(row_number, update_data)

            if retry_result.attempts > 1:
                logger.info(f"✅ Successfully researched {product_id} (after {retry_result.attempts} attempts)")
            else:
                logger.info(f"✅ Successfully researched {product_id}")
            logger.info(f"   Designer: {result.designer_brand}")
            logger.info(f"   Type: {result.product_type}")
            logger.info(f"   Name: {result.final_product_name}")
            logger.info(f"   Status: {final_status}")

            return True
        else:
            # Failed after all retries or returned None
            error_category = retry_result.error_category
            if error_category == ErrorCategory.TRANSIENT:
                stats.transient_failures += 1
            else:
                stats.permanent_failures += 1

            error_msg = retry_result.error_message if retry_result.error_message else 'Research synthesis failed'
            logger.error(f"❌ Failed to research {product_id} after {retry_result.attempts} attempts")
            self.sheets.update_status(
                row_number,
                self.FAILURE_STATUS,
                error_msg
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
        logger.info(f"  ✅ Successful (READY_FOR_SEO): {stats.success - stats.needs_review}")
        logger.info(f"  ⚠️  Needs Review (NEEDS_REVIEW): {stats.needs_review}")
        logger.info(f"  ❌ Failed (RESEARCH_FAILED): {stats.failed}")
        logger.info(f"  ⏭️  Skipped (Manual Override): {stats.skipped_override}")
        logger.info(f"  📊 Total Processed: {stats.total}")
        logger.info(f"")

        # Retry statistics
        rs = stats.retry_stats
        if rs.total_retries > 0 or rs.successful_after_retry > 0:
            logger.info(f"RETRY STATISTICS:")
            logger.info(f"  🔁 Total Retries: {rs.total_retries}")
            logger.info(f"  ✅ Recovered After Retry: {rs.successful_after_retry}")
            logger.info(f"  ❌ Failed After Retry: {rs.failed_after_retry}")
            logger.info(f"")

        # Error categorization
        if stats.transient_failures > 0 or stats.permanent_failures > 0:
            logger.info(f"ERROR BREAKDOWN:")
            logger.info(f"  ⚡ Transient Errors (network/API): {stats.transient_failures}")
            logger.info(f"  🚫 Permanent Errors (data issues): {stats.permanent_failures}")
            if rs.errors_by_type:
                logger.info(f"  Error Types: {dict(rs.errors_by_type)}")
            logger.info(f"")

        if stats.brands_found:
            logger.info(f"BRANDS IDENTIFIED:")
            sorted_brands = sorted(stats.brands_found.items(), key=lambda x: x[1], reverse=True)
            for brand, count in sorted_brands[:10]:
                logger.info(f"  - {brand}: {count}")
            if len(sorted_brands) > 10:
                logger.info(f"  ... and {len(sorted_brands) - 10} more")

        logger.info(f"")
        logger.info(f"SUCCESS RATE: {(stats.success / stats.total * 100) if stats.total > 0 else 0:.1f}%")
        logger.info(f"{'='*60}")

    def run(self, product_id: Optional[str] = None) -> None:
        """
        Main execution loop.
        Finds all READY_FOR_RESEARCH rows and processes them with rate limiting.
        """
        logger.info("Starting Researcher Agent...")

        # Initialize batch statistics
        stats = BatchStats()

        # Get rows ready for research, capped at 20 per run (gallery batching)
        ready_rows = self.sheets.get_rows_by_status(self.TARGET_STATUS, respect_override=True, limit=BATCH_SIZE)

        # Filter to single product if --product-id supplied
        if product_id:
            ready_rows = [r for r in ready_rows if r.get('product_id') == product_id]
            if not ready_rows:
                logger.info(f"Product {product_id} not found or not in {self.TARGET_STATUS} status")
                return

        if not ready_rows:
            logger.info(f"No {self.TARGET_STATUS} rows found - nothing to process")
            return

        stats.total = len(ready_rows)
        logger.info(f"Found {stats.total} rows to research")
        notify_agent_start('Agent 2 — Architect', stats.total)

        session_id = None
        try:
            session_id = self.sheets.create_run_session('agent2', batch_limit=BATCH_SIZE)
            self.sheets.log_event(session_id, f"Found {stats.total} rows to process", agent='agent2')
        except Exception:
            pass

        # Process each row with rate limiting
        for idx, row in enumerate(ready_rows, 1):
            logger.info(f"\n[{idx}/{stats.total}] Processing row...")

            try:
                # Atomically claim before any vision/API work
                pid = row.get('product_id', '')
                if not self.sheets.try_claim_row(pid, self.TARGET_STATUS, self.CLAIMING_STATUS):
                    stats.total -= 1
                    continue

                if self.process_row(row, stats):
                    stats.success += 1
                    if session_id:
                        self.sheets.log_event(session_id, f"✅ Successfully processed {pid}", agent='agent2', product_id=pid)
                else:
                    stats.failed += 1
                    if session_id:
                        self.sheets.log_event(session_id, f"❌ Failed to process {pid}", agent='agent2', product_id=pid, level='ERROR')
            except Exception as e:
                logger.error(f"Unexpected error processing row: {e}")
                stats.failed += 1
                # Mark as failed in Supabase so the UI reflects the error
                try:
                    pid = row.get('product_id', '')
                    if pid:
                        self.sheets.update_status(pid, self.FAILURE_STATUS, str(e)[:200])
                    if session_id:
                        self.sheets.log_event(session_id, f"❌ Error processing {pid}: {str(e)[:200]}", agent='agent2', product_id=pid, level='ERROR')
                except Exception:
                    pass

            # Rate limiting - delay between products (skip on last item)
            if idx < stats.total and self.api_delay_ms > 0:
                delay_sec = self.api_delay_ms / 1000
                logger.info(f"Rate limiting: waiting {delay_sec}s before next product...")
                time.sleep(delay_sec)

            # Graceful stop — checked after each item so current product always completes
            if session_id and self.sheets.check_stop_requested(session_id):
                logger.info("Stop requested — finishing after this item.")
                break

        # Print batch summary
        self._print_batch_summary(stats)
        notify_agent_complete('Agent 2 — Architect', stats.success, stats.failed)

        if session_id:
            self.sheets.log_event(session_id, f"  ✅ Successful (READY_FOR_SEO): {stats.success}", agent='agent2')
            self.sheets.log_event(session_id, f"  ❌ Failed (RESEARCH_FAILED): {stats.failed}", agent='agent2')
            self.sheets.log_event(session_id, "BATCH PROCESSING COMPLETE", agent='agent2')

        if session_id:
            try:
                self.sheets.complete_run_session(
                    session_id, succeeded=stats.success,
                    failed=stats.failed, attempted=stats.total,
                    tokens=self.researcher._run_tokens,
                    cost_usd=self.researcher._run_cost,
                )
            except Exception:
                pass


def main():
    """Entry point for Agent 2."""
    parser = argparse.ArgumentParser(description='Agent 2 — The Architect')
    parser.add_argument('--product-id', type=str, default=None, help='Run for a single product only')
    args = parser.parse_args()
    try:
        orchestrator = ResearcherOrchestrator()
        orchestrator.run(product_id=args.product_id)
    except KeyboardInterrupt:
        logger.info("\nResearch interrupted by user")
        sys.exit(0)
    except Exception as e:
        logger.error(f"Fatal error: {e}", exc_info=True)
        notify_error('Agent 2 — Architect', str(e))
        sys.exit(1)


if __name__ == "__main__":
    main()
