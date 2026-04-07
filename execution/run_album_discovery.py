#!/usr/bin/env python3
"""
ALBUM DISCOVERY: Scan a Yupoo gallery page and populate rows for each product album.

Usage:
    python run_album_discovery.py <gallery_url>
    python run_album_discovery.py "https://seller.x.yupoo.com/albums"

Features:
- Discovers all product album URLs from a gallery/category page
- Generates unique Product_IDs for each discovered album
- Filters out duplicates (albums already in sheet)
- Adds new rows with Status='READY_FOR_SCRAPE'
- Supports password-protected Yupoo galleries
"""

import logging
import os
import sys
import uuid
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import List

from dotenv import load_dotenv

from supabase_manager import SupabaseManager
from miners.yupoo_miner import YupooMiner

# Configure logging
log_dir = Path(__file__).parent.parent / 'logs'
log_dir.mkdir(exist_ok=True)

logging.basicConfig(
    level=logging.INFO,
    format='[DISCOVERY] [%(asctime)s] [%(levelname)s] %(message)s',
    handlers=[
        logging.StreamHandler(sys.stderr),
        logging.FileHandler(log_dir / 'album_discovery.log')
    ]
)
logger = logging.getLogger(__name__)


@dataclass
class DiscoveryStats:
    """Statistics for album discovery."""
    total_discovered: int = 0
    duplicates_skipped: int = 0
    rows_added: int = 0
    errors: int = 0
    start_time: datetime = None
    end_time: datetime = None

    def __post_init__(self):
        if self.start_time is None:
            self.start_time = datetime.now()


