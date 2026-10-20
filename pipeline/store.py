"""Paper storage: one JSON file per submission month, plus a small index for the site."""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

from .topics import Config


def _sort_key(paper: dict):
    return (paper["published"], paper["score"], paper["id"])


def load_all(data_dir: Path) -> dict[str, dict]:
    papers: dict[str, dict] = {}
    for path in sorted((data_dir / "papers").glob("*.json")):
        for paper in json.loads(path.read_text(encoding="utf-8")):
            papers[paper["id"]] = paper
    return papers


def save_all(papers: dict[str, dict], data_dir: Path) -> None:
    by_month: dict[str, list[dict]] = {}
    for paper in papers.values():
        by_month.setdefault(paper["published"][:7], []).append(paper)
    out = data_dir / "papers"
    out.mkdir(parents=True, exist_ok=True)
    for month, items in by_month.items():
        items.sort(key=_sort_key, reverse=True)
        text = json.dumps(items, ensure_ascii=False, indent=1)
        (out / f"{month}.json").write_text(text + "\n", encoding="utf-8")


def write_index(papers: dict[str, dict], config: Config, data_dir: Path, generated_at: str) -> dict:
    months = Counter(p["published"][:7] for p in papers.values())
    days = Counter(p["published"] for p in papers.values())
    topic_counts = Counter(t for p in papers.values() for t in p["topics"])
    index = {
        "generated_at": generated_at,
        "site": {k: config.site[k] for k in ("title", "tagline", "repo", "site_url")},
        "total": len(papers),
        "with_ai": sum(1 for p in papers.values() if "ai" in p),
        "latest_date": max(days) if days else None,
        "months": [{"month": m, "count": months[m], "file": f"papers/{m}.json"}
                   for m in sorted(months, reverse=True)],
        "days": dict(sorted(days.items(), reverse=True)),
        "topics": [{"slug": t.slug, "name": t.name, "description": t.description,
                    "family": t.family, "count": topic_counts.get(t.slug, 0)} for t in config.topics],
    }
    (data_dir / "index.json").write_text(
        json.dumps(index, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    return index
