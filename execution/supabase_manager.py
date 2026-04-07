#!/usr/bin/env python3
"""
SUPABASE MANAGER: Replaces sheets_manager.py as the pipeline's data layer.
All agents read/write through this class. Drop-in replacement for SheetsManager.

Environment variables required:
  SUPABASE_URL      — e.g. https://xxxx.supabase.co
  SUPABASE_SERVICE_KEY — service role key (bypasses RLS, safe for backend agents)
"""

import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from supabase import create_client, Client

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    """Return current UTC time as ISO 8601 string."""
    return datetime.now(timezone.utc).isoformat()


class SupabaseManager:
    """
    Manages all Supabase reads/writes for the HolloEngine pipeline.
    Mirrors the SheetsManager interface so agents need minimal changes.
    """

    TABLE = 'products'

    def __init__(self, supabase_url: str = None, supabase_key: str = None):
        """
        Initialize with Supabase credentials.
        Falls back to environment variables if not provided.
        """
        url = supabase_url or os.getenv('SUPABASE_URL')
        key = supabase_key or os.getenv('SUPABASE_SERVICE_KEY')

        if not url or not key:
            raise ValueError(
                'Supabase credentials missing. '
                'Set SUPABASE_URL and SUPABASE_SERVICE_KEY in your .env file.'
            )

        self.client: Client = create_client(url, key)
        logger.info(f'SupabaseManager connected to {url[:40]}...')

    # ─────────────────────────────────────────────────────────────────────────
    # READ OPERATIONS
    # ─────────────────────────────────────────────────────────────────────────

    def get_rows_by_status(
        self,
        target_status: str,
        respect_override: bool = True,
        limit: int = None,
    ) -> List[Dict[str, Any]]:
        """
        Fetch all products where status = target_status.
        Optionally skip rows where manual_override = true.
        Optionally limit the number of rows returned (batch processing).

        Returns list of dicts. Adds '_row_id' key (the uuid primary key)
        for backwards compatibility with agents that use _row_number.
        """
        logger.info(f"Fetching rows with status='{target_status}'...")

        query = (
            self.client.table(self.TABLE)
            .select('*')
            .eq('status', target_status)
            .order('created_at', desc=False)
        )

        if respect_override:
            query = query.eq('manual_override', False)

        if limit:
            query = query.limit(limit)

        response = query.execute()
        rows = response.data or []

        # Backwards-compat alias: agents reference _row_number for updates.
        # In Supabase we update by product_id, but keep the alias to minimise
        # changes to existing agent code during migration.
        for row in rows:
            row['_row_number'] = row.get('product_id')  # alias

        skipped = '' if not respect_override else ''
        logger.info(f"Found {len(rows)} rows with status='{target_status}'")
        return rows

    def get_row_by_product_id(self, product_id: str) -> Optional[Dict[str, Any]]:
        """Find a single product by its product_id."""
        response = (
            self.client.table(self.TABLE)
            .select('*')
            .eq('product_id', product_id)
            .single()
            .execute()
        )
        row = response.data
        if row:
            row['_row_number'] = row.get('product_id')
        return row

    def check_duplicate_supplier_id(self, supplier_id: str, exclude_product_id: str = None) -> bool:
        """Return True if supplier_id already exists in the table (excluding the current row)."""
        query = (
            self.client.table(self.TABLE)
            .select('product_id')
            .eq('supplier_id', supplier_id)
        )
        if exclude_product_id:
            query = query.neq('product_id', exclude_product_id)
        response = query.limit(1).execute()
        exists = bool(response.data)
        if exists:
            logger.warning(f'Duplicate supplier_id found: {supplier_id}')
        return exists

    def get_all_supplier_ids(self) -> set:
        """Return a set of all existing supplier_ids (for bulk dedup checks)."""
        response = (
            self.client.table(self.TABLE)
            .select('supplier_id')
            .not_.is_('supplier_id', 'null')
            .execute()
        )
        return {row['supplier_id'] for row in (response.data or []) if row.get('supplier_id')}

    # ─────────────────────────────────────────────────────────────────────────
    # WRITE OPERATIONS
    # ─────────────────────────────────────────────────────────────────────────

    def update_row(self, product_id: str, data: Dict[str, Any]) -> None:
        """
        Update a product row by product_id.

        Accepts either:
          - product_id as a string  (new Supabase-native call)
          - _row_number value       (backwards compat — agents pass row['_row_number'])

        Strips internal keys before writing.
        Converts legacy Sheets column names to Supabase column names automatically.
        """
        # _row_number is an alias for product_id during migration
        if isinstance(product_id, str) and not product_id.startswith('HE-'):
            # might be a uuid or an HE- id — both are fine
            pass

        # Strip internal/meta keys
        clean = {k: v for k, v in data.items() if not k.startswith('_')}

        # ── Legacy column name mapping (Sheets → Supabase) ──────────────────
        REMAP = {
            'GDrive_Folder_Link':      'storage_folder_url',
            'Main_Image_File_ID':      'main_image_id',
            'English_Full_Translation':'english_full_translation',
            'Research_Source_Links':   'research_source_links',
            'Source_Reputation_Score': 'source_reputation_score',
            'Extracted_Price':         'extracted_price',
            'Image_Count':             'image_count',
            'WebP_Image_Count':        'webp_image_count',
            'Viewpoint_Labels':        'viewpoint_labels',
            'Scraped_At':              'scraped_at',
            'Researched_At':           'researched_at',
            'Optimized_At':            'optimized_at',
            'Published_At':            'published_at',
            'Manual_Override':         'manual_override',
            'Target_Store':            'target_store',
            'Store_URL':               'store_url',
            'WC_Product_ID':           'wc_product_id',
        }
        for old, new in REMAP.items():
            if old in clean:
                clean[new] = clean.pop(old)

        # Convert ALL remaining PascalCase keys to snake_case for safety
        def to_snake(key: str) -> str:
            import re
            s1 = re.sub(r'([A-Z]+)([A-Z][a-z])', r'\1_\2', key)
            return re.sub(r'([a-z0-9])([A-Z])', r'\1_\2', s1).lower()

        clean = {to_snake(k): v for k, v in clean.items()}

        # Remove fields that don't exist in the schema
        # Includes transient claiming statuses so update_row can write them if needed
        VALID_COLUMNS = {
            'status', 'manual_override', 'notes', 'target_store',
            'source_url', 'supplier_id', 'raw_chinese', 'english_full_translation',
            'english_name_draft', 'extracted_brand', 'material_info', 'product_description',
            'storage_folder_url', 'main_image_id', 'image_count', 'scraped_at',
            'designer_brand', 'product_type', 'final_product_name', 'research_sources',
            'research_source_links', 'source_reputation_score', 'researched_at',
            'seo_slug', 'cms_title', 'cms_body_html', 'meta_description',
            'faq_json_ld', 'product_json_ld', 'extracted_price',
            'webp_image_count', 'viewpoint_labels', 'optimized_at',
            'store_url', 'wc_product_id', 'published_at',
        }
        clean = {k: v for k, v in clean.items() if k in VALID_COLUMNS}

        if not clean:
            logger.warning(f'update_row called with no valid columns for {product_id}')
            return

        self.client.table(self.TABLE).update(clean).eq('product_id', product_id).execute()
        logger.info(f'Row updated: {product_id} — fields: {list(clean.keys())}')

    def update_status(self, product_id: str, status: str, notes: str = '') -> None:
        """
        Quick status-only update. Mirrors SheetsManager.update_status().
        product_id here accepts the _row_number alias (which is product_id).
        """
        logger.info(f"Updating status → '{status}' for {product_id}")
        payload: Dict[str, Any] = {'status': status}
        if notes:
            payload['notes'] = notes
        self.client.table(self.TABLE).update(payload).eq('product_id', product_id).execute()

    def try_claim_row(self, product_id: str, from_status: str, to_status: str) -> bool:
        """
        Atomically claim a row for processing by transitioning its status.
        Conditional on the row still being in from_status — safe against concurrent instances.
        Returns True if claimed, False if already taken by another instance.
        """
        result = (
            self.client.table(self.TABLE)
            .update({'status': to_status})
            .eq('product_id', product_id)
            .eq('status', from_status)
            .execute()
        )
        claimed = bool(result.data)
        if claimed:
            logger.info(f'Claimed {product_id}: {from_status} → {to_status}')
        else:
            logger.warning(f'Could not claim {product_id} (status no longer {from_status}) — skipping')
        return claimed

    def append_rows(self, rows_data: List[Dict[str, Any]]) -> int:
        """
        Insert multiple new product rows.
        Used by Agent 1 gallery discovery to add discovered album rows.
        Returns number of rows inserted.
        """
        if not rows_data:
            return 0

        logger.info(f'Inserting {len(rows_data)} new rows...')

        # Convert keys for each row
        clean_rows = []
        for row in rows_data:
            clean = {k: v for k, v in row.items() if not k.startswith('_')}
            clean_rows.append(clean)

        response = self.client.table(self.TABLE).insert(clean_rows).execute()
        inserted = len(response.data or [])
        logger.info(f'Inserted {inserted} rows')
        return inserted

    # ─────────────────────────────────────────────────────────────────────────
    # RUN SESSION OPERATIONS (new — powers the dashboard run history)
    # ─────────────────────────────────────────────────────────────────────────

    def create_run_session(self, agent: str, batch_limit: int = None) -> str:
        """
        Create a new run session record. Returns the session uuid.
        Call at the start of each agent run.
        """
        response = (
            self.client.table('run_sessions')
            .insert({
                'agent':       agent,
                'status':      'running',
                'batch_limit': batch_limit,
            })
            .execute()
        )
        session_id = response.data[0]['id']
        logger.info(f'Run session created: {session_id} (agent={agent})')
        return session_id

    def complete_run_session(
        self,
        session_id: str,
        succeeded: int,
        failed: int,
        attempted: int,
        error_summary: List[str] = None,
        tokens: int = 0,
        cost_usd: float = 0.0,
    ) -> None:
        """Mark a run session as completed with final stats."""
        from datetime import datetime, timezone
        ended = _now_iso()

        # Calculate duration from DB started_at
        session = (
            self.client.table('run_sessions')
            .select('started_at')
            .eq('id', session_id)
            .single()
            .execute()
        )
        duration = None
        if session.data:
            started = datetime.fromisoformat(session.data['started_at'])
            ended_dt = datetime.fromisoformat(ended)
            duration = int((ended_dt - started).total_seconds())

        self.client.table('run_sessions').update({
            'status':               'completed',
            'ended_at':             ended,
            'duration_seconds':     duration,
            'products_attempted':   attempted,
            'products_succeeded':   succeeded,
            'products_failed':      failed,
            'error_summary':        error_summary or [],
            'total_tokens':         tokens,
            'estimated_cost_usd':   round(cost_usd, 4),
        }).eq('id', session_id).execute()

        logger.info(
            f'Run session completed: {session_id} '
            f'({succeeded} ok, {failed} failed, {duration}s)'
        )

    def fail_run_session(self, session_id: str, error: str) -> None:
        """Mark a run session as failed."""
        self.client.table('run_sessions').update({
            'status':        'failed',
            'ended_at':      _now_iso(),
            'error_summary': [error],
        }).eq('id', session_id).execute()

    def log_event(
        self,
        session_id: str,
        message: str,
        product_id: str = None,
        agent: str = None,
        level: str = 'INFO',
    ) -> None:
        """
        Write a structured log event to pipeline_logs.
        Powers the live console and per-product timeline in the dashboard.
        """
        try:
            self.client.table('pipeline_logs').insert({
                'session_id': session_id,
                'product_id': product_id,
                'agent':      agent,
                'level':      level,
                'message':    message,
            }).execute()
        except Exception as exc:
            logger.warning(f'log_event failed (non-critical): {exc}')

    def check_stop_requested(self, session_id: str) -> bool:
        """Return True if a stop has been requested for this session via the dashboard."""
        try:
            result = (
                self.client.table('run_sessions')
                .select('stop_requested')
                .eq('id', session_id)
                .single()
                .execute()
            )
            return bool(result.data and result.data.get('stop_requested'))
        except Exception:
            return False

    def request_stop(self, agent: str) -> None:
        """Set stop_requested=True on the currently running session for an agent."""
        try:
            self.client.table('run_sessions').update({
                'stop_requested': True,
            }).eq('agent', agent).eq('status', 'running').execute()
        except Exception as exc:
            logger.warning(f'request_stop failed for {agent}: {exc}')
