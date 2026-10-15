"""SQLite store for per-poll delay stats, plus the aggregate queries behind /api/history.

Each row carries its Seattle-local service day, minute of day and weekday, computed at insert
time, so every aggregate is a plain GROUP BY (no timezone math in SQL, DST-safe).
"""
import contextlib
import csv
import datetime as dt
import logging
import sqlite3
from zoneinfo import ZoneInfo

from . import config

log = logging.getLogger(__name__)

TZ = ZoneInfo(config.TIMEZONE)
STATS = ["count", "on_time_pct", "avg_delay", "median_delay"]
SCHEMA = """
CREATE TABLE IF NOT EXISTS samples (
    ts           INTEGER NOT NULL,  -- unix seconds
    route        TEXT    NOT NULL,  -- route id, or 'all'
    day          TEXT    NOT NULL,  -- local service day, YYYY-MM-DD (rolls over at SERVICE_DAY_START_HOUR)
    tod          INTEGER NOT NULL,  -- local minute of day, 0..1439
    dow          INTEGER NOT NULL,  -- service-day weekday, 0 = Monday
    count        INTEGER NOT NULL,  -- trains with realtime predictions
    on_time_pct  REAL    NOT NULL,
    avg_delay    REAL    NOT NULL,
    median_delay REAL,
    PRIMARY KEY (ts, route)
);
CREATE INDEX IF NOT EXISTS samples_day ON samples (day);
"""
SERIES_BUCKETS = [60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600]  # seconds
MAX_SERIES_POINTS = 800


def _path():
    return config.DATA_DIR / "history.db"


@contextlib.contextmanager
def connect():
    """New connection per use (the poller thread writes, request threads read); commits and closes."""
    con = sqlite3.connect(_path(), timeout=10)
    con.row_factory = sqlite3.Row
    try:
        with con:
            yield con
    finally:
        con.close()


def service_day(when: dt.datetime) -> dt.date:
    return (when - dt.timedelta(hours=config.SERVICE_DAY_START_HOUR)).date()


def _local(ts):
    t = dt.datetime.fromtimestamp(ts, TZ)
    d = service_day(t)
    return d.isoformat(), t.hour * 60 + t.minute, d.weekday()


def init():
    """Create the schema; on first run, import the old data/history.csv (minus no-service rows)."""
    config.DATA_DIR.mkdir(parents=True, exist_ok=True)
    with connect() as con:
        con.execute("PRAGMA journal_mode=WAL")
        con.executescript(SCHEMA)
        empty = con.execute("SELECT 1 FROM samples LIMIT 1").fetchone() is None
    legacy = config.DATA_DIR / "history.csv"
    if empty and legacy.exists():
        with legacy.open() as f:
            rows = [{**r, "median_delay": None} for r in csv.DictReader(f)]
        n = insert(rows)
        legacy.rename(legacy.with_suffix(".csv.imported"))
        log.info("imported %d of %d rows from %s", n, len(rows), legacy)


def insert(rows):
    """Insert stat rows ({ts, route, count, on_time_pct, avg_delay, median_delay}).

    Rows with no realtime trains are dropped: when a line isn't running there is nothing to record.
    Returns how many rows were kept.
    """
    keep = [r for r in rows if r["count"] not in (None, "", 0, "0") and r["on_time_pct"] not in (None, "")]
    with connect() as con:
        con.executemany(
            "INSERT OR REPLACE INTO samples VALUES (?,?,?,?,?,?,?,?,?)",
            [(int(float(r["ts"])), r["route"], *_local(int(float(r["ts"]))), int(r["count"]),
              float(r["on_time_pct"]), float(r["avg_delay"]),
              None if r.get("median_delay") in (None, "") else float(r["median_delay"]))
             for r in keep])
    return len(keep)


def today():
    return service_day(dt.datetime.now(TZ))


def _weighted(col):
    # samples with more trains in service count for more
    return f"ROUND(SUM({col} * count) / SUM(count), 1) AS {col}"


AGG = f"{_weighted('on_time_pct')}, {_weighted('avg_delay')}, ROUND(AVG(count), 1) AS count"


def history(start: str, end: str):
    """All history views for service days start..end (inclusive, YYYY-MM-DD)."""
    with connect() as con:
        first = con.execute("SELECT MIN(day) FROM samples").fetchone()[0]
    if first and start < first:  # "all" asks from 2000-01-01; don't plot years of nothing
        start = min(first, end)
    span_s = ((dt.date.fromisoformat(end) - dt.date.fromisoformat(start)).days + 1) * 86400
    bucket = next((b for b in SERIES_BUCKETS if span_s / b <= MAX_SERIES_POINTS), SERIES_BUCKETS[-1])
    rng = "WHERE day BETWEEN ? AND ?"
    args = (start, end)

    def q(sql, *extra):
        with connect() as con:
            return [dict(r) for r in con.execute(sql, (*extra, *args))]

    return {
        "start": start, "end": end, "first": first, "today": today().isoformat(),
        "bucket_s": bucket, "tod_bucket_min": config.TOD_BUCKET_MIN,
        "summary": q(f"SELECT route, {AGG}, COUNT(DISTINCT day) AS days FROM samples {rng} GROUP BY route"),
        "series": q(f"SELECT (ts / ?) * ? AS ts, route, {AGG} FROM samples {rng} GROUP BY 1, route ORDER BY 1",
                    bucket, bucket),
        "by_day": q(f"SELECT day, route, {AGG} FROM samples {rng} GROUP BY day, route ORDER BY day"),
        "by_tod": q(f"SELECT (tod / ?) * ? AS tod, route, {AGG} FROM samples {rng} GROUP BY 1, route ORDER BY 1",
                    config.TOD_BUCKET_MIN, config.TOD_BUCKET_MIN),
        "by_dow": q(f"SELECT dow, route, {AGG} FROM samples {rng} GROUP BY dow, route ORDER BY dow"),
        "heat": q(f"SELECT day, tod / 60 AS hour, {AGG} FROM samples {rng} AND route = 'all' "
                  "GROUP BY day, hour ORDER BY day"),
    }
