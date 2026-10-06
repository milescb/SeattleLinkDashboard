"""Flask app: serves the dashboard and a small JSON API."""
from flask import Flask, jsonify

from . import config, gtfs_static, state

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
        history = list(state.history)
    return jsonify({
        **snap,
        "stats": state.summarize(snap["trains"]),
        "history": history,
        "settings": {"delay_s": config.DELAY_S, "at_station_s": config.AT_STATION_S,
                     "poll_s": config.POLL_SECONDS},
    })


def init():
    global static_data
    static_data = gtfs_static.load()
