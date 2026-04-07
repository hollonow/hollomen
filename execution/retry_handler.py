#!/usr/bin/env python3
"""
RETRY HANDLER: Resilient error handling for batch processing.
Implements automatic retries with exponential backoff and error categorization.
"""

import logging
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Callable, Optional, Any, List
import requests
from requests.exceptions import RequestException, Timeout, ConnectionError

logger = logging.getLogger(__name__)


class ErrorCategory(Enum):
    """Categorization of errors for handling strategy."""
    TRANSIENT = "transient"      # Network issues, rate limits - worth retrying
    PERMANENT = "permanent"      # Invalid data, missing fields - won't help to retry
    UNKNOWN = "unknown"          # Uncategorized errors


@dataclass
class RetryResult:
    """Result of a retry-wrapped operation."""
    success: bool
    result: Any = None
    error: Optional[Exception] = None
    error_category: ErrorCategory = ErrorCategory.UNKNOWN
    attempts: int = 0
    error_message: str = ""


@dataclass
class RetryStats:
    """Statistics for retry operations in a batch."""
    total_retries: int = 0
    successful_after_retry: int = 0
    failed_after_retry: int = 0
    transient_errors: int = 0
    permanent_errors: int = 0
    errors_by_type: dict = field(default_factory=dict)

    def record_error(self, error_type: str, category: ErrorCategory):
        """Record an error occurrence."""
        self.errors_by_type[error_type] = self.errors_by_type.get(error_type, 0) + 1
        if category == ErrorCategory.TRANSIENT:
            self.transient_errors += 1
        elif category == ErrorCategory.PERMANENT:
            self.permanent_errors += 1


# ============================================================================
# ERROR CATEGORIZATION
# ============================================================================

# Transient errors - worth retrying
TRANSIENT_ERROR_PATTERNS = [
    # Network errors
    "timeout", "timed out", "connection refused", "connection reset",
    "connection error", "network unreachable", "temporary failure",
    "ssl error", "certificate", "handshake",
    # Rate limiting
    "rate limit", "too many requests", "429", "quota exceeded",
    "throttl", "slow down",
    # Server errors
    "500", "502", "503", "504", "internal server error",
    "bad gateway", "service unavailable", "gateway timeout",
    # API errors
    "api error", "temporarily unavailable", "try again",
    # Google Drive specific
    "user rate limit", "sharing rate limit", "upload rate limit",
]

# Permanent errors - no point retrying
PERMANENT_ERROR_PATTERNS = [
    # Authentication
    "401", "403", "unauthorized", "forbidden", "invalid credentials",
    "authentication failed", "access denied",
    # Not found
    "404", "not found", "does not exist", "no such file",
    # Invalid data
    "invalid", "malformed", "parse error", "json decode",
    "missing required", "validation error",
    # Resource issues
    "file too large", "quota full", "storage limit",
    # Playwright/browser
    "element not found", "selector", "no such element",
]


def categorize_error(error: Exception) -> ErrorCategory:
    """
    Categorize an exception as transient or permanent.

    Args:
        error: The exception to categorize

    Returns:
        ErrorCategory indicating if retry is worthwhile
    """
    error_str = str(error).lower()
    error_type = type(error).__name__.lower()

    # Check for known transient error types
    if isinstance(error, (Timeout, ConnectionError)):
        return ErrorCategory.TRANSIENT

    # Check error message patterns
    for pattern in TRANSIENT_ERROR_PATTERNS:
        if pattern in error_str or pattern in error_type:
            return ErrorCategory.TRANSIENT

    for pattern in PERMANENT_ERROR_PATTERNS:
        if pattern in error_str or pattern in error_type:
            return ErrorCategory.PERMANENT

    # Default to unknown (will retry but with caution)
    return ErrorCategory.UNKNOWN


def format_error_for_notes(error: Exception, category: ErrorCategory, attempts: int) -> str:
    """
    Format an error message for the Notes column in Google Sheets.

    Args:
        error: The exception
        category: Error categorization
        attempts: Number of attempts made

    Returns:
        Formatted error string for sheet storage
    """
    error_type = type(error).__name__
    error_msg = str(error)[:150]  # Truncate long messages

    category_label = {
        ErrorCategory.TRANSIENT: "[TRANSIENT]",
        ErrorCategory.PERMANENT: "[PERMANENT]",
        ErrorCategory.UNKNOWN: "[UNKNOWN]",
    }.get(category, "[UNKNOWN]")

    return f"{category_label} {error_type}: {error_msg} (attempts: {attempts})"


