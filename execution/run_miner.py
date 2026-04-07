#!/usr/bin/env python3
"""
AGENT 1 ORCHESTRATOR: The Miner
Main entry point for scraping supplier sites and staging data in Google Sheets.

Features:
- Factory pattern for multi-supplier support (Yupoo, future: Weidian, 1688)
- Google Drive image staging with OAuth2
- Rate limiting for batch processing
- Manual override protection
- Batch summary reporting
- Automatic retry with exponential backoff
- Error categorization (transient vs permanent)
"""

import argparse
import logging
import json
import os
import sys
import time
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from urllib.parse import urlparse
from typing import Any, Dict, Optional

from dotenv import load_dotenv

from supabase_manager import SupabaseManager
from miners.yupoo_miner import YupooMiner
from retry_handler import (
    RetryStats, RetryableOperation, ErrorCategory,
    categorize_error, format_error_for_notes
)
import re
import uuid
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


@dataclass
class BatchStats:
    """Statistics for batch processing summary."""
    total: int = 0
    success: int = 0
    failed: int = 0
    duplicates: int = 0
    invalid_urls: int = 0
    skipped_override: int = 0
    suppliers_processed: Dict[str, int] = None
    start_time: datetime = None
    end_time: datetime = None
    # Retry statistics
    retry_stats: RetryStats = None
    transient_failures: int = 0
    permanent_failures: int = 0

    def __post_init__(self):
        if self.suppliers_processed is None:
            self.suppliers_processed = {}
        if self.start_time is None:
            self.start_time = datetime.now()
        if self.retry_stats is None:
            self.retry_stats = RetryStats()

logging.basicConfig(
    level=logging.INFO,
    format='[AGENT_1] [%(asctime)s] [%(levelname)s] %(message)s',
    handlers=[
        logging.StreamHandler(sys.stderr),
        logging.FileHandler(log_dir / f'miner_{Path(__file__).stem}.log')
    ]
)
logger = logging.getLogger(__name__)


