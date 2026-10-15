import logging
import os
import sys
import threading

_booted = False


def boot() -> None:
    """Load static GTFS, open the history DB, start the OBA poller.

    Call exactly once per process, in the worker (not before fork). See
    deploy/DEPLOY.md: gunicorn runs a single worker with no --preload, because
    the poller thread and its in-memory snapshot are what /api/live serves.
    """
    global _booted
    if _booted:  # guards against a double import starting two pollers -> OBA 429
        return
    from . import app, config, db, state

    if not config.OBA_KEY:
        sys.exit("Set OBA_KEY (your OneBusAway Puget Sound API key), e.g. `OBA_KEY=... uv run seattletransit`")
    logging.basicConfig(level=logging.INFO)
    app.init()
    db.init()
    threading.Thread(target=state.run_forever, daemon=True).start()
    _booted = True


def main() -> None:
    boot()
    from . import app

    app.app.run(host="127.0.0.1", port=int(os.environ.get("PORT", 5001)))
