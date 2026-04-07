#!/usr/bin/env python3
"""
AGENT 5 ORCHESTRATOR: The Publisher (Finalizer)
Bridges HolloEngine Master Sheet → WooCommerce product drafts on hollostyle.com.

Features:
- Downloads optimized WebP images from Cloudinary
- Uploads to WordPress Media Library with correct alt text
- Creates variable product drafts (front-view as featured image)
- Maps size variations from supplier text (no prices — client sets these)
- Injects all SEO fields into Rank Math meta
- Disables Jetpack Publicize to prevent accidental social leaks
- Updates sheet with WC product ID and draft URL
- Slack notification on completion

Safety Rules (never override):
  STATUS  = draft    (client publishes manually after adding prices)
  PRICE   = empty    (client fills in before going live)
  SOCIAL  = disabled (Jetpack Publicize blocked on all drafts)
"""

import argparse
import logging
import os
import sys
import time
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Dict, Optional

import cloudinary
import cloudinary.api
from dotenv import load_dotenv

from supabase_manager import SupabaseManager
from publishers.woocommerce_publisher import WooCommercePublisher

sys.path.insert(0, str(Path(__file__).parent))
from notifiers.slack_notifier import notify_agent_complete, notify_agent_start, notify_error, notify_product_live

# ─── Logging ──────────────────────────────────────────────────────────────────
log_dir = Path(__file__).parent.parent / 'logs'
log_dir.mkdir(exist_ok=True)

# Pipeline config (set from dashboard Settings page)
def _load_pipeline_config() -> dict:
    cfg_path = Path(__file__).parent.parent / 'config' / 'pipeline_config.json'
    try:
        with open(cfg_path) as f:
            import json as _json
            return _json.load(f)
    except Exception:
        return {}

_PIPELINE_CFG = _load_pipeline_config()
BATCH_SIZE = int(_PIPELINE_CFG.get('batch_size', 20))

logging.basicConfig(
    level=logging.INFO,
    format='[AGENT_5] [%(asctime)s] [%(levelname)s] %(message)s',
    handlers=[
        logging.StreamHandler(sys.stderr),
        logging.FileHandler(log_dir / f'publisher_{Path(__file__).stem}.log'),
    ],
)
logger = logging.getLogger(__name__)


@dataclass
class BatchStats:
    total: int = 0
    success: int = 0
    failed: int = 0
    start_time: datetime = None
    end_time: datetime = None

    def __post_init__(self):
        if self.start_time is None:
            self.start_time = datetime.now()


