"""
Reusable HTTP client with session management, browser spoofing, and automatic retry backoff.
"""

import time
import logging
from typing import Optional, Dict, Any
import requests
from . import DEFAULT_HEADERS, REQUEST_TIMEOUT, RETRY_COUNT, RETRY_DELAY

logger = logging.getLogger("CommonHTTPClient")

class HttpClient:
    """Wrapper around requests.Session providing robust error handling and retries."""

    def __init__(self, headers: Optional[Dict[str, str]] = None, timeout: int = REQUEST_TIMEOUT):
        self.session = requests.Session()
        req_headers = DEFAULT_HEADERS.copy()
        if headers:
            req_headers.update(headers)
        self.session.headers.update(req_headers)
        self.timeout = timeout

    def get(self, url: str, params: Optional[Dict[str, Any]] = None, retries: int = RETRY_COUNT, delay: int = RETRY_DELAY) -> Optional[requests.Response]:
        """Performs a GET request with automatic retry on transient failures."""
        for attempt in range(1, retries + 1):
            try:
                response = self.session.get(url, params=params, timeout=self.timeout)
                if response.status_code == 200:
                    return response
                elif response.status_code == 404:
                    logger.warning(f"Resource not found (404): {url}")
                    return None
                else:
                    logger.warning(f"Attempt {attempt}/{retries} - Status {response.status_code} from {url}")
            except requests.exceptions.RequestException as e:
                logger.warning(f"Attempt {attempt}/{retries} failed for {url}: {e}")

            if attempt < retries:
                time.sleep(delay * attempt)

        logger.error(f"Failed to fetch {url} after {retries} attempts.")
        return None

    def post(self, url: str, data: Optional[Any] = None, json: Optional[Any] = None, retries: int = RETRY_COUNT, delay: int = RETRY_DELAY) -> Optional[requests.Response]:
        """Performs a POST request with retry handling."""
        for attempt in range(1, retries + 1):
            try:
                response = self.session.post(url, data=data, json=json, timeout=self.timeout)
                if response.status_code in (200, 201):
                    return response
                else:
                    logger.warning(f"Attempt {attempt}/{retries} - Status {response.status_code} from {url}")
            except requests.exceptions.RequestException as e:
                logger.warning(f"Attempt {attempt}/{retries} failed for {url}: {e}")

            if attempt < retries:
                time.sleep(delay * attempt)

        logger.error(f"Failed to post to {url} after {retries} attempts.")
        return None
