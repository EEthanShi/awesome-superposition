"""Static outputs built from the stored papers: the RSS feed and the README digest."""

from __future__ import annotations

import datetime as dt
from email.utils import format_datetime
from pathlib import Path
from xml.sax.saxutils import escape

from .topics import Config

README_START = "<!-- DAILY:START -->"
README_END = "<!-- DAILY:END -->"


def _ranked_recent(papers: dict[str, dict], limit: int) -> list[dict]:
    items = sorted(papers.values(), key=lambda p: (p["published"], p["score"]), reverse=True)
    return items[:limit]


def _visible(paper: dict) -> bool:
    """Hide papers the optional AI grader marked as unrelated keyword matches."""
    return paper.get("ai", {}).get("relevance", 1) > 0


def write_feed(papers: dict[str, dict], config: Config, path: Path, limit: int = 100) -> None:
    site = config.site
    names = {t.slug: t.name for t in config.topics}
    items = []
    for paper in [p for p in _ranked_recent(papers, limit * 2) if _visible(p)][:limit]:
        published = dt.datetime.fromisoformat(paper["published"]).replace(tzinfo=dt.timezone.utc)
        summary = paper.get("ai", {}).get("tldr") or paper["abstract"]
        authors = ", ".join(paper["authors"][:6]) + (" et al." if len(paper["authors"]) > 6 else "")
        categories = "".join(f"<category>{escape(names.get(t, t))}</category>" for t in paper["topics"])
        items.append(
            "<item>"
            f"<title>{escape(paper['title'])}</title>"
            f"<link>https://arxiv.org/abs/{paper['id']}</link>"
            f"<guid isPermaLink=\"false\">arxiv:{paper['id']}</guid>"
            f"<pubDate>{format_datetime(published)}</pubDate>"
            f"<description>{escape(authors + '. ' + summary)}</description>"
            f"{categories}"
            "</item>"
        )
    now = format_datetime(dt.datetime.now(dt.timezone.utc))
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<rss version="2.0"><channel>'
        f"<title>{escape(site['title'])}</title>"
        f"<link>{escape(site['site_url'])}</link>"
        f"<description>{escape(site['tagline'])}</description>"
        f"<lastBuildDate>{now}</lastBuildDate>"
        + "".join(items) +
        "</channel></rss>\n"
    )
    path.write_text(xml, encoding="utf-8")


FAMILY_LABELS = {"theory": "Theory", "recovery": "Recovery methods", "broader": "Interpretability"}


def _short_date(iso: str) -> str:
    d = dt.date.fromisoformat(iso)
    return f"{d:%b}&nbsp;{d.day}"


def update_readme(papers: dict[str, dict], config: Config, index: dict, path: Path,
                  limit: int = 20) -> None:
    names = {t.slug: t.name for t in config.topics}
    site = config.site
    first = dt.date.fromisoformat(min(index["days"])) if index["days"] else None
    since = f" since {first.day} {first:%B %Y}" if first else ""
    lines = [
        f"**{index['total']} papers**{since} · updated {index['generated_at'][:10]} · "
        f"[search and filter them on the website]({site['site_url']}) · [RSS]({site['site_url']}feed.xml)",
        "",
        "| | Topics and papers |",
        "|:--|:--|",
    ]
    for family, label in FAMILY_LABELS.items():
        topics = [t for t in index["topics"] if t.get("family") == family]
        if topics:
            lines.append(f"| **{label}** | " + " · ".join(f"{t['name']} `{t['count']}`" for t in topics) + " |")
    lines += ["", "### Latest papers", "", "| Date | Paper | Topics |", "|:--|:--|:--|"]
    for paper in [p for p in _ranked_recent(papers, limit * 2) if _visible(p)][:limit]:
        title = paper["title"].replace("|", "\\|")
        topics = ", ".join(names.get(t, t) for t in paper["topics"])
        lines.append(f"| {_short_date(paper['published'])} | [{title}](https://arxiv.org/abs/{paper['id']}) "
                     f"| <sub>{topics}</sub> |")
    lines += ["", f"<sub>The other {max(0, index['total'] - limit)} papers are on [the website]({site['site_url']}), "
                  "with search and topic filters.</sub>"]
    block = "\n".join(lines)

    text = path.read_text(encoding="utf-8")
    head, _, rest = text.partition(README_START)
    _, _, tail = rest.partition(README_END)
    path.write_text(f"{head}{README_START}\n{block}\n{README_END}{tail}", encoding="utf-8")
