#!/usr/bin/env python3
"""CCF Conference Deadline Crawler.

The *producer* of conferences.sqlite — reads the current DB, checks due
conferences, fetches their homepage, asks DeepSeek v4-flash (no thinking)
to extract CFP info, and atomically updates the sqlite + manifest.

Usage:
    uv run --project scripts/conf_crawler python scripts/conf_crawler/crawl.py
    # or with the test venv:
    python scripts/conf_crawler/crawl.py --limit 5
    python scripts/conf_crawler/crawl.py --dry-run

Environment:
    DEEPSEEK_API_KEY   (required)
    DEEPSEEK_BASE_URL  (default: https://api.deepseek.com)
    DEEPSEEK_MODEL     (default: deepseek-v4-flash)
"""
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import sqlite3
import sys
import time
from datetime import date, datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any

import httpx
from openai import OpenAI

REPO_ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = REPO_ROOT / "backend" / "data" / "conferences"
SQLITE_PATH = DATA_DIR / "conferences.sqlite"
MANIFEST_PATH = DATA_DIR / "manifest.json"

UNANNOUNCED_DAYS = 1
ANNOUNCED_DAYS = 5
FETCH_TIMEOUT = 15
API_MAX_TOKENS = 2000
PAGE_MAX_CHARS = 6000
INTER_CALL_SLEEP = 1.0

SYSTEM_PROMPT = (
    "You extract conference Call-for-Papers information from webpage text. "
    "Return ONLY a valid JSON object, nothing else."
)

USER_PROMPT_TEMPLATE = """\
Conference: {abbr} ({name_full})
Target edition: {target_year}

Webpage text (may be truncated):
---
{page_text}
---

Extract a JSON object with these fields:
- found: boolean — true if any CFP / deadline info was found on this page
- deadline: string|null — full paper submission deadline as "YYYY-MM-DD" (pick the latest/main track deadline if multiple)
- cycle: string|null — which year/edition, e.g. "2027"
- location: string|null — venue city + country, e.g. "Tokyo, Japan"
- conf_date: string|null — conference dates, e.g. "2027-03-07 ~ 03-11"
- homepage: string|null — the canonical conference URL if visible
- confidence: float — 0.0 to 1.0, how confident you are
- note: string|null — brief note (e.g. "abstract deadline 2 weeks earlier", "rolling review")
- submissions: integer|null — total submissions count if mentioned
- accepted: integer|null — accepted papers count if mentioned
- acceptance_rate: float|null — acceptance rate as percentage if mentioned (e.g. 23.6)

Only extract what the page text explicitly contains. Do not guess or hallucinate dates."""


class _TextExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self._parts: list[str] = []
        self._skip = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in ("script", "style", "noscript", "svg"):
            self._skip = True

    def handle_endtag(self, tag: str) -> None:
        if tag in ("script", "style", "noscript", "svg"):
            self._skip = False

    def handle_data(self, data: str) -> None:
        if not self._skip:
            self._parts.append(data)

    def get_text(self) -> str:
        return re.sub(r"\s+", " ", " ".join(self._parts)).strip()


def _html_to_text(html: str) -> str:
    ex = _TextExtractor()
    ex.feed(html)
    return ex.get_text()


def _fetch_page(url: str) -> str | None:
    """Fetch a URL and return extracted text, or None on failure."""
    try:
        r = httpx.get(
            url,
            timeout=FETCH_TIMEOUT,
            follow_redirects=True,
            headers={"User-Agent": "Mozilla/5.0 (compatible; ConfCrawler/0.1)"},
        )
        if r.status_code >= 400:
            return None
        text = _html_to_text(r.text)
        if len(text) < 50:
            return None
        return text[:PAGE_MAX_CHARS]
    except (httpx.HTTPError, Exception):
        return None


