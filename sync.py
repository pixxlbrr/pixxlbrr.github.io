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


def get(url):
    r = s.get(url, timeout=30)
    r.raise_for_status()
    return r.text


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


# ---- 1. log in (same form fields as the eMed login page) ----
login = s.post(f"{BASE}/names.nsf?Login",
               data={"%%ModDate": "2E6D726F662D6469",
                     "Username": ZID,
                     "Password": PASSWORD,
                     "RedirectTo": "/homepage.nsf?Open"},
               timeout=30)
# A rejected login just serves the login form again.
if 'name="Password"' in login.text:
    sys.exit("Login failed - eMed returned the login form again. "
             "Check the ZID / ZPASS secrets.")

# ---- 2. event IDs from the scheduler's XML feed ----
feed = get(f"{BASE}/Timetable.NSF/XMLeventsUID.xml?OpenView&RestrictToCategory={ZID}")
event_ids = set(re.findall(r'id="?([0-9A-F]{32})', feed, flags=re.I))  # adjust to real XML

if not event_ids:
    # Don't overwrite slides.json with nothing if login/parsing broke.
    sys.exit("No events found - login or feed parsing probably failed. "
             f"{OUT} left untouched.")

# ---- 3. popup -> Map page -> PDF link ----
found = {}
for eid in event_ids:
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

    m = BeautifulSoup(get(urljoin(BASE, a["href"])), "html.parser")
    f = m.select_one("#attach_url a[href*='$FILE']")
    if not f:
        continue  # no file uploaded for this activity (yet)

    rec = {
        "date": date_iso,
        "start": start,
        "end": end,
        "title": fields.get("Title", ""),
        "type": fields.get("Activity Type", ""),
        "url": stable_url(f["href"]),
    }
    found[record_key(rec)] = rec
    time.sleep(1)  # be gentle

# ---- 4. merge with what we already had, so a partial run never deletes links ----
merged = load_existing()
merged.update(found)
results = sorted(merged.values(), key=lambda r: (r["date"], r["start"], r["title"]))

with open(OUT, "w", encoding="utf-8") as fh:
    json.dump(results, fh, indent=2, ensure_ascii=False)
    fh.write("\n")

print(f"{len(found)} links found this run, {len(results)} in {OUT}")
