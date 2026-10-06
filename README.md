# Link Control Room

Live dark-theme dashboard for Sound Transit's 1 Line and 2 Line: trains on a map (red = ≥3 min late, pulsing ring = late at a station), service alerts, and on-time / delay stats.

## Setup (once)

1. Install [uv](https://docs.astral.sh/uv/) (`brew install uv`).
2. Install dependencies from the repo root:
   ```sh
   uv sync
   ```
3. Get your keys:
   - `OBA_KEY` (required): a Puget Sound OneBusAway API key. Request one from `oba_api_key@soundtransit.org`.
   - `CARTO_KEY` (optional): a CARTO basemap key. Without it, the map uses keyless Esri dark-gray tiles.

## Start

Run in the foreground from the repo root:

```sh
OBA_KEY=<your key> CARTO_KEY=<your key> uv run seattletransit
```

Then open **http://127.0.0.1:5000**. Use `PORT=8080 ...` for a different port.

To avoid typing the keys every time, put them in your shell profile (`~/.zshrc`):

```sh
export OBA_KEY=<your key>
export CARTO_KEY=<your key>
```

After that, start it with just `uv run seattletransit`.

On the first start, the server downloads the static rail GTFS (a few seconds). Live trains appear after the first poll, which takes about 10 s. If OneBusAway rate-limits the key (HTTP 429), the page keeps showing the last good data. The status dot in the header turns red, and the server retries with growing waits of up to 5 minutes.

### Run in the background (optional)

```sh
nohup uv run seattletransit > server.log 2>&1 &
```

## Stop

- **Foreground:** press `Ctrl+C` in that terminal.
- **Background:**
  ```sh
  pkill -f "bin/seattletransit"
  ```
  To stop whatever is on the port instead: `kill $(lsof -ti :5000)`.

## Where to edit

| What | File |
|---|---|
| Colors, fonts, basemap style | `src/seattletransit/static/css/theme.css` |
| Layout / panel sizes | `src/seattletransit/static/css/layout.css` |
| Lines shown, poll rate, delay & on-time thresholds | `src/seattletransit/config.py` |
| API calls | `src/seattletransit/oba.py` |
| Stats / history | `src/seattletransit/state.py` |
| Map, alerts, charts | `src/seattletransit/static/js/{map,alerts,stats}.js` |

Frontend changes (HTML/CSS/JS) take effect after a browser refresh. Python changes need a restart.

## Data

- Positions and schedule deviation come from OBA `trips-for-route`. Alerts come from the GTFS-RT alerts feed.
- Shapes and stations come from the static rail GTFS, cached in `data/static.json`. Delete that file to rebuild it.
- Delay history is appended to `data/history.csv`, and the last 24 h are loaded on start. Delete the file to reset the history.

## Other commands

- Tests: `uv run pytest`
- Notebook dependencies: `uv sync --group notebook`
