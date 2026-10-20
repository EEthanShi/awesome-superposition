"""The curated reading list: config/reading_list.toml rendered for the README and the site."""

from __future__ import annotations

import json
import re
import tomllib
from pathlib import Path

START = "<!-- LIST:START -->"
END = "<!-- LIST:END -->"


def load(path: Path) -> list[dict]:
    return tomllib.loads(path.read_text(encoding="utf-8"))["section"]


def write_json(sections: list[dict], path: Path) -> None:
    path.write_text(json.dumps(sections, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


def _anchor(name: str) -> str:
    return re.sub(r"[^a-z0-9 -]", "", name.lower()).replace(" ", "-")


def update_readme(sections: list[dict], path: Path) -> None:
    lines = ["**Contents:** " + " · ".join(f"[{s['name']}](#{_anchor(s['name'])})" for s in sections), ""]
    for section in sections:
        lines += [f"### {section['name']}", "", f"*{section['description']}*", ""]
        for item in section["item"]:
            venue = f", {item['venue']}" if item.get("venue") else ""
            lines.append(f"- [{item['title']}]({item['url']}) ({item['authors']}, {item['year']}{venue}). "
                         f"{item['note']}")
        lines.append("")
    block = "\n".join(lines).rstrip()
    text = path.read_text(encoding="utf-8")
    head, _, rest = text.partition(START)
    _, _, tail = rest.partition(END)
    path.write_text(f"{head}{START}\n{block}\n{END}{tail}", encoding="utf-8")
