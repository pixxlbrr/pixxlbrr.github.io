"""
Collect lecture-slide links from eMed and write them to slides.json
(next to index.html). The site's script.js matches them to classes.js
by date + title and shows them in the event popover.

Only Lectures and Scenario Plenaries from the last 3 weekdays are checked.
Only titles/dates/URLs are stored. The URLs still sit behind the eMed
login, so nobody can open the files without a UNSW account.
"""
import html
import json
import os
import re
import sys
import time
from datetime import datetime, timedelta
from urllib.parse import urljoin
from zoneinfo import ZoneInfo

import requests
from bs4 import BeautifulSoup

BASE = "https://emed.med.unsw.edu.au"
OUT = "slides.json"
ZID, PASSWORD = os.environ["ZID"], os.environ["ZPASS"]

# Event types (first line of <text> in the XML feed) that we want links for
WANTED_TYPES = {"lecture", "scenario plenary"}

# /Map.nsf/wLAFByUniqueKey/<32-hex UNID>/$FILE/<name>.pdf/<name>.pdf
FILE_RE = re.compile(r"/wLAFByUniqueKey/([0-9A-F]{32})/\$FILE/([^/?#]+)", re.I)
EVENT_RE = re.compile(r'<event\b[^>]*?\bid=["\']?([0-9A-F]{32})["\']?[^>]*>(.*?)</event>', re.I | re.S)
DATETIME_RE = re.compile(r"(\d{4}-\d{2}-\d{2})[ T](\d{1,2}:\d{2})")
BR_RE = re.compile(r"<br\s*/?>|&lt;br\s*/?&gt;", re.I)

s = requests.Session()


def get(url, tries=4):
    """GET with a long read timeout and retries: eMed's Map pages are slow."""
    for attempt in range(1, tries + 1):
        try:
            r = s.get(url, timeout=(15, 120))   # (connect, read) seconds
            if r.status_code >= 500:
                raise requests.HTTPError(f"HTTP {r.status_code}")
            r.raise_for_status()
            return r.text
        except (requests.Timeout, requests.ConnectionError, requests.HTTPError) as e:
            if attempt == tries:
                raise
            wait = 5 * attempt
            print(f"  retry {attempt}/{tries - 1} in {wait}s ({type(e).__name__})")
            time.sleep(wait)


def tag(block, name):
    """Inner text of <name>...</name>, with any CDATA wrapper removed."""
    m = re.search(rf"<{name}\b[^>]*>(.*?)</{name}>", block, re.I | re.S)
    if not m:
        return ""
    return re.sub(r"^<!\[CDATA\[|\]\]>$", "", m.group(1).strip()).strip()


def parse_feed(xml):
    """XMLeventsUID.xml -> list of dicts (id, date, start, end, type, course, title).

    <text> is 'Type<br>Course<br>Title<br>Location<br>Campus'.
    Parsed with regexes because the feed can contain bare '&' characters,
    which a strict XML parser would reject."""
    events = []
    for eid, block in EVENT_RE.findall(xml):
        parts = [html.unescape(p).strip() for p in BR_RE.split(tag(block, "text"))]
        sm = DATETIME_RE.search(tag(block, "start_date"))
        em = DATETIME_RE.search(tag(block, "end_date"))
        if not sm or not em or len(parts) < 3:
            continue
        events.append({
            "id": eid,
            "date": sm.group(1),
            "start": sm.group(2).zfill(5),
            "end": em.group(2).zfill(5),
            "type": parts[0],
            "course": parts[1],
            "title": parts[2],
        })
    return events


def target_dates(today):
    """The current weekday plus the two weekdays before it (Mon-Fri only).
    On a weekend, that is the 3 most recent weekdays. Returns ISO date strings."""
    days, d = [], today
    while len(days) < 3:
        if d.weekday() < 5:             # 0=Mon ... 4=Fri
            days.append(d.strftime("%Y-%m-%d"))
        d -= timedelta(days=1)
    return set(days)


def stable_url(href):
    """Same URL style as the links already in classes.js:
    https://emed.../Map.nsf/by_unid/<UNID>/$FILE/<name>.pdf"""
    m = FILE_RE.search(href)
    if m:
        return f"{BASE}/Map.nsf/by_unid/{m.group(1).upper()}/$FILE/{m.group(2)}"
    return urljoin(BASE, href)


