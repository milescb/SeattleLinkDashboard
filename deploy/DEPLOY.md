# Deploy on `mac-server` (crabdance's host)

Same shape as PiWebsite — Cloudflare tunnel → nginx → gunicorn — with two differences
that matter, and one that makes it simpler:

- **Simpler:** Flask serves the static frontend *and* the JSON API on one port
  (`static_url_path=""`, JS fetches root-absolute `/api/live`). No `/var/www` symlink,
  no `/api/` proxy prefix rewrite.
- **Different:** the OBA poller is an **in-process thread** holding the live snapshot
  (`state.py`). So gunicorn runs **one worker, no `--preload`, no `--max-requests`** —
  PiWebsite's `--worker-class gevent --max-requests 1000` recipe would break this app.
- **Different:** `OBA_KEY` lives in a `600` file, not in the unit. Unit files are
  world-readable.

## Layout

```
internet → Cloudflare (TLS, DNS, edge)  [done: hostname seattlelink.milescb.com
         →                              → http://localhost:80, tunnel token in
                                         /etc/systemd/system/cloudflared.service]
         → nginx :80  server_name seattlelink.milescb.com
              location /  → proxy_pass http://127.0.0.1:5001
                          → gunicorn (systemd seattlelink.service, 1 worker / 4 threads)
```

Port **5001**: 5000 is taken by PiWebsite (which binds `0.0.0.0` — this one stays on
loopback and is only reachable through nginx + the tunnel).

## One-time install

```sh
cd ~/SeattleLinkDashboard
uv sync                                   # -> .venv (uv-managed CPython 3.14)

sudo install -d -m 700 /etc/seattlelink
sudo cp deploy/env.example /etc/seattlelink/env
sudoedit /etc/seattlelink/env             # paste OBA_KEY (CARTO_KEY optional, see below)
sudo chown milescb:milescb /etc/seattlelink/env && sudo chmod 600 /etc/seattlelink/env

sudo cp deploy/nginx.conf /etc/nginx/conf.d/seattlelink.milescb.com.conf
sudo cp deploy/seattlelink.service /etc/systemd/system/seattlelink.service
sudo nginx -t && sudo systemctl reload nginx
sudo systemctl daemon-reload && sudo systemctl enable --now seattlelink
```

Check:

```sh
journalctl -u seattlelink -f      # first start downloads the rail GTFS (~5 s), trains ~10 s later
curl -s localhost:5001/api/live | head -c 200
curl -sI https://seattlelink.milescb.com/ | head -3
```

## Cloudflare

Already done and needs nothing local: the tunnel is **remotely managed** (token in
`cloudflared.service`, no `~/.cloudflared/config.yml`, no `cert.pem`), so new routes are
added in Zero Trust → Networks → Routes → add a public hostname → `HTTP: localhost:80`.
No `cloudflared` restart, no certbot (Cloudflare terminates TLS at the edge).

Two things *not* to do:

- No **"Cache Everything"** page rule on this hostname — it would cache `/api/live` and
  freeze the trains mid-run. Default is correct (`cf-cache-status: DYNAMIC`).
- If the dashboard should not be public, gate it in Zero Trust → Applications →
  `seattlelink.milescb.com` + an allowlist policy. Nothing in the app changes.

## Keys

| Key | Used | Sent to browsers | Notes |
|---|---|---|---|
| `OBA_KEY` | `oba.py`, server-side query param | **No** | `state.py` redacts it from error strings before they reach `/api/live` (verified: `…?key=***`). That redaction is load-bearing — keep it. |
| `CARTO_KEY` | `map.js`, tile URL built client-side | **Yes** | Leave blank → keyless Esri dark-gray fallback (`map.js:13`). If you set it, add a `seattlelink.milescb.com` referrer allowlist at CARTO. Proxying tiles through Flask would hide it, but then every pan/zoom streams dozens of PNGs through one worker. |

## Updating

```sh
cd ~/SeattleLinkDashboard && git pull && uv sync && sudo systemctl restart seattlelink
```

`data/static.json` caches the static GTFS; delete it to rebuild after changing
`config.ROUTES`. `data/history.db` (SQLite) is the delay history; on first start it
imports any old `data/history.csv` and renames it to `history.csv.imported`.
Both are gitignored and relative to `WorkingDirectory`.

## Verified locally before enabling

```
1 master + 1 worker, poller started once
GET /            -> 200 (3378 b)
/api/static      -> routes ['1 Line','2 Line'], 9 shapes, 39 stations, carto_key ''
/api/live        -> error surfaced as …?key=***   (0 occurrences of the key in any response)
```
