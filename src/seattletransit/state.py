"""Background poller: latest snapshot and stats; each poll's stats go to db.py."""
import logging
import re
import statistics
import threading
import time
from urllib.parse import quote, quote_plus

from . import config, db, oba

log = logging.getLogger(__name__)

_KEY_PARAM = re.compile(r"key=[^&\s\"']+")

HIST_BINS = list(range(-2, 11))  # minutes; first bin is "<= -2", last is ">= 10"

lock = threading.Lock()  # ponytail: one global lock, fine for a single-process dashboard
snapshot = {"trains": [], "alerts": [], "updated": 0, "error": None}


def _on_time(d):
    return config.ON_TIME_EARLY_S <= d <= config.ON_TIME_LATE_S


def _group(trains):
    delays = [t["delay"] for t in trains]
    return {
        "count": len(trains),
        "on_time_pct": round(100 * sum(map(_on_time, delays)) / len(delays), 1) if delays else None,
        "avg_delay": round(statistics.mean(delays)) if delays else None,
        "median_delay": round(statistics.median(delays)) if delays else None,
    }


def summarize(trains):
    """Aggregate stats. Only trains with realtime predictions count toward delay stats."""
    live = [t for t in trains if t["predicted"]]
    hist = [0] * len(HIST_BINS)
    for t in live:
        m = max(HIST_BINS[0], min(HIST_BINS[-1], int(t["delay"] // 60)))
        hist[m - HIST_BINS[0]] += 1
    return {
        "in_service": len(trains),
        "all": _group(live),
        "routes": {rid: _group([t for t in live if t["route"] == rid]) for rid in config.ROUTES},
        "worst": sorted(live, key=lambda t: t["delay"], reverse=True)[:5],
        "hist": {"bins": HIST_BINS, "counts": hist},
    }


def _record(stats):
    """Persist this poll's stats. Lines with no realtime trains (not running) are skipped by db.insert."""
    now = int(time.time())
    groups = {"all": stats["all"], **stats["routes"]}
    db.insert([{"ts": now, "route": rid, **{k: g[k] for k in db.STATS}} for rid, g in groups.items()])


def poll_once():
    trains = []
    for rid in config.ROUTES:
        trains += oba.fetch_trains(rid)
        time.sleep(config.REQUEST_GAP_SECONDS)
    alerts = oba.fetch_alerts(set(config.ROUTES))
    with lock:
        snapshot.update(trains=trains, alerts=alerts, updated=time.time(), error=None)
    _record(summarize(trains))


def _redact(msg: str) -> str:
    """Strip the API key out of upstream error text before it reaches /api/live.

    oba.py sends the key via requests' `params=`, so it comes back percent-encoded inside
    str(e) (+ / = -> %2B %2F %3D) and a plain str.replace(raw_key) would miss those forms
    and publish the key to every visitor. Drop the whole key= query param, then any
    leftover raw/encoded occurrence.
    """
    key = config.OBA_KEY
    if not key:
        return msg
    msg = _KEY_PARAM.sub("key=***", msg)
    for form in {key, quote(key), quote_plus(key)}:
        msg = msg.replace(form, "***")
    return msg


def run_forever():
    failures = 0
    while True:
        try:
            poll_once()
            failures = 0
        except Exception as e:  # keep last good snapshot, surface the error in the UI
            failures += 1
            msg = _redact(str(e))  # URLs carry the key
            log.warning("poll failed (%d in a row): %s", failures, msg)
            with lock:
                snapshot["error"] = msg
        time.sleep(min(config.POLL_SECONDS * 2 ** failures, config.MAX_BACKOFF_SECONDS))
