"""Route shapes, stations and colors from the static GTFS zip (downloaded once, cached as JSON)."""
import csv
import io
import json
import zipfile

import requests

from . import config


def _rows(z, name):
    return csv.DictReader(io.TextIOWrapper(z.open(name), "utf-8-sig"))


def build():
    r = requests.get(config.STATIC_GTFS_URL, headers={"User-Agent": "curl/8.7.1"}, timeout=60)
    r.raise_for_status()
    z = zipfile.ZipFile(io.BytesIO(r.content))

    route_ids = set(config.ROUTES)
    colors = {r["route_id"]: "#" + r["route_color"] for r in _rows(z, "routes.txt") if r["route_id"] in route_ids}

    shape_route, trip_route = {}, {}
    for t in _rows(z, "trips.txt"):
        if t["route_id"] in route_ids:
            shape_route[t["shape_id"]] = t["route_id"]
            trip_route[t["trip_id"]] = t["route_id"]

    pts = {}
    for p in _rows(z, "shapes.txt"):
        if p["shape_id"] in shape_route:
            pts.setdefault(p["shape_id"], []).append(
                (int(p["shape_pt_sequence"]), float(p["shape_pt_lat"]), float(p["shape_pt_lon"])))
    shapes = [{"route": shape_route[sid], "coords": [[la, lo] for _, la, lo in sorted(ps)]}
              for sid, ps in pts.items()]

    # stations: stops served by our trips, collapsed to their parent station
    served = {}
    for st in _rows(z, "stop_times.txt"):
        if st["trip_id"] in trip_route:
            served.setdefault(st["stop_id"], set()).add(trip_route[st["trip_id"]])
    stops = {s["stop_id"]: s for s in _rows(z, "stops.txt")}
    stations = {}
    for sid, routes in served.items():
        s = stops[sid]
        s = stops.get(s["parent_station"]) or s
        st = stations.setdefault(s["stop_id"], {"name": s["stop_name"], "lat": float(s["stop_lat"]),
                                                "lon": float(s["stop_lon"]), "routes": set()})
        st["routes"] |= routes
    stations = [{**s, "routes": sorted(s["routes"])} for s in stations.values()]

    routes = [{"id": rid, "name": name, "color": colors.get(rid, "#888888")} for rid, name in config.ROUTES.items()]
    return {"routes": routes, "shapes": shapes, "stations": stations}


def load():
    """Cached static data; delete data/static.json (or change ROUTES) to rebuild."""
    path = config.DATA_DIR / "static.json"
    if path.exists():
        data = json.loads(path.read_text())
        if [r["id"] for r in data["routes"]] == list(config.ROUTES):
            return data
    data = build()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data))
    return data
