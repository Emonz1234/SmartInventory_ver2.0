"""Timezone utilities for Vietnam (UTC+7)"""
from datetime import datetime, timezone, timedelta
from typing import Optional


# Vietnam timezone (UTC+7)
VIETNAM_TZ = timezone(timedelta(hours=7))


def get_current_time() -> datetime:
    """Get current time in Vietnam timezone (UTC+7)
    
    Returns:
        datetime: Current time in UTC+7 as timezone-aware datetime
    """
    return datetime.now(VIETNAM_TZ)


def get_current_time_utc() -> datetime:
    """Get current UTC time (for database storage if needed)
    
    Returns:
        datetime: Current UTC time
    """
    return datetime.now(timezone.utc)


def format_datetime(dt: Optional[datetime], fmt: str = "%Y-%m-%d %H:%M:%S") -> str:
    """Format datetime to string with Vietnam timezone
    
    Args:
        dt: datetime object to format
        fmt: format string (default: YYYY-MM-DD HH:MM:SS)
    
    Returns:
        str: Formatted datetime string
    """
    if dt is None:
        return ""
    
    # Convert to Vietnam timezone if needed
    if dt.tzinfo is None:
        # Assume naive datetimes from the DB are already in Vietnam local time
        dt = dt.replace(tzinfo=VIETNAM_TZ)
    
    dt_vn = dt.astimezone(VIETNAM_TZ)
    return dt_vn.strftime(fmt)


def to_vietnam_timezone(dt: Optional[datetime]) -> Optional[datetime]:
    """Convert datetime to Vietnam timezone
    
    Args:
        dt: datetime object to convert
    
    Returns:
        datetime: Datetime in Vietnam timezone (UTC+7)
    """
    if dt is None:
        return None
    
    if dt.tzinfo is None:
        # Assume naive datetimes from the DB are already in Vietnam local time
        dt = dt.replace(tzinfo=VIETNAM_TZ)
    
    return dt.astimezone(VIETNAM_TZ)
