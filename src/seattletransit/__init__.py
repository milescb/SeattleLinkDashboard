import logging
import os
import sys
import threading


def main() -> None:
    from . import app, config, state

    if not config.OBA_KEY:
        sys.exit("Set OBA_KEY (your OneBusAway Puget Sound API key), e.g. `OBA_KEY=... uv run seattletransit`")
    logging.basicConfig(level=logging.INFO)
    app.init()
    state.load_history()
    threading.Thread(target=state.run_forever, daemon=True).start()
    app.app.run(host="127.0.0.1", port=int(os.environ.get("PORT", 5000)))