# ============================================================================
# RETRY DECORATOR AND FUNCTION
# ============================================================================

def with_retry(
    func: Callable,
    max_retries: int = 3,
    base_delay: float = 1.0,
    max_delay: float = 30.0,
    retry_on_unknown: bool = True,
    operation_name: str = "operation"
) -> RetryResult:
    """
    Execute a function with automatic retry on transient errors.

    Args:
        func: The function to execute (should take no arguments - use lambda/partial)
        max_retries: Maximum number of retry attempts (default: 3)
        base_delay: Initial delay between retries in seconds (default: 1.0)
        max_delay: Maximum delay between retries in seconds (default: 30.0)
        retry_on_unknown: Whether to retry on unknown error categories (default: True)
        operation_name: Name for logging purposes

    Returns:
        RetryResult with success status, result/error, and attempt count
    """
    last_error = None
    last_category = ErrorCategory.UNKNOWN

    for attempt in range(1, max_retries + 2):  # +1 for initial attempt, +1 for range
        try:
            result = func()

            if attempt > 1:
                logger.info(f"[RETRY] {operation_name} succeeded on attempt {attempt}")

            return RetryResult(
                success=True,
                result=result,
                attempts=attempt
            )

        except Exception as e:
            last_error = e
            last_category = categorize_error(e)

            # Log the error
            logger.warning(
                f"[RETRY] {operation_name} failed (attempt {attempt}/{max_retries + 1}): "
                f"{type(e).__name__}: {str(e)[:100]}"
            )
            logger.warning(f"[RETRY] Error category: {last_category.value}")

            # Check if we should retry
            should_retry = (
                attempt <= max_retries and
                (last_category == ErrorCategory.TRANSIENT or
                 (last_category == ErrorCategory.UNKNOWN and retry_on_unknown))
            )

            if not should_retry:
                if last_category == ErrorCategory.PERMANENT:
                    logger.error(f"[RETRY] Permanent error - not retrying: {e}")
                elif attempt > max_retries:
                    logger.error(f"[RETRY] Max retries ({max_retries}) exceeded")
                break

            # Calculate delay with exponential backoff
            delay = min(base_delay * (2 ** (attempt - 1)), max_delay)
            logger.info(f"[RETRY] Waiting {delay:.1f}s before retry...")
            time.sleep(delay)

    # All retries exhausted or permanent error
    return RetryResult(
        success=False,
        error=last_error,
        error_category=last_category,
        attempts=attempt if 'attempt' in dir() else 1,
        error_message=format_error_for_notes(last_error, last_category, attempt if 'attempt' in dir() else 1)
    )


class RetryableOperation:
    """
    Context manager for retryable operations with statistics tracking.

    Usage:
        with RetryableOperation(stats, "scrape product", max_retries=3) as op:
            result = op.execute(lambda: miner.process_product(url))
            if result.success:
                # handle success
            else:
                # handle failure
    """

    def __init__(
        self,
        stats: Optional[RetryStats] = None,
        operation_name: str = "operation",
        max_retries: int = 3,
        base_delay: float = 1.0,
        max_delay: float = 30.0
    ):
        self.stats = stats or RetryStats()
        self.operation_name = operation_name
        self.max_retries = max_retries
        self.base_delay = base_delay
        self.max_delay = max_delay
        self._result: Optional[RetryResult] = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        pass

    def execute(self, func: Callable) -> RetryResult:
        """Execute the operation with retry logic."""
        self._result = with_retry(
            func,
            max_retries=self.max_retries,
            base_delay=self.base_delay,
            max_delay=self.max_delay,
            operation_name=self.operation_name
        )

        # Update statistics
        if self._result.attempts > 1:
            self.stats.total_retries += self._result.attempts - 1

            if self._result.success:
                self.stats.successful_after_retry += 1
            else:
                self.stats.failed_after_retry += 1

        if not self._result.success and self._result.error:
            error_type = type(self._result.error).__name__
            self.stats.record_error(error_type, self._result.error_category)

        return self._result