class AlbumDiscoveryOrchestrator:
    """Orchestrates album discovery from Yupoo gallery pages."""

    def __init__(self):
        """Initialize with credentials from environment."""
        load_dotenv()

        # Project root for resolving paths
        project_root = Path(__file__).parent.parent

        # Required environment variables
        self.openai_api_key = os.getenv('OPENAI_API_KEY')

        # Cloudinary credentials
        self.cloudinary_cloud_name = os.getenv('CLOUDINARY_CLOUD_NAME')
        self.cloudinary_api_key = os.getenv('CLOUDINARY_API_KEY')
        self.cloudinary_api_secret = os.getenv('CLOUDINARY_API_SECRET')

        # Validate config
        self._validate_config()

        # Initialize managers
        self.sheets = SupabaseManager()

        logger.info("Album Discovery Orchestrator initialized")

    def _resolve_path(self, path_str: str, project_root: Path) -> str:
        """Resolve path relative to project root if not absolute."""
        path = Path(path_str)
        if path.is_absolute():
            return str(path)
        return str(project_root / path)

    def _validate_config(self) -> None:
        """Validate required configuration."""
        missing = []

        if not self.openai_api_key:
            missing.append('OPENAI_API_KEY')
        if missing:
            logger.error(f"Missing required configuration: {', '.join(missing)}")
            sys.exit(1)

    def _generate_product_id(self) -> str:
        """Generate a unique Product_ID."""
        return str(uuid.uuid4())[:8].upper()

    def discover_and_populate(self, gallery_url: str) -> DiscoveryStats:
        """
        Discover albums from a gallery URL and add them to the sheet.

        Args:
            gallery_url: URL of the Yupoo gallery page

        Returns:
            DiscoveryStats with results
        """
        stats = DiscoveryStats()

        logger.info(f"{'='*60}")
        logger.info(f"ALBUM DISCOVERY")
        logger.info(f"Gallery: {gallery_url}")
        logger.info(f"{'='*60}")

        # Step 1: Initialize miner for discovery
        miner = YupooMiner(
            openai_api_key=self.openai_api_key,
            cloudinary_cloud_name=self.cloudinary_cloud_name,
            cloudinary_api_key=self.cloudinary_api_key,
            cloudinary_api_secret=self.cloudinary_api_secret
        )

        # Step 2: Discover albums
        logger.info("Scanning gallery for albums...")
        discovered_albums = miner.discover_albums(gallery_url)
        stats.total_discovered = len(discovered_albums)

        if not discovered_albums:
            logger.warning("No albums discovered from gallery")
            return stats

        logger.info(f"Discovered {stats.total_discovered} albums")

        # Step 3: Get existing supplier IDs for deduplication
        logger.info("Checking for existing products...")
        existing_supplier_ids = self.sheets.get_all_supplier_ids()
        logger.info(f"Found {len(existing_supplier_ids)} existing products in sheet")

        # Step 4: Filter out duplicates and prepare new rows
        new_rows = []
        for album in discovered_albums:
            supplier_id = album.get('supplier_id')
            url = album.get('url')

            if supplier_id and supplier_id in existing_supplier_ids:
                logger.debug(f"Skipping duplicate: {supplier_id}")
                stats.duplicates_skipped += 1
                continue

            # Generate new Product_ID
            product_id = self._generate_product_id()

            # Prepare row data
            row_data = {
                'product_id': product_id,
                'status': 'READY_FOR_SCRAPE',
                'manual_override': False,
                'source_url': url,
                'supplier_id': supplier_id or '',
                'notes': f'Discovered from: {gallery_url}'
            }

            new_rows.append(row_data)

            # Add to existing set to prevent duplicates within this batch
            if supplier_id:
                existing_supplier_ids.add(supplier_id)

        logger.info(f"New albums to add: {len(new_rows)}")
        logger.info(f"Duplicates skipped: {stats.duplicates_skipped}")

        # Step 5: Add new rows to sheet
        if new_rows:
            try:
                rows_added = self.sheets.append_rows(new_rows)
                stats.rows_added = rows_added
                logger.info(f"Successfully added {rows_added} new rows to sheet")
            except Exception as e:
                logger.error(f"Failed to add rows to sheet: {e}")
                stats.errors += 1

        # Print summary
        self._print_summary(stats, gallery_url)

        return stats

    def _print_summary(self, stats: DiscoveryStats, gallery_url: str) -> None:
        """Print discovery summary."""
        stats.end_time = datetime.now()
        duration = stats.end_time - stats.start_time

        logger.info(f"\n{'='*60}")
        logger.info(f"ALBUM DISCOVERY COMPLETE")
        logger.info(f"{'='*60}")
        logger.info(f"Gallery: {gallery_url}")
        logger.info(f"Duration: {duration}")
        logger.info(f"")
        logger.info(f"RESULTS:")
        logger.info(f"  Total Albums Discovered: {stats.total_discovered}")
        logger.info(f"  Duplicates Skipped: {stats.duplicates_skipped}")
        logger.info(f"  New Rows Added: {stats.rows_added}")
        if stats.errors:
            logger.info(f"  Errors: {stats.errors}")
        logger.info(f"")
        logger.info(f"Next step: Run `python run_miner.py` to scrape the new products")
        logger.info(f"{'='*60}")


def main():
    """Entry point for album discovery."""
    if len(sys.argv) < 2:
        print("Usage: python run_album_discovery.py <gallery_url>")
        print("")
        print("Example:")
        print("  python run_album_discovery.py 'https://seller.x.yupoo.com/albums'")
        print("")
        print("This will discover all product albums from the gallery page")
        print("and add them to your Google Sheet with Status='READY_FOR_SCRAPE'")
        sys.exit(1)

    gallery_url = sys.argv[1]

    try:
        orchestrator = AlbumDiscoveryOrchestrator()
        stats = orchestrator.discover_and_populate(gallery_url)

        if stats.rows_added > 0:
            logger.info(f"\nReady to scrape {stats.rows_added} new products!")
        elif stats.total_discovered > 0:
            logger.info(f"\nAll {stats.total_discovered} discovered albums already exist in sheet")
        else:
            logger.warning("\nNo albums found - check if the gallery URL is correct")

    except KeyboardInterrupt:
        logger.info("\nDiscovery interrupted by user")
        sys.exit(0)
    except Exception as e:
        logger.error(f"Fatal error: {e}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
