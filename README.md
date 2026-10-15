# Link Control Room

Live dark-theme dashboard for Sound Transit's 1 Line and 2 Line, served at
**https://seattlelink.milescb.com**: trains on a map (red = ≥3 min late, pulsing ring = late
at a station), service alerts, live on-time / delay stats, and a history panel (pick a date
range) with on-time % or average delay over time, by day, by time of day, by day of week,
trains in service, and a day × hour heatmap.

## How it runs in production

It runs on `mac-server`, straight from this checkout (`~/SeattleLinkDashboard`):

```
internet → Cloudflare tunnel (TLS at the edge, seattlelink.milescb.com → localhost:80)
         → nginx :80        /etc/nginx/conf.d/seattlelink.milescb.com.conf
         → gunicorn :5001   systemd unit `seattlelink`, 1 worker / 4 threads
```

- Keys live in `/etc/seattlelink/env` (mode 600), loaded by the unit's `EnvironmentFile=`.
- Data lives in `~/SeattleLinkDashboard/data/` (the unit's `WorkingDirectory`).
- gunicorn must stay at **one worker, no `--preload`, no `--max-requests`**: the
  OneBusAway poller is a thread inside the worker process.

The full install (nginx, systemd, Cloudflare, keys) and the reasons behind each setting
are in [deploy/DEPLOY.md](deploy/DEPLOY.md).

### Ship a change

```sh
cd ~/SeattleLinkDashboard && git pull && uv sync   # or just edit in place
sudo systemctl restart seattlelink
```

Flask serves the HTML/CSS/JS too, so every change (frontend included) goes live on
restart; then hard-refresh the browser.

### Operate

| What | Command |
|---|---|
| Status | `systemctl status seattlelink` |
| Logs | `journalctl -u seattlelink -f` |
| Stop / start | `sudo systemctl stop seattlelink` / `sudo systemctl start seattlelink` |
| Check the API | `curl -s localhost:5001/api/live \| head -c 200` |
| Check the public site | `curl -sI https://seattlelink.milescb.com/ \| head -3` |
| Change keys | `sudoedit /etc/seattlelink/env && sudo systemctl restart seattlelink` |

If the deployed unit or nginx config in `deploy/` changes, copy them back into place
(see [deploy/DEPLOY.md](deploy/DEPLOY.md)), then `sudo systemctl daemon-reload` or
`sudo nginx -t && sudo systemctl reload nginx`.

## Run it locally (development)

1. Install [uv](https://docs.astral.sh/uv/) and run `uv sync` in the repo root.
2. Get an `OBA_KEY` (Puget Sound OneBusAway key, from `oba_api_key@soundtransit.org`).
   `CARTO_KEY` is optional; without it the map uses keyless Esri dark-gray tiles.
3. Start it:
   ```sh
   OBA_KEY=<your key> uv run seattletransit             # http://127.0.0.1:5001
   PORT=8080 DATA_DIR=/tmp/link-data OBA_KEY=... uv run seattletransit
   ```
   Use a different `PORT` while the production service holds 5001, and a separate
   `DATA_DIR` so a dev run doesn't write into production's history.

The first start downloads the static rail GTFS (a few seconds); live trains appear after
the first poll (~10 s). If OneBusAway rate-limits the key (HTTP 429), the page keeps the
last good data, the header dot turns red, and the poller backs off up to 5 minutes.

Tests: `uv run pytest`. Notebook dependencies: `uv sync --group notebook`.

## Where to edit

| What | File |
|---|---|
| Colors, fonts, basemap style | `src/seattletransit/static/css/theme.css` |
| Layout / panel sizes | `src/seattletransit/static/css/layout.css` |
| Lines shown, poll rate, delay & on-time thresholds, service-day cutoff | `src/seattletransit/config.py` |
| API calls | `src/seattletransit/oba.py` |
| Poller and live stats | `src/seattletransit/state.py` |
| History storage and queries | `src/seattletransit/db.py` |
| Map, alerts, live stats, history charts | `src/seattletransit/static/js/{map,alerts,stats,history}.js` |
| Deployment (nginx, systemd, secrets) | `deploy/` |

## Data

- Positions and schedule deviation come from OBA `trips-for-route`; alerts from the
  GTFS-RT alerts feed.
- Shapes and stations come from the static rail GTFS, cached in `data/static.json`.
  Delete it to rebuild.
- Each poll's stats (per line and all lines) go into SQLite at `data/history.db`. A line
  with no realtime trains, i.e. not running, is not recorded, so overnight gaps don't
  drag the averages down. Averages are weighted by the number of trains.
- History is grouped by **service day**, which rolls over at 03:00 Seattle time, so
  trains running after midnight count toward the day they started.
  Query it directly: `sqlite3 data/history.db "SELECT day, route, AVG(on_time_pct) FROM samples GROUP BY 1, 2"`.
- An older `data/history.csv` is imported once on start (minus the no-service rows) and
  renamed to `history.csv.imported`.
- API: `/api/live` (current snapshot), `/api/history?days=7` or
  `/api/history?start=2026-10-01&end=2026-10-14`.