class MinerOrchestrator:
    """Orchestrates the mining process across multiple suppliers."""

    def __init__(self):
        """Initialize orchestrator with credentials from environment."""
        load_dotenv()

        # Project root for resolving relative paths
        project_root = Path(__file__).parent.parent

        # Required environment variables
        self.openai_api_key = os.getenv('OPENAI_API_KEY')

        # Cloudinary credentials
        self.cloudinary_cloud_name = os.getenv('CLOUDINARY_CLOUD_NAME')
        self.cloudinary_api_key = os.getenv('CLOUDINARY_API_KEY')
        self.cloudinary_api_secret = os.getenv('CLOUDINARY_API_SECRET')

        # Rate limiting config (milliseconds between products)
        self.api_delay_ms = int(os.getenv('MINER_DELAY_MS', '2000'))

        # Retry configuration
        self.max_retries = int(os.getenv('MAX_RETRIES', '3'))
        self.retry_base_delay = float(os.getenv('RETRY_BASE_DELAY', '1.0'))

        # Validate required config
        self._validate_config()

        # Initialize Supabase manager
        self.sheets = SupabaseManager()

        logger.info("Miner Orchestrator initialized")
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

    def get_miner_for_url(self, url: str) -> Optional[object]:
        """
        Factory method: Return appropriate miner based on URL pattern.
        """
        parsed = urlparse(url)
        domain = parsed.netloc.lower()

        # Yupoo detection
        if 'yupoo.com' in domain:
            logger.info(f"Detected Yupoo URL: {domain}")
            return YupooMiner(
                openai_api_key=self.openai_api_key,
                cloudinary_cloud_name=self.cloudinary_cloud_name,
                cloudinary_api_key=self.cloudinary_api_key,
                cloudinary_api_secret=self.cloudinary_api_secret
            )

        # Future: Add other suppliers
        # elif 'weidian.com' in domain:
        #     return WeidianMiner(...)
        # elif '1688.com' in domain:
        #     return AlibabaMiner(...)

        logger.error(f"Unsupported supplier domain: {domain}")
        return None

    def detect_url_type(self, url: str) -> str:
        """
        Detect if URL is a gallery (multiple albums) or album (single product).

        Gallery URL patterns:
        - https://xxx.yupoo.com/albums?tab=gallery
        - https://xxx.yupoo.com/albums (no album ID)
        - https://xxx.yupoo.com/categories/123 (category pages)

        Album URL patterns:
        - https://xxx.yupoo.com/albums/123456789?uid=1

        Returns:
            'gallery' | 'album' | 'unknown'
        """
        parsed = urlparse(url)
        path = parsed.path
        query = parsed.query

        # Check for Yupoo
        if 'yupoo.com' not in parsed.netloc:
            return 'unknown'

        # Gallery patterns
        # /albums?tab=gallery or /albums without album ID
        if path == '/albums' or path == '/albums/':
            return 'gallery'

        # Category pages are also galleries
        if '/categories/' in path:
            return 'gallery'

        # Album pattern: /albums/[numeric_id]
        album_pattern = re.match(r'/albums/(\d+)', path)
        if album_pattern:
            return 'album'

        return 'unknown'

    def process_gallery(self, row_data: dict, stats: BatchStats) -> bool:
        """
        Process a gallery URL: discover albums and add them as new rows.

        Args:
            row_data: Row data containing the gallery URL
            stats: Batch statistics

        Returns:
            True if discovery successful, False otherwise
        """
        product_id = row_data.get('product_id')
        gallery_url = row_data.get('source_url')
        row_number = row_data.get('_row_number')

        logger.info(f"{'='*60}")
        logger.info(f"GALLERY DETECTED: {product_id}")
        logger.info(f"URL: {gallery_url}")
        logger.info(f"Discovering albums...")
        logger.info(f"{'='*60}")

        # Get miner for discovery
        miner = self.get_miner_for_url(gallery_url)
        if not miner:
            self.sheets.update_status(row_number, 'INVALID_URL', 'Unsupported gallery URL')
            return False

        try:
            # Discover albums
            albums = miner.discover_albums(gallery_url)

            if not albums:
                logger.warning(f"No albums found in gallery: {gallery_url}")
                self.sheets.update_status(row_number, 'DISCOVERY_EMPTY', 'No albums found in gallery')
                return False

            logger.info(f"Discovered {len(albums)} albums")

            # Get existing supplier IDs to avoid duplicates
            existing_ids = self.sheets.get_all_supplier_ids()

            # Prepare new rows
            new_rows = []
            duplicates_skipped = 0

            for album in albums:
                supplier_id = album.get('supplier_id', '')

                # Skip duplicates
                if supplier_id in existing_ids:
                    duplicates_skipped += 1
                    continue

                # Generate unique product ID
                new_product_id = uuid.uuid4().hex[:8].upper()

                new_rows.append({
                    'product_id': new_product_id,
                    'status': 'READY_FOR_SCRAPE',
                    'manual_override': False,
                    'source_url': album['url'],
                    'supplier_id': supplier_id
                })

                # Track to avoid duplicates within this batch
                existing_ids.add(supplier_id)

            # Add new rows to sheet
            if new_rows:
                rows_added = self.sheets.append_rows(new_rows)
                logger.info(f"✅ Added {rows_added} new album rows to sheet")
                logger.info(f"   Duplicates skipped: {duplicates_skipped}")
            else:
                logger.info(f"All {len(albums)} albums were duplicates - nothing to add")

            # Mark original gallery row as discovered
            self.sheets.update_status(
                row_number,
                'DISCOVERED',
                f'Discovered {len(albums)} albums, added {len(new_rows)} new rows'
            )

            return True

        except Exception as e:
            logger.error(f"Gallery discovery failed: {e}")
            self.sheets.update_status(row_number, 'DISCOVERY_FAILED', str(e)[:200])
            return False

    def process_row(self, row_data: dict, stats: BatchStats) -> bool:
        """
        Process a single row from the Google Sheet with automatic retry.
        Complete pipeline: Validate → Scrape → Upload → Update Sheet.

        Args:
            row_data: Row data from sheet
            stats: Batch statistics to update

        Returns:
            True if successful, False otherwise
        """
        product_id = row_data.get('product_id')
        source_url = row_data.get('source_url')
        row_number = row_data.get('_row_number')

        logger.info(f"{'='*60}")
        logger.info(f"Processing: {product_id}")
        logger.info(f"URL: {source_url}")
        logger.info(f"{'='*60}")

        # Step 1: Get appropriate miner (no retry needed - this is validation)
        miner = self.get_miner_for_url(source_url)
        if not miner:
            self.sheets.update_status(
                row_number,
                'INVALID_URL',
                '[PERMANENT] Unsupported supplier URL'
            )
            stats.invalid_urls += 1
            stats.permanent_failures += 1
            return False

        # Track supplier type
        supplier_type = type(miner).__name__
        stats.suppliers_processed[supplier_type] = stats.suppliers_processed.get(supplier_type, 0) + 1

        # Step 2: Extract supplier ID and check for duplicates (no retry needed)
        supplier_id = miner.extract_supplier_id(source_url)
        if self.sheets.check_duplicate_supplier_id(supplier_id, exclude_product_id=product_id):
            logger.warning(f"Duplicate Supplier_ID found: {supplier_id}")
            self.sheets.update_status(
                row_number,
                'DUPLICATE',
                f'[PERMANENT] Duplicate of Supplier_ID: {supplier_id}'
            )
            stats.duplicates += 1
            stats.failed += 1
            stats.permanent_failures += 1
            return False

        # Step 3: Process product WITH RETRY (this is where transient errors occur)
        with RetryableOperation(
            stats.retry_stats,
            operation_name=f"scrape {product_id}",
            max_retries=self.max_retries,
            base_delay=self.retry_base_delay
        ) as op:
            result = op.execute(lambda: miner.process_product(source_url, product_id))

        if result.success:
            # Step 4: Update sheet with results
            result_data = result.result
            update_data = {
                'Product_ID': product_id,
                'Source_URL': source_url,
                **result_data
            }

            self.sheets.update_row(row_number, update_data)

            if result.attempts > 1:
                logger.info(f"✅ Successfully processed {product_id} (after {result.attempts} attempts)")
            else:
                logger.info(f"✅ Successfully processed {product_id}")
            return True
        else:
            # Failed after all retries
            error_category = result.error_category
            if error_category == ErrorCategory.TRANSIENT:
                stats.transient_failures += 1
            else:
                stats.permanent_failures += 1

            logger.error(f"❌ Failed to process {product_id} after {result.attempts} attempts")
            self.sheets.update_status(
                row_number,
                'SCRAPE_FAILED',
                result.error_message
            )
            return False

    # Status constants
    TARGET_STATUS   = 'READY_FOR_SCRAPE'
    CLAIMING_STATUS = 'SCRAPING'
    SUCCESS_STATUS  = 'READY_FOR_RESEARCH'
    FAILURE_STATUS  = 'SCRAPE_FAILED'

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
        logger.info(f"  ✅ Successful (READY_FOR_RESEARCH): {stats.success}")
        logger.info(f"  ❌ Failed (SCRAPE_FAILED): {stats.failed}")
        logger.info(f"  🔄 Duplicates (skipped): {stats.duplicates}")
        logger.info(f"  ⚠️  Invalid URLs: {stats.invalid_urls}")
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

        if stats.suppliers_processed:
            logger.info(f"SUPPLIERS PROCESSED:")
            for supplier, count in sorted(stats.suppliers_processed.items(), key=lambda x: x[1], reverse=True):
                logger.info(f"  - {supplier}: {count}")

        logger.info(f"")
        logger.info(f"SUCCESS RATE: {(stats.success / stats.total * 100) if stats.total > 0 else 0:.1f}%")
        logger.info(f"{'='*60}")

    def run(self, product_id: Optional[str] = None) -> None:
        """
        Main execution loop.
        Finds all READY_FOR_SCRAPE rows and processes them with rate limiting.

        Smart URL Detection:
        - Gallery URLs: Discovers albums, adds new rows, marks as DISCOVERED
        - Album URLs: Scrapes product directly, marks as SCRAPED
        """
        logger.info("Starting Miner Agent...")
        logger.info("Smart URL Detection: ENABLED")

        # Initialize batch statistics
        stats = BatchStats()

        # Get rows ready for scraping, capped at 20 per run (gallery batching)
        pending_rows = self.sheets.get_rows_by_status(self.TARGET_STATUS, respect_override=True, limit=BATCH_SIZE)

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
        notify_agent_start('Agent 1 — Miner', stats.total)

        # Start run session for dashboard reporting
        session_id = None
        try:
            session_id = self.sheets.create_run_session('agent1', batch_limit=BATCH_SIZE)
            self.sheets.log_event(session_id, f"Found {stats.total} rows to process", agent='agent1')
        except Exception:
            pass  # session tracking is non-critical

        # Separate galleries from albums for better logging
        galleries = []
        albums = []
        unknown = []

        for row in pending_rows:
            url = row.get('source_url', '')
            url_type = self.detect_url_type(url)
            if url_type == 'gallery':
                galleries.append(row)
            elif url_type == 'album':
                albums.append(row)
            else:
                unknown.append(row)

        logger.info(f"  - Galleries (will discover): {len(galleries)}")
        logger.info(f"  - Albums (will scrape): {len(albums)}")
        if unknown:
            logger.info(f"  - Unknown URLs: {len(unknown)}")

        # Process galleries first (they add more rows)
        gallery_count = 0
        for idx, row in enumerate(galleries, 1):
            logger.info(f"\n[Gallery {idx}/{len(galleries)}] Processing...")

            try:
                if self.process_gallery(row, stats):
                    stats.success += 1
                    gallery_count += 1
                else:
                    stats.failed += 1
            except Exception as e:
                logger.error(f"Unexpected error processing gallery: {e}")
                stats.failed += 1

            # Rate limiting between galleries
            if idx < len(galleries) and self.api_delay_ms > 0:
                delay_sec = self.api_delay_ms / 1000
                logger.info(f"Rate limiting: waiting {delay_sec}s...")
                time.sleep(delay_sec)

        # If galleries were processed, refresh the pending rows to include new albums
        if gallery_count > 0:
            logger.info(f"\n{'='*60}")
            logger.info(f"Galleries processed. Refreshing row list...")
            logger.info(f"{'='*60}")

            # Get updated list of pending rows (capped at 20 — remaining stay for next run)
            pending_rows = self.sheets.get_rows_by_status(self.TARGET_STATUS, respect_override=True, limit=BATCH_SIZE)
            albums = [r for r in pending_rows if self.detect_url_type(r.get('source_url', '')) == 'album']
            logger.info(f"Now have {len(albums)} albums to scrape")
            stats.total = len(galleries) + len(albums) + len(unknown)

        # Process albums (individual products)
        for idx, row in enumerate(albums, 1):
            logger.info(f"\n[Album {idx}/{len(albums)}] Processing row...")

            try:
                # Atomically claim before any Playwright/Cloudinary work
                pid = row.get('product_id', '')
                if not self.sheets.try_claim_row(pid, self.TARGET_STATUS, self.CLAIMING_STATUS):
                    stats.total -= 1
                    continue

                if self.process_row(row, stats):
                    stats.success += 1
                    if session_id:
                        self.sheets.log_event(session_id, f"✅ Successfully processed {pid}", agent='agent1', product_id=pid)
                else:
                    stats.failed += 1
                    if session_id:
                        self.sheets.log_event(session_id, f"❌ Failed to process {pid}", agent='agent1', product_id=pid, level='ERROR')
            except Exception as e:
                logger.error(f"Unexpected error processing row: {e}")
                stats.failed += 1
                try:
                    pid = row.get('product_id', '')
                    if pid:
                        self.sheets.update_status(pid, self.FAILURE_STATUS, str(e)[:200])
                    if session_id:
                        self.sheets.log_event(session_id, f"❌ Error processing {pid}: {str(e)[:200]}", agent='agent1', product_id=pid, level='ERROR')
                except Exception:
                    pass

            # Rate limiting - delay between products (skip on last item)
            if idx < len(albums) and self.api_delay_ms > 0:
                delay_sec = self.api_delay_ms / 1000
                logger.info(f"Rate limiting: waiting {delay_sec}s before next product...")
                time.sleep(delay_sec)

            # Graceful stop — checked after each item so current product always completes
            if session_id and self.sheets.check_stop_requested(session_id):
                logger.info("Stop requested — finishing after this item.")
                break

        # Handle unknown URLs (treat as albums, will fail with proper error)
        for idx, row in enumerate(unknown, 1):
            logger.info(f"\n[Unknown {idx}/{len(unknown)}] Processing row...")

            try:
                if self.process_row(row, stats):
                    stats.success += 1
                else:
                    stats.failed += 1
            except Exception as e:
                logger.error(f"Unexpected error processing row: {e}")
                stats.failed += 1
                try:
                    pid = row.get('product_id', '')
                    if pid:
                        self.sheets.update_status(pid, self.FAILURE_STATUS, str(e)[:200])
                except Exception:
                    pass

        # Print batch summary
        self._print_batch_summary(stats)
        notify_agent_complete('Agent 1 — Miner', stats.success, stats.failed)

        if session_id:
            self.sheets.log_event(session_id, f"  ✅ Successful (READY_FOR_RESEARCH): {stats.success}", agent='agent1')
            self.sheets.log_event(session_id, f"  ❌ Failed (SCRAPE_FAILED): {stats.failed}", agent='agent1')
            self.sheets.log_event(session_id, "BATCH PROCESSING COMPLETE", agent='agent1')

        # Complete run session
        if session_id:
            try:
                self.sheets.complete_run_session(
                    session_id,
                    succeeded=stats.success,
                    failed=stats.failed,
                    attempted=stats.total,
                )
            except Exception:
                pass


def main():
    """Entry point for Agent 1."""
    parser = argparse.ArgumentParser(description='Agent 1 — The Miner')
    parser.add_argument('--product-id', type=str, default=None, help='Run for a single product only')
    args = parser.parse_args()
    try:
        orchestrator = MinerOrchestrator()
        orchestrator.run(product_id=args.product_id)
    except KeyboardInterrupt:
        logger.info("\nMining interrupted by user")
        sys.exit(0)
    except Exception as e:
        logger.error(f"Fatal error: {e}", exc_info=True)
        notify_error('Agent 1 — Miner', str(e))
        sys.exit(1)


if __name__ == "__main__":
    main()
