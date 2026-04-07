"""
HolloEngine Slack Notifier
Sends pipeline status updates to a Slack channel via Incoming Webhook.
Set SLACK_WEBHOOK_URL in .env to enable. Silently skips if not configured.
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
    Post a notification to Slack.

    Args:
        message:    Main message text.
        level:      'success' | 'error' | 'warning' | 'info'
        product_id: Optional product ID for context.
        store_url:  Optional live store URL (shown as link).
    """
    webhook_url = os.getenv('SLACK_WEBHOOK_URL', '').strip()
    if not webhook_url:
        return  # Not configured - silently skip

    emoji = LEVEL_EMOJI.get(level, '\u2139\ufe0f')
    lines = [f'{emoji} *HolloEngine* \u2014 {message}']

    if product_id:
        lines.append(f'> Product: `{product_id}`')
    if store_url:
        lines.append(f'> Live: <{store_url}|View on Store>')

    text = '\n'.join(lines)

    try:
        resp = requests.post(
            webhook_url,
            json={'text': text},
            timeout=5,
        )
        resp.raise_for_status()
    except Exception as exc:
        logger.warning(f'[Slack] Failed to send notification: {exc}')


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
        f'*{product_name}* is now LIVE on the store!',
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
