"""
Collect lecture-slide links from eMed and write them to slides.json
(next to index.html). The site's script.js matches them to classes.js
by date + title and shows them in the event popover.

Only titles/dates/URLs are stored. The URLs still sit behind the eMed
login, so nobody can open the files without a UNSW account.
"""
import json
import os
import re
import sys
import time
from datetime import datetime
from urllib.parse import urljoin

import requests
from bs4 import BeautifulSoup

BASE = "https://emed.med.unsw.edu.au"
OUT = "slides.json"
ZID, PASSWORD = os.environ["ZID"], os.environ["ZPASS"]

TIME_RE = re.compile(r"\d{1,2}:\d{2}\s*[AP]M", re.I)
# /Map.nsf/wLAFByUniqueKey/<32-hex UNID>/$FILE/<name>.pdf/<name>.pdf
FILE_RE = re.compile(r"/wLAFByUniqueKey/([0-9A-F]{32})/\$FILE/([^/?#]+)", re.I)

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


def parse_time(t):
    """'09:00 AM' -> '09:00' (24h)"""
    return datetime.strptime(re.sub(r"\s+", " ", t.upper()), "%I:%M %p").strftime("%H:%M")


def popup_fields(popup):
    """Map each label cell in the popup to its value cell."""
    fields = {}
    for tr in popup.select("table tr"):
        tds = tr.find_all("td", recursive=False)
        if len(tds) == 2:
            label = tds[0].get_text(strip=True)
            if label:
                fields[label] = tds[1].get_text(" ", strip=True)
    return fields


def popup_date(popup, fields):
    hidden = popup.find("input", id="StartDateHTML")
    if hidden and hidden.get("value"):
        return datetime.strptime(hidden["value"], "%m/%d/%Y").strftime("%Y-%m-%d")
    return datetime.strptime(fields["Date"], "%d %B, %Y").strftime("%Y-%m-%d")


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

# ---- 2. event IDs from the scheduler's XML feed ----
feed = get(f"{BASE}/Timetable.NSF/XMLeventsUID.xml?OpenView&RestrictToCategory={ZID}")
event_ids = sorted(set(re.findall(r'id="?([0-9A-F]{32})', feed, flags=re.I)))  # adjust to real XML

if not event_ids:
    # Don't overwrite slides.json with nothing if login/parsing broke.
    sys.exit("No events found - login or feed parsing probably failed. "
             f"{OUT} left untouched.")
print(f"{len(event_ids)} events in timetable")

# ---- 3. popup -> Map page -> PDF link ----
existing = load_existing()
map_cache = {}
found, failed = {}, 0

for n, eid in enumerate(event_ids, 1):
    try:
        popup = BeautifulSoup(
            get(f"{BASE}/Timetable.NSF/0/{eid}?OpenDocument&AutoFramed&floatbar=false"),
            "html.parser")

        a = popup.find("a", string=re.compile("Link to this activity in the Map"))
        if not a:
            continue

        fields = popup_fields(popup)
        try:
            date_iso = popup_date(popup, fields)
            times = TIME_RE.findall(fields["Start Time/End Time"])
            start, end = parse_time(times[0]), parse_time(times[1])
        except (KeyError, IndexError, ValueError) as e:
            print(f"Skipping {eid}: could not read date/time ({e})")
            continue

        rec = {
            "date": date_iso,
            "start": start,
            "end": end,
            "title": fields.get("Title", ""),
            "type": fields.get("Activity Type", ""),
        }
        key = record_key(rec)

        if key in existing:                 # already have this link: no need to re-fetch
            continue

        url = map_file_url(a["href"], map_cache)
        if not url:
            continue                        # no file uploaded for this activity (yet)

        rec["url"] = url
        found[key] = rec
        print(f"[{n}/{len(event_ids)}] {rec['date']} {rec['title']}")

    except (requests.RequestException, OSError) as e:
        failed += 1
        print(f"[{n}/{len(event_ids)}] Skipping {eid}: {type(e).__name__}: {e}")

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
