"""
HolloEngine Telegram Notifier
Sends pipeline status updates to a Telegram chat via Bot API.
Set TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env to enable.
Silently skips if not configured.
"""
import logging
import os
from typing import Optional

import requests

logger = logging.getLogger(__name__)

LEVEL_EMOJI = {
    'success': '\u2705',
    'error':   '\u274c',
    'warning': '\u26a0\ufe0f',
    'info':    '\u2139\ufe0f',
}


def notify(
    message: str,
    level: str = 'info',
    product_id: Optional[str] = None,
    store_url: Optional[str] = None,
) -> None:
    """
    Post a notification to Telegram.

    Args:
        message:    Main message text.
        level:      'success' | 'error' | 'warning' | 'info'
        product_id: Optional product ID for context.
        store_url:  Optional live store URL (shown as link).
    """
    token   = os.getenv('TELEGRAM_BOT_TOKEN', '').strip()
    chat_id = os.getenv('TELEGRAM_CHAT_ID', '').strip()
    if not token or not chat_id:
        return  # Not configured — silently skip

    emoji = LEVEL_EMOJI.get(level, '\u2139\ufe0f')
    lines = [f'{emoji} <b>HolloEngine</b> \u2014 {message}']

    if product_id:
        lines.append(f'<code>{product_id}</code>')
    if store_url:
        lines.append(f'<a href="{store_url}">View on Store</a>')

    text = '\n'.join(lines)

    try:
        resp = requests.post(
            f'https://api.telegram.org/bot{token}/sendMessage',
            json={
                'chat_id':    chat_id,
                'text':       text,
                'parse_mode': 'HTML',
            },
            timeout=5,
        )
        resp.raise_for_status()
    except Exception as exc:
        logger.warning(f'[Telegram] Failed to send notification: {exc}')


def notify_agent_start(agent_name: str, count: int) -> None:
    notify(f'{agent_name} started \u2014 processing {count} product(s)', level='info')


def notify_agent_complete(agent_name: str, processed: int, failed: int = 0) -> None:
    if failed:
        notify(
            f'{agent_name} completed \u2014 {processed} processed, {failed} failed',
            level='warning',
        )
    else:
        notify(
            f'{agent_name} completed \u2014 {processed} product(s) processed',
            level='success',
        )


def notify_error(agent_name: str, error: str, product_id: Optional[str] = None) -> None:
    notify(
        f'{agent_name} encountered an error: {error}',
        level='error',
        product_id=product_id,
    )


def notify_product_live(product_name: str, product_id: str, store_url: str) -> None:
    notify(
        f'<b>{product_name}</b> is now LIVE on the store!',
        level='success',
        product_id=product_id,
        store_url=store_url,
    )


def notify_needs_review(product_id: str, brand: str, product_type: str) -> None:
    notify(
        f'Product needs your review \u2014 {brand} {product_type}',
        level='warning',
        product_id=product_id,
    )