def record_key(r):
    return (r["date"], r["start"], r["title"])


def load_existing():
    try:
        with open(OUT, encoding="utf-8") as fh:
            return {record_key(r): r for r in json.load(fh)}
    except (FileNotFoundError, json.JSONDecodeError):
        return {}


def map_file_url(map_href, cache):
    """Fetch a Map page once and return its PDF url (None if no file)."""
    # popup links are http://; go straight to https to avoid a slow redirect
    map_url = urljoin(BASE, map_href).replace("http://", "https://", 1)
    if map_url not in cache:
        m = BeautifulSoup(get(map_url), "html.parser")
        f = m.select_one("#attach_url a[href*='$FILE']")
        cache[map_url] = stable_url(f["href"]) if f else None
        time.sleep(1)  # be gentle (only after a real request)
    return cache[map_url]


if __name__ == "__main__":
    # ---- 1. log in (same form fields as the eMed login page) ----
    login = s.post(f"{BASE}/names.nsf?Login",
                   data={"%%ModDate": "2E6D726F662D6469",
                         "Username": ZID,
                         "Password": PASSWORD,
                         "RedirectTo": "/homepage.nsf?Open"},
                   timeout=(15, 120))
    # A rejected login just serves the login form again.
    if 'name="Password"' in login.text:
        sys.exit("Login failed - eMed returned the login form again. "
                 "Check the ZID / ZPASS secrets.")

    # ---- 2. timetable feed -> filter by type and date ----
    feed = get(f"{BASE}/Timetable.NSF/XMLeventsUID.xml?OpenView&RestrictToCategory={ZID}")
    events = parse_feed(feed)
    if not events:
        # Don't overwrite slides.json with nothing if login/parsing broke.
        # Print the shape of the response (not credentials) to help debug.
        print(f"Feed length: {len(feed)} chars; '<event' appears {feed.lower().count('<event')} times")
        print("Feed starts with:", repr(feed[:300].replace(ZID, "<zid>")))
        sys.exit("No events parsed from the feed - login or parsing probably failed. "
                 f"{OUT} left untouched.")

    ALL_DAYS = os.environ.get("ALL_DAYS", "").lower() in ("1", "true", "yes")
    today = datetime.now(ZoneInfo("Australia/Sydney")).date()
    wanted = None if ALL_DAYS else target_dates(today)

    todo = [e for e in events
            if e["type"].lower() in WANTED_TYPES
            and (wanted is None or e["date"] in wanted)]
    print(f"{len(events)} events in timetable; {len(todo)} are "
          f"Lecture/Scenario Plenary on "
          f"{'any date' if wanted is None else ', '.join(sorted(wanted))}")

    # ---- 3. popup -> Map page -> PDF link (only for the events that passed) ----
    existing = load_existing()
    map_cache = {}
    found, failed = {}, 0

    for n, ev in enumerate(todo, 1):
        key = record_key(ev)
        if key in existing:             # already have this link: no need to re-fetch
            continue
        try:
            popup = BeautifulSoup(
                get(f"{BASE}/Timetable.NSF/0/{ev['id']}?OpenDocument&AutoFramed&floatbar=false"),
                "html.parser")
            a = popup.find("a", string=re.compile("Link to this activity in the Map"))
            if not a:
                continue

            url = map_file_url(a["href"], map_cache)
            if not url:
                continue                # no file uploaded for this activity (yet)

            found[key] = {k: ev[k] for k in ("date", "start", "end", "title", "type")}
            found[key]["url"] = url
            print(f"[{n}/{len(todo)}] {ev['date']} {ev['type']}: {ev['title']}")

        except (requests.RequestException, OSError) as e:
            failed += 1
            print(f"[{n}/{len(todo)}] Skipping {ev['id']}: {type(e).__name__}: {e}")

    # ---- 4. merge with what we already had, so a partial run never deletes links ----
    merged = dict(existing)
    merged.update(found)
    results = sorted(merged.values(), key=lambda r: (r["date"], r["start"], r["title"]))

    with open(OUT, "w", encoding="utf-8") as fh:
        json.dump(results, fh, indent=2, ensure_ascii=False)
        fh.write("\n")

    print(f"{len(found)} new links this run, {failed} events skipped after errors, "
          f"{len(results)} total in {OUT}")
    if failed and not found and not existing:
        sys.exit("Every request failed - eMed may be down or blocking this runner.")
