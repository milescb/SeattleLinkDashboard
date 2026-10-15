import datetime as dt

import pytest

from seattletransit import config, db, state


@pytest.fixture(autouse=True)
def tmp_db(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    db.init()
    return tmp_path


def local_ts(y, m, d, hh, mm=0):
    return int(dt.datetime(y, m, d, hh, mm, tzinfo=db.TZ).timestamp())


def rows(day):
    with db.connect() as con:
        return [dict(r) for r in con.execute("SELECT * FROM samples WHERE day = ? ORDER BY route", (day,))]


def test_lines_not_running_are_not_saved():
    stats = state.summarize([{"id": "a", "route": "100479", "delay": 30, "predicted": True},
                             {"id": "b", "route": "2LINE", "delay": 0, "predicted": False}])  # schedule-only
    state._record(stats)
    with db.connect() as con:
        saved = {r["route"] for r in con.execute("SELECT route FROM samples")}
    assert saved == {"all", "100479"}            # 2 Line had no realtime trains -> skipped

    state._record(state.summarize([]))           # nothing running at all -> nothing written
    with db.connect() as con:
        assert con.execute("SELECT COUNT(*) FROM samples").fetchone()[0] == 2


def test_service_day_rolls_over_at_3am():
    db.insert([{"ts": local_ts(2026, 10, 14, 0, 30), "route": "all", "count": 4, "on_time_pct": 50, "avg_delay": 10},
               {"ts": local_ts(2026, 10, 14, 5, 0), "route": "all", "count": 4, "on_time_pct": 100, "avg_delay": 0}])
    late, early = rows("2026-10-13"), rows("2026-10-14")
    assert late[0]["tod"] == 30 and late[0]["dow"] == 1     # Wed 00:30 belongs to Tuesday's service
    assert early[0]["tod"] == 300 and early[0]["dow"] == 2


def test_history_aggregates_weight_by_train_count():
    t = local_ts(2026, 10, 14, 8)
    db.insert([{"ts": t, "route": "all", "count": 30, "on_time_pct": 100, "avg_delay": 0},
               {"ts": t + 30, "route": "all", "count": 10, "on_time_pct": 60, "avg_delay": 120}])
    h = db.history("2000-01-01", "2026-10-14")
    assert h["start"] == "2026-10-14"            # clamped to the first day with data
    (s,) = h["summary"]
    assert s["on_time_pct"] == 90.0 and s["avg_delay"] == 30.0 and s["count"] == 20.0 and s["days"] == 1
    assert [r["hour"] for r in h["heat"]] == [8]
    assert h["by_dow"][0]["dow"] == 2


def test_imports_legacy_csv_without_empty_rows(tmp_path):
    (tmp_path / "history.db").unlink()
    (tmp_path / "history.csv").write_text(
        "ts,route,count,on_time_pct,avg_delay\n"
        "1791310107,all,51,98.0,77\n"
        "1791360523,2LINE,0,,\n")
    db.init()
    with db.connect() as con:
        assert con.execute("SELECT COUNT(*) FROM samples").fetchone()[0] == 1
    assert (tmp_path / "history.csv.imported").exists()
