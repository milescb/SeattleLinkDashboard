"""Background poller: latest snapshot, stats and delay history."""
import csv
import logging
import statistics
import threading
import time

from . import config, oba

log = logging.getLogger(__name__)

HIST_BINS = list(range(-2, 11))  # minutes; first bin is "<= -2", last is ">= 10"
HISTORY_FIELDS = ["ts", "route", "count", "on_time_pct", "avg_delay"]

lock = threading.Lock()  # ponytail: one global lock, fine for a single-process dashboard
snapshot = {"trains": [], "alerts": [], "updated": 0, "error": None}
history = []  # rows of HISTORY_FIELDS


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


def _history_path():
    return config.DATA_DIR / "history.csv"


def load_history():
    path = _history_path()
    if not path.exists():
        return
    cutoff = time.time() - config.HISTORY_HOURS * 3600
    with path.open() as f:
        rows = [r for r in csv.DictReader(f) if float(r["ts"]) >= cutoff]
    with lock:
        history[:] = rows


def _record(stats):
    now = int(time.time())
    rows = [{"ts": now, "route": "all", **{k: stats["all"][k] for k in HISTORY_FIELDS[2:]}}]
    rows += [{"ts": now, "route": rid, **{k: g[k] for k in HISTORY_FIELDS[2:]}} for rid, g in stats["routes"].items()]
    path = _history_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    new = not path.exists()
    with path.open("a", newline="") as f:  # ponytail: grows forever, prune/rotate if it ever matters
        w = csv.DictWriter(f, HISTORY_FIELDS)
        if new:
            w.writeheader()
        w.writerows(rows)
    cutoff = now - config.HISTORY_HOURS * 3600
    with lock:
        history[:] = [r for r in history if float(r["ts"]) >= cutoff] + rows


def poll_once():
    trains, alerts = [], []
    for rid in config.ROUTES:
        trains += oba.fetch_trains(rid)
        time.sleep(config.REQUEST_GAP_SECONDS)
    alerts = oba.fetch_alerts(set(config.ROUTES))
    with lock:
        snapshot.update(trains=trains, alerts=alerts, updated=time.time(), error=None)
    _record(summarize(trains))


def run_forever():
    failures = 0
    while True:
        try:
            poll_once()
            failures = 0
        except Exception as e:  # keep last good snapshot, surface the error in the UI
            failures += 1
            msg = str(e).replace(config.OBA_KEY, "***") if config.OBA_KEY else str(e)  # URLs carry the key
            log.warning("poll failed (%d in a row): %s", failures, msg)
            with lock:
                snapshot["error"] = msg
        time.sleep(min(config.POLL_SECONDS * 2 ** failures, config.MAX_BACKOFF_SECONDS))
