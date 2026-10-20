"""Minimal arXiv API client (standard library only).

The arXiv API asks clients to wait about three seconds between requests, so every
request goes through `_get`, which enforces that delay and retries transient failures.
"""

from __future__ import annotations

import datetime as dt
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET

API_URL = "https://export.arxiv.org/api/query"
PAGE_SIZE = 200
DELAY_SECONDS = 3.2
USER_AGENT = "superposition-daily (https://github.com/; arXiv API client)"

ATOM = "{http://www.w3.org/2005/Atom}"
ARXIV = "{http://arxiv.org/schemas/atom}"

_last_request = 0.0


def _get(params: dict, attempts: int = 4) -> bytes:
    global _last_request
    url = API_URL + "?" + urllib.parse.urlencode(params)
    for attempt in range(1, attempts + 1):
        wait = DELAY_SECONDS - (time.monotonic() - _last_request)
        if wait > 0:
            time.sleep(wait)
        _last_request = time.monotonic()
        try:
            request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=120) as response:
                return response.read()
        except (urllib.error.URLError, TimeoutError) as error:
            print(f"  arXiv request failed ({error}); attempt {attempt}/{attempts}", file=sys.stderr)
            time.sleep(10 * attempt)
    raise RuntimeError(f"arXiv API unreachable after {attempts} attempts: {url}")


def _text(node, tag: str) -> str:
    found = node.find(tag)
    return " ".join(found.text.split()) if found is not None and found.text else ""


def _parse_entry(entry) -> dict:
    raw_id = _text(entry, ATOM + "id")
    arxiv_id = raw_id.split("/abs/")[-1]
    base_id, _, version = arxiv_id.rpartition("v")
    if not base_id or not version.isdigit():
        base_id = arxiv_id
    primary = entry.find(ARXIV + "primary_category")
    return {
        "id": base_id,
        "title": _text(entry, ATOM + "title"),
        "abstract": _text(entry, ATOM + "summary"),
        "authors": [_text(a, ATOM + "name") for a in entry.findall(ATOM + "author")],
        "published": _text(entry, ATOM + "published")[:10],
        "updated": _text(entry, ATOM + "updated")[:10],
        "primary_category": primary.get("term") if primary is not None else "",
        "categories": [c.get("term") for c in entry.findall(ATOM + "category") if c.get("term")],
        "comment": _text(entry, ARXIV + "comment"),
    }


def search(query: str, categories: list[str], start: dt.date, end: dt.date) -> list[dict]:
    """Return every paper submitted in [start, end] (UTC dates) that matches `query`."""
    cats = " OR ".join(f"cat:{c}" for c in categories)
    window = f"submittedDate:[{start:%Y%m%d}0000 TO {end:%Y%m%d}2359]"
    full_query = f"({query}) AND ({cats}) AND {window}"
    papers: list[dict] = []
    offset = 0
    while True:
        payload = _get({
            "search_query": full_query,
            "start": offset,
            "max_results": PAGE_SIZE,
            "sortBy": "submittedDate",
            "sortOrder": "descending",
        })
        root = ET.fromstring(payload)
        entries = root.findall(ATOM + "entry")
        for entry in entries:
            if "/api/errors" in _text(entry, ATOM + "id"):
                raise RuntimeError(f"arXiv API rejected the query: {_text(entry, ATOM + 'summary')}")
            papers.append(_parse_entry(entry))
        if len(entries) < PAGE_SIZE:
            return papers
        offset += PAGE_SIZE