class PublisherOrchestrator:
    """Orchestrates Agent 5: fetches PUBLISHED rows and publishes them to WooCommerce."""

    TARGET_STATUS   = 'PUBLISHED'
    CLAIMING_STATUS = 'PUBLISHING'
    SUCCESS_STATUS  = 'PENDING_APPROVAL'   # Draft created — client to add prices + publish
    FAILURE_STATUS  = 'PUBLISH_FAILED'

    def __init__(self):
        load_dotenv()

        # ── WooCommerce REST API ───────────────────────
        # Accept both WC_STORE_URL (documented name) and WC_URL (legacy fallback)
        self.wc_url             = (os.getenv('WC_STORE_URL') or os.getenv('WC_URL', '')).rstrip('/')
        self.wc_consumer_key    = os.getenv('WC_CONSUMER_KEY', '')
        self.wc_consumer_secret = os.getenv('WC_CONSUMER_SECRET', '')

        # ── WordPress Application Password ────────────
        self.wp_username     = os.getenv('WP_USERNAME', '')
        self.wp_app_password = os.getenv('WP_APP_PASSWORD', '')

        # ── Cloudinary ────────────────────────────────
        self.cloudinary_cloud_name   = os.getenv('CLOUDINARY_CLOUD_NAME', '')
        self.cloudinary_api_key      = os.getenv('CLOUDINARY_API_KEY', '')
        self.cloudinary_api_secret   = os.getenv('CLOUDINARY_API_SECRET', '')

        # ── Rate limiting ─────────────────────────────
        self.delay_ms = int(os.getenv('PUBLISHER_DELAY_MS', '3000'))

        self._validate_config()

        cloudinary.config(
            cloud_name=self.cloudinary_cloud_name,
            api_key=self.cloudinary_api_key,
            api_secret=self.cloudinary_api_secret,
        )

        self.sheets = SupabaseManager()

        self.publisher = WooCommercePublisher(
            wc_url=self.wc_url,
            consumer_key=self.wc_consumer_key,
            consumer_secret=self.wc_consumer_secret,
            wp_username=self.wp_username,
            wp_app_password=self.wp_app_password,
            cloudinary_cloud_name=self.cloudinary_cloud_name,
        )

        logger.info('Publisher Orchestrator initialized')
        logger.info(f'Target store: {self.wc_url}')
        logger.info(f'Rate limiting: {self.delay_ms}ms between products')

    def _validate_config(self) -> None:
        missing = []
        if not self.wc_url:                  missing.append('WC_STORE_URL (or WC_URL)')
        if not self.wc_consumer_key:         missing.append('WC_CONSUMER_KEY')
        if not self.wc_consumer_secret:      missing.append('WC_CONSUMER_SECRET')
        if not self.wp_username:             missing.append('WP_USERNAME')
        if not self.wp_app_password:         missing.append('WP_APP_PASSWORD')
        if not self.cloudinary_cloud_name:   missing.append('CLOUDINARY_CLOUD_NAME')
        if not self.cloudinary_api_key:      missing.append('CLOUDINARY_API_KEY')
        if not self.cloudinary_api_secret:   missing.append('CLOUDINARY_API_SECRET')
        if missing:
            logger.error(f'Missing required config: {", ".join(missing)}')
            logger.error('Add these to your .env file and retry')
            sys.exit(1)

    def _print_summary(self, stats: BatchStats) -> None:
        stats.end_time = datetime.now()
        duration = stats.end_time - stats.start_time
        rate = (stats.success / stats.total * 100) if stats.total > 0 else 0

        logger.info(f'\n{"=" * 60}')
        logger.info('AGENT 5 — PUBLISH COMPLETE')
        logger.info(f'{"=" * 60}')
        logger.info(f'Duration:     {duration}')
        logger.info(f'Total:        {stats.total}')
        logger.info(f'Published:    {stats.success}  (status → {self.SUCCESS_STATUS})')
        logger.info(f'Failed:       {stats.failed}')
        logger.info(f'Success rate: {rate:.1f}%')
        logger.info(f'{"=" * 60}')

    def run(self, product_id: Optional[str] = None) -> None:
        """
        Main loop — fetch PUBLISHED rows and publish each to WooCommerce.
        Pass product_id to target a single product (from dashboard trigger).
        """
        logger.info('Starting Publisher Agent (Agent 5 — The Finalizer)...')

        stats = BatchStats()

        # Cap at 20 per run — gallery batching
        pending = self.sheets.get_rows_by_status(self.TARGET_STATUS, respect_override=True, limit=BATCH_SIZE)

        # Single-product mode (dashboard trigger)
        if product_id:
            pending = [r for r in pending if r.get('product_id') == product_id]
            if not pending:
                logger.info(f'Product {product_id} not found or not in {self.TARGET_STATUS} status')
                return

        if not pending:
            logger.info(f'No {self.TARGET_STATUS} rows found — nothing to publish')
            return

        stats.total = len(pending)
        logger.info(f'Found {stats.total} products to publish')
        notify_agent_start('Agent 5 — Publisher', stats.total)

        session_id = None
        try:
            session_id = self.sheets.create_run_session('agent5', batch_limit=BATCH_SIZE)
            self.sheets.log_event(session_id, f"Found {stats.total} rows to process", agent='agent5')
        except Exception:
            pass

        for idx, row in enumerate(pending, 1):
            pid     = row.get('product_id', '?')
            row_num = row.get('_row_number')
            name    = row.get('cms_title') or row.get('final_product_name', pid)

            logger.info(f'\n[{idx}/{stats.total}] {pid} — {name}')

            try:
                # Atomically claim before any WooCommerce API work
                if not self.sheets.try_claim_row(pid, self.TARGET_STATUS, self.CLAIMING_STATUS):
                    stats.total -= 1
                    continue

                result = self.publisher.process_product(row)

                if result.success:
                    self.sheets.update_row(row_num, {
                        'Status':       self.SUCCESS_STATUS,
                        'Store_URL':    result.wc_draft_edit_url or result.wc_product_url or '',
                        'WC_Product_ID': result.wc_product_id or None,
                        'Published_At': datetime.now().isoformat(),
                        'Notes':        (
                            f'WC #{result.wc_product_id} | '
                            f'{result.images_uploaded} images | '
                            f'{result.variations_created} size variations | DRAFT'
                        ),
                    })
                    stats.success += 1
                    notify_product_live(name, pid, result.wc_draft_edit_url or '')
                    logger.info(f'✅ {pid} staged as draft → WC #{result.wc_product_id}')
                    if session_id:
                        self.sheets.log_event(session_id, f"✅ Successfully processed {pid}", agent='agent5', product_id=pid)

                else:
                    self.sheets.update_status(row_num, self.FAILURE_STATUS, result.error or 'Unknown error')
                    notify_error('Agent 5 — Publisher', result.error or 'Unknown error', pid)
                    stats.failed += 1
                    logger.error(f'❌ {pid} failed: {result.error}')
                    if session_id:
                        self.sheets.log_event(session_id, f"❌ Failed to process {pid}", agent='agent5', product_id=pid, level='ERROR')

            except Exception as e:
                logger.error(f'Unexpected error for {pid}: {e}', exc_info=True)
                self.sheets.update_status(row_num, self.FAILURE_STATUS, str(e)[:200])
                notify_error('Agent 5 — Publisher', str(e), pid)
                stats.failed += 1
                if session_id:
                    self.sheets.log_event(session_id, f"❌ Error processing {pid}: {str(e)[:200]}", agent='agent5', product_id=pid, level='ERROR')

            # Rate limiting
            if idx < stats.total and self.delay_ms > 0:
                time.sleep(self.delay_ms / 1000)

            # Graceful stop — checked after each item so current product always completes
            if session_id and self.sheets.check_stop_requested(session_id):
                logger.info('Stop requested — finishing after this item.')
                break

        self._print_summary(stats)
        notify_agent_complete('Agent 5 — Publisher', stats.success, stats.failed)

        if session_id:
            self.sheets.log_event(session_id, f"Published:    {stats.success}  (status → {self.SUCCESS_STATUS})", agent='agent5')
            self.sheets.log_event(session_id, f"Failed:       {stats.failed}", agent='agent5')
            self.sheets.log_event(session_id, "PUBLISH COMPLETE", agent='agent5')

        if session_id:
            try:
                self.sheets.complete_run_session(
                    session_id, succeeded=stats.success,
                    failed=stats.failed, attempted=stats.total,
                )
            except Exception:
                pass


def main():
    """Entry point for Agent 5."""
    parser = argparse.ArgumentParser(description='Agent 5 — The Publisher')
    parser.add_argument('--product-id', type=str, default=None, help='Publish a single product only')
    parser.add_argument('--test', action='store_true', help='Test API connectivity only (no products processed)')
    args = parser.parse_args()

    try:
        orchestrator = PublisherOrchestrator()
        if args.test:
            ok = orchestrator.publisher.test_connectivity()
            sys.exit(0 if ok else 1)
        else:
            orchestrator.run(product_id=args.product_id)
    except KeyboardInterrupt:
        logger.info('\nPublishing interrupted by user')
        sys.exit(0)
    except Exception as e:
        logger.error(f'Fatal error: {e}', exc_info=True)
        notify_error('Agent 5 — Publisher', str(e))
        sys.exit(1)


if __name__ == '__main__':
    main()
