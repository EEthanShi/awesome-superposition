"""Topic configuration, local relevance checks, and ranking."""

from __future__ import annotations

import re
import tomllib
from dataclasses import dataclass, field
from pathlib import Path


@dataclass
class Topic:
    slug: str
    name: str
    description: str
    query: str
    family: str = "broader"
    weight: float = 1.0
    require_any: list[re.Pattern] = field(default_factory=list)
    context_any: list[re.Pattern] = field(default_factory=list)
    exclude_any: list[re.Pattern] = field(default_factory=list)

    def matches(self, text: str) -> bool:
        if self.require_any and not any(p.search(text) for p in self.require_any):
            return False
        if self.context_any and not any(p.search(text) for p in self.context_any):
            return False
        return not any(p.search(text) for p in self.exclude_any)

    def in_title(self, title: str) -> bool:
        return any(p.search(title) for p in self.require_any)


@dataclass
class Config:
    site: dict
    topics: list[Topic]

    def topic(self, slug: str) -> Topic:
        return next(t for t in self.topics if t.slug == slug)


def _compile(patterns: list[str]) -> list[re.Pattern]:
    return [re.compile(p, re.IGNORECASE) for p in patterns]


def load(path: Path) -> Config:
    raw = tomllib.loads(path.read_text(encoding="utf-8"))
    exclusions = raw.get("exclusions", {})
    topics = []
    for t in raw["topic"]:
        excludes = list(t.get("exclude_any", []))
        if "exclude_from" in t:
            excludes += exclusions[t["exclude_from"]]
        topics.append(Topic(
            slug=t["slug"],
            name=t["name"],
            description=t.get("description", ""),
            query=t["query"],
            family=t.get("family", "broader"),
            weight=float(t.get("weight", 1)),
            require_any=_compile(t.get("require_any", [])),
            context_any=_compile(t.get("context_any", [])),
            exclude_any=_compile(excludes),
        ))
    return Config(site=raw["site"], topics=topics)


def classify(paper: dict, config: Config) -> tuple[list[str], float]:
    """Assign every topic whose local checks pass, and score the paper.

    A paper enters the crawl through one topic's arXiv query, but the arXiv search
    stems words and ignores context, so every topic is re-checked here on the title
    and abstract. A paper that passes no topic is dropped by the caller.
    """
    text = f"{paper['title']}\n{paper['abstract']}"
    kept, score = [], 0.0
    for topic in config.topics:
        if topic.matches(text):
            kept.append(topic.slug)
            score += topic.weight * (2 if topic.in_title(paper["title"]) else 1)
    return kept, score
