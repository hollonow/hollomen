"""
HolloEngine Unified Notifier
Dispatches to all configured channels (Slack + Telegram).
Import from here instead of individual notifier modules.
"""
from typing import Optional

from notifiers.slack_notifier import (
    notify_agent_start     as _slack_agent_start,
    notify_agent_complete  as _slack_agent_complete,
    notify_error           as _slack_error,
    notify_product_live    as _slack_product_live,
    notify_needs_review    as _slack_needs_review,
)
from notifiers.telegram_notifier import (
    notify_agent_start     as _tg_agent_start,
    notify_agent_complete  as _tg_agent_complete,
    notify_error           as _tg_error,
    notify_product_live    as _tg_product_live,
    notify_needs_review    as _tg_needs_review,
)


def notify_agent_start(agent_name: str, count: int) -> None:
    _slack_agent_start(agent_name, count)
    _tg_agent_start(agent_name, count)


def notify_agent_complete(agent_name: str, processed: int, failed: int = 0) -> None:
    _slack_agent_complete(agent_name, processed, failed)
    _tg_agent_complete(agent_name, processed, failed)


def notify_error(agent_name: str, error: str, product_id: Optional[str] = None) -> None:
    _slack_error(agent_name, error, product_id)
    _tg_error(agent_name, error, product_id)


def notify_product_live(product_name: str, product_id: str, store_url: str) -> None:
    _slack_product_live(product_name, product_id, store_url)
    _tg_product_live(product_name, product_id, store_url)


def notify_needs_review(product_id: str, brand: str, product_type: str) -> None:
    _slack_needs_review(product_id, brand, product_type)
    _tg_needs_review(product_id, brand, product_type)
