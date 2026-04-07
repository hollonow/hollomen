#!/usr/bin/env python3
"""
AGENT 0 ORCHESTRATOR: The Apprentice (Calibration)
Wraps KnowledgeBaseBuilder for dashboard dispatch.
Run: cd execution && python run_calibrator.py [--force]
  --force  Rebuild attribute_matrix.json even if it already exists
"""

import logging
import os
import sys
from datetime import datetime
from pathlib import Path

from dotenv import load_dotenv

# ── Logging ──────────────────────────────────────────────────────────────────
log_dir = Path(__file__).parent.parent / 'logs'
log_dir.mkdir(exist_ok=True)

logging.basicConfig(
    handlers=[
        logging.FileHandler(log_dir / 'calibrator_run_calibrator.log', encoding='utf-8'),
        logging.StreamHandler(sys.stdout),
    ],
    format='[AGENT_0] [%(asctime)s] [%(levelname)s] %(message)s',
    level=logging.INFO,
)
logger = logging.getLogger(__name__)

# ── Imports ───────────────────────────────────────────────────────────────────
from supabase_manager import SupabaseManager
from build_knowledge_base import KnowledgeBaseBuilder


def main() -> None:
    load_dotenv()

    openai_api_key = os.getenv('OPENAI_API_KEY')
    if not openai_api_key:
        logger.error('OPENAI_API_KEY not found in environment. Add it to your .env file.')
        sys.exit(1)

    force = '--force' in sys.argv
    logger.info(f'Starting calibration (force={force})')

    db = SupabaseManager()
    session_id: str | None = None

    try:
        session_id = db.create_run_session('agent0')

        db.log_event(session_id, 'Starting calibration...', agent='agent0')
        builder = KnowledgeBaseBuilder(openai_api_key)
        builder.build_matrix(force=force)

        db.complete_run_session(session_id, succeeded=1, failed=0, attempted=1)
        db.log_event(session_id, 'CALIBRATION COMPLETE', agent='agent0')
        logger.info('CALIBRATION COMPLETE')

    except Exception as e:
        logger.error(f'Calibration failed: {e}')
        if session_id:
            try:
                db.complete_run_session(
                    session_id, succeeded=0, failed=1, attempted=1,
                    errors=[str(e)[:200]],
                )
            except Exception:
                pass
        raise


if __name__ == '__main__':
    main()
