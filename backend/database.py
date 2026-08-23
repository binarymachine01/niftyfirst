"""
Database Connection Manager and Query Utilities with connection pooling.
"""

import logging
from contextlib import contextmanager
from typing import List, Dict, Any, Optional
import psycopg2
from psycopg2 import pool
from psycopg2.extras import RealDictCursor

try:
    from backend.config import DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, DATABASE_URL
except ImportError:
    from .config import DB_HOST, DB_PORT, DB_NAME, DB_USER, DB_PASSWORD, DATABASE_URL

logger = logging.getLogger(__name__)

_pool: Optional[pool.SimpleConnectionPool] = None


def get_db_pool() -> pool.SimpleConnectionPool:
    """Initializes or returns the psycopg2 connection pool."""
    global _pool
    if _pool is None or _pool.closed:
        if DATABASE_URL:
            _pool = pool.SimpleConnectionPool(minconn=1, maxconn=20, dsn=DATABASE_URL)
        else:
            _pool = pool.SimpleConnectionPool(
                minconn=1,
                maxconn=20,
                host=DB_HOST,
                port=DB_PORT,
                dbname=DB_NAME,
                user=DB_USER,
                password=DB_PASSWORD,
            )
    return _pool


@contextmanager
def get_db_cursor(commit: bool = False):
    """Context manager for executing database queries using connection pool."""
    p = get_db_pool()
    conn = p.getconn()
    try:
        with conn.cursor(cursor_factory=RealDictCursor) as cur:
            yield cur
        if commit:
            conn.commit()
    except Exception as e:
        if commit:
            conn.rollback()
        logger.error(f"Database query error: {e}", exc_info=True)
        raise
    finally:
        p.putconn(conn)


def fetch_all(query: str, params: tuple = ()) -> List[Dict[str, Any]]:
    """Executes SELECT query and returns all rows as list of dicts."""
    with get_db_cursor() as cur:
        cur.execute(query, params)
        return [dict(row) for row in cur.fetchall()]


def fetch_one(query: str, params: tuple = ()) -> Optional[Dict[str, Any]]:
    """Executes SELECT query and returns single row or None."""
    with get_db_cursor() as cur:
        cur.execute(query, params)
        row = cur.fetchone()
        return dict(row) if row else None
