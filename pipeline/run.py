"""Daily update: crawl arXiv, classify, optionally summarize, and rebuild the outputs.

    python -m pipeline.run                    # the last 4 days (the daily job)
    python -m pipeline.run --since 2026-07-01 # backfill a range
    python -m pipeline.run --no-ai            # skip the optional AI step
    python -m pipeline.run --reclassify       # re-check stored papers after editing topics.toml
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import sys
from pathlib import Path

from . import arxiv, enrich, reading, render, store, topics

ROOT = Path(__file__).resolve().parent.parent


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--since", type=dt.date.fromisoformat, help="first submission date (UTC)")
    parser.add_argument("--until", type=dt.date.fromisoformat, help="last submission date (UTC)")
    parser.add_argument("--days", type=int, default=4, help="window length when --since is absent")
    parser.add_argument("--no-ai", action="store_true", help="skip the optional AI summaries")
    parser.add_argument("--ai-limit", type=int, default=300, help="maximum papers summarized per run")
    parser.add_argument("--reclassify", action="store_true",
                        help="re-check stored papers against the current topics instead of fetching")
    args = parser.parse_args()

    today = dt.datetime.now(dt.timezone.utc).date()
    until = args.until or today
    since = args.since or until - dt.timedelta(days=args.days - 1)

    config = topics.load(ROOT / "config" / "topics.toml")
    data_dir = ROOT / "data"
    papers = store.load_all(data_dir)
    if args.reclassify:
        print(f"Re-checking {len(papers)} stored papers against {len(config.topics)} topics", file=sys.stderr)
    else:
        print(f"Window {since} to {until}; {len(papers)} papers already stored", file=sys.stderr)

    fetched: dict[str, dict] = {}
    if args.reclassify:
        fetched = {pid: dict(p) for pid, p in papers.items()}
        papers = {}
    for topic in ([] if args.reclassify else config.topics):
        results = arxiv.search(topic.query, config.site["categories"], since, until)
        print(f"  {topic.slug:24s} {len(results):5d} returned", file=sys.stderr)
        for paper in results:
            fetched.setdefault(paper["id"], paper)

    added = updated = dropped = 0
    for paper_id, paper in fetched.items():
        paper["topics"], paper["score"] = topics.classify(paper, config)
        if not paper["topics"]:
            dropped += 1
            continue
        if paper_id in papers:
            if "ai" in papers[paper_id]:
                paper["ai"] = papers[paper_id]["ai"]
            updated += 1
        else:
            added += 1
        papers[paper_id] = paper
    if args.reclassify:
        print(f"{added} kept, {dropped} dropped by the local checks", file=sys.stderr)
    else:
        print(f"{added} new, {updated} refreshed, {dropped} dropped by the local checks", file=sys.stderr)

    if not args.no_ai and enrich.available():
        count = enrich.summarize(sorted(papers.values(), key=lambda p: p["published"], reverse=True),
                                 limit=args.ai_limit)
        print(f"AI summaries added: {count}", file=sys.stderr)

    generated_at = dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
    store.save_all(papers, data_dir)
    index = store.write_index(papers, config, data_dir, generated_at)
    render.write_feed(papers, config, ROOT / "feed.xml")
    render.update_readme(papers, config, index, ROOT / "README.md")
    sections = reading.load(ROOT / "config" / "reading_list.toml")
    reading.write_json(sections, data_dir / "reading_list.json")
    reading.update_readme(sections, ROOT / "README.md")
    stats = {"papers": index["total"], "curated": sum(len(s["item"]) for s in sections),
             "latest": index["latest_date"], "updated": generated_at[:10]}
    (data_dir / "stats.json").write_text(json.dumps(stats) + "\n", encoding="utf-8")
    print(f"Done: {index['total']} papers, latest {index['latest_date']}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
