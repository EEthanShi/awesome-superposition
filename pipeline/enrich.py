"""Optional AI layer: a one-sentence summary and a relevance grade for each paper.

Runs only when ANTHROPIC_API_KEY is set (a repository secret in GitHub Actions).
Every failure is contained: a paper that cannot be summarized keeps its record, and
the site shows its abstract instead, so the daily list never depends on this step.
"""

from __future__ import annotations

import json
import os
import sys
import time

DEFAULT_MODEL = "claude-opus-5-5"

SYSTEM = """You triage new arXiv papers for a public daily digest on feature superposition \
and mechanistic interpretability. For the paper you are given, return:

- tldr: one plain-English sentence of at most 35 words saying what the paper shows, \
proves, or proposes. Name the concrete object or result. Do not start with "This paper", \
and do not use promotional words.
- relevance: an integer grade.
  3 = about superposition, polysemanticity, feature recovery (sparse autoencoders, \
transcoders, dictionary learning), or the geometry of features in neural networks.
  2 = mechanistic interpretability of neural networks more broadly (circuits, probing \
with causal tests, steering, attribution).
  1 = uses interpretability tools or vocabulary only in passing.
  0 = unrelated; the keywords matched by coincidence (for example quantum superposition \
or video transcoding).
- keywords: two to four short lowercase keywords.

Judge only from the title and abstract."""

SCHEMA = {
    "type": "object",
    "properties": {
        "tldr": {"type": "string"},
        "relevance": {"type": "integer", "enum": [0, 1, 2, 3]},
        "keywords": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["tldr", "relevance", "keywords"],
    "additionalProperties": False,
}


def available() -> bool:
    return bool(os.environ.get("ANTHROPIC_API_KEY"))


def summarize(papers: list[dict], limit: int) -> int:
    """Add an `ai` field to up to `limit` papers that lack one. Returns the count added."""
    import anthropic

    model = os.environ.get("SUPERPOSITION_DAILY_MODEL", DEFAULT_MODEL)
    client = anthropic.Anthropic(max_retries=4)
    added = 0
    for paper in [p for p in papers if "ai" not in p][:limit]:
        content = f"Title: {paper['title']}\n\nAbstract: {paper['abstract']}"
        try:
            response = client.beta.messages.create(
                model=model,
                max_tokens=4000,
                betas=["server-side-fallback-2026-07-01"],
                fallbacks="default",
                system=SYSTEM,
                output_config={"effort": "low", "format": {"type": "json_schema", "schema": SCHEMA}},
                messages=[{"role": "user", "content": content}],
            )
        except (anthropic.AuthenticationError, anthropic.PermissionDeniedError,
                anthropic.NotFoundError, anthropic.BadRequestError) as error:
            print(f"  AI step stopped (configuration error): {error}", file=sys.stderr)
            break
        except anthropic.RateLimitError as error:
            wait = int(error.response.headers.get("retry-after", "30"))
            print(f"  rate limited; waiting {wait}s", file=sys.stderr)
            time.sleep(wait)
            continue
        except (anthropic.APIStatusError, anthropic.APIConnectionError) as error:
            print(f"  skipped {paper['id']}: {error}", file=sys.stderr)
            continue

        if response.stop_reason == "refusal":
            print(f"  skipped {paper['id']}: declined", file=sys.stderr)
            continue
        text = next((b.text for b in response.content if b.type == "text"), None)
        if not text:
            continue
        try:
            data = json.loads(text)
        except json.JSONDecodeError:
            continue
        paper["ai"] = {
            "tldr": data["tldr"].strip(),
            "relevance": int(data["relevance"]),
            "keywords": [k.strip().lower() for k in data["keywords"]][:4],
            "model": response.model,
        }
        added += 1
    return added