def _ask_deepseek(
    client: OpenAI,
    model: str,
    conf: dict[str, Any],
    page_text: str,
) -> dict[str, Any] | None:
    """Call DeepSeek to extract CFP info from page text."""
    prompt = USER_PROMPT_TEMPLATE.format(
        abbr=conf["abbr"],
        name_full=conf["name_full"],
        target_year=conf.get("target_year") or date.today().year,
        page_text=page_text,
    )
    try:
        resp = client.chat.completions.create(
            model=model,
            messages=[
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            response_format={"type": "json_object"},
            temperature=0,
            max_tokens=API_MAX_TOKENS,
        )
        raw = resp.choices[0].message.content or ""
        if not raw.strip():
            return None
        return json.loads(raw)
    except (json.JSONDecodeError, Exception) as e:
        print(f"  ⚠ DeepSeek error for {conf['abbr']}: {e}")
        return None


def _derive_state(deadline: str | None, today: date) -> str:
    if not deadline:
        return "unannounced"
    try:
        if date.fromisoformat(deadline) < today:
            return "closed"
    except ValueError:
        return "unannounced"
    return "announced"


def _next_check(state: str, now: str) -> str | None:
    if state == "closed":
        return None
    delta = UNANNOUNCED_DAYS if state == "unannounced" else ANNOUNCED_DAYS
    dt = datetime.fromisoformat(now) + timedelta(days=delta)
    return dt.isoformat(timespec="seconds").replace("+00:00", "Z")


def _select_due(conn: sqlite3.Connection, now_iso: str, limit: int | None) -> list[dict]:
    sql = (
        "SELECT id, abbr, name_full, field, tier, homepage, cycle, "
        "       deadline, crawl_state, target_year "
        "FROM conferences "
        "WHERE crawl_state != 'closed' AND next_check_at IS NOT NULL AND next_check_at <= ? "
        "ORDER BY next_check_at ASC"
    )
    if limit:
        sql += f" LIMIT {limit}"
    rows = conn.execute(sql, (now_iso,)).fetchall()
    cols = [d[0] for d in conn.execute(sql, (now_iso,)).description] if rows else []
    if not rows:
        return []
    cols = [d[0] for d in conn.execute(
        "SELECT id, abbr, name_full, field, tier, homepage, cycle, "
        "       deadline, crawl_state, target_year "
        "FROM conferences LIMIT 0"
    ).description]
    return [dict(zip(cols, r)) for r in rows]


def _update_row(conn: sqlite3.Connection, conf_id: str, extracted: dict, now_iso: str, today: date) -> str:
    """Apply extracted data to the row. Returns the new crawl_state."""
    deadline = extracted.get("deadline") or None
    new_state = _derive_state(deadline, today)
    conn.execute(
        """UPDATE conferences SET
            homepage = COALESCE(?, homepage),
            cycle = COALESCE(?, cycle),
            location = COALESCE(?, location),
            conf_date = COALESCE(?, conf_date),
            deadline = COALESCE(?, deadline),
            note = COALESCE(?, note),
            submissions = COALESCE(?, submissions),
            accepted = COALESCE(?, accepted),
            acceptance_rate = COALESCE(?, acceptance_rate),
            confidence = ?,
            source_url = ?,
            crawl_state = ?,
            last_checked_at = ?,
            next_check_at = ?
        WHERE id = ?""",
        (
            extracted.get("homepage"),
            extracted.get("cycle"),
            extracted.get("location"),
            extracted.get("conf_date"),
            deadline,
            extracted.get("note"),
            extracted.get("submissions"),
            extracted.get("accepted"),
            extracted.get("acceptance_rate"),
            extracted.get("confidence"),
            extracted.get("source_url"),
            new_state,
            now_iso,
            _next_check(new_state, now_iso),
            conf_id,
        ),
    )
    return new_state


def _write_manifest(conn: sqlite3.Connection) -> None:
    count = conn.execute("SELECT COUNT(*) FROM conferences").fetchone()[0]
    raw = SQLITE_PATH.read_bytes()
    manifest = {
        "schema_version": 1,
        "exported_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "claw_version": "crawler-0.1.0",
        "conferences_sqlite_sha256": hashlib.sha256(raw).hexdigest(),
        "conferences_sqlite_bytes": len(raw),
        "counts": {"conferences": count},
    }
    MANIFEST_PATH.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", "utf-8")


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="conf-crawler")
    p.add_argument("--dry-run", action="store_true", help="show due confs but skip API + DB writes")
    p.add_argument("--limit", type=int, default=None, help="max conferences to process per run")
    p.add_argument("--api-key", default=os.environ.get("DEEPSEEK_API_KEY", ""))
    p.add_argument("--base-url", default=os.environ.get("DEEPSEEK_BASE_URL", "https://api.deepseek.com"))
    p.add_argument("--model", default=os.environ.get("DEEPSEEK_MODEL", "deepseek-v4-flash"))
    args = p.parse_args(argv)

    if not args.api_key and not args.dry_run:
        print("✗ DEEPSEEK_API_KEY not set and not --dry-run")
        return 1
    if not SQLITE_PATH.exists():
        print(f"✗ {SQLITE_PATH} not found — run seed_conferences.py first")
        return 1

    today = date.today()
    now_iso = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    conn = sqlite3.connect(SQLITE_PATH)

    due = _select_due(conn, now_iso, args.limit)
    print(f"due: {len(due)} conferences (of 230)")
    if not due:
        print("nothing to do")
        conn.close()
        return 0

    if args.dry_run:
        for c in due:
            print(f"  [dry] {c['abbr']:20s}  state={c['crawl_state']:12s}  homepage={c.get('homepage') or '—'}")
        conn.close()
        return 0

    client = OpenAI(base_url=args.base_url, api_key=args.api_key)
    updated = 0
    skipped = 0

    for i, c in enumerate(due):
        abbr = c["abbr"]
        homepage = c.get("homepage")
        print(f"[{i+1}/{len(due)}] {abbr} ...", end=" ", flush=True)

        page_text = _fetch_page(homepage) if homepage else None
        if page_text:
            print(f"fetched {len(page_text)} chars →", end=" ", flush=True)
        else:
            page_text = f"(No webpage content available for {abbr}. Please answer based on your knowledge of this conference if possible, otherwise set found=false.)"
            print("no page →", end=" ", flush=True)

        extracted = _ask_deepseek(client, args.model, c, page_text)
        if not extracted:
            print("skip (API error)")
            skipped += 1
            time.sleep(INTER_CALL_SLEEP)
            continue

        found = extracted.get("found", False)
        if found:
            new_state = _update_row(conn, c["id"], extracted, now_iso, today)
        else:
            conn.execute(
                "UPDATE conferences SET last_checked_at=?, next_check_at=? WHERE id=?",
                (now_iso, _next_check(c["crawl_state"], now_iso), c["id"]),
            )
            new_state = c["crawl_state"]

        dl = extracted.get("deadline") or "—"
        conf = extracted.get("confidence", 0)
        print(f"{'✓' if found else '○'} dl={dl} conf={conf:.1f} → {new_state}")
        updated += 1
        time.sleep(INTER_CALL_SLEEP)

    conn.commit()
    _write_manifest(conn)
    conn.close()

    print(f"\ndone: {updated} updated, {skipped} skipped")
    print(f"manifest: {MANIFEST_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
