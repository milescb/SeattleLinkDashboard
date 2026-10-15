"""Flask app: serves the dashboard and a small JSON API."""
import datetime as dt

from flask import Flask, abort, jsonify, request

from . import config, db, gtfs_static, state

app = Flask(__name__, static_folder="static", static_url_path="")
static_data = None  # filled in by main()


@app.get("/")
def index():
    return app.send_static_file("index.html")


@app.get("/api/static")
def api_static():
    return jsonify({**static_data, "carto_key": config.CARTO_KEY})


@app.get("/api/live")
def api_live():
    with state.lock:
        snap = dict(state.snapshot)
    return jsonify({
        **snap,
        "stats": state.summarize(snap["trains"]),
        "settings": {"delay_s": config.DELAY_S, "at_station_s": config.AT_STATION_S,
                     "poll_s": config.POLL_SECONDS},
    })


@app.get("/api/history")
def api_history():
    """?days=N (last N service days, incl. today) or ?start=YYYY-MM-DD&end=YYYY-MM-DD."""
    today = db.today()
    try:
        if "start" in request.args:
            start = dt.date.fromisoformat(request.args["start"])
            end = dt.date.fromisoformat(request.args.get("end") or today.isoformat())
        else:
            end = today
            start = end - dt.timedelta(days=max(1, min(int(request.args.get("days", 7)), 3660)) - 1)
    except ValueError:
        abort(400)
    if start > end:
        start, end = end, start
    return jsonify(db.history(start.isoformat(), end.isoformat()))


def init():
    global static_data
    static_data = gtfs_static.load()
