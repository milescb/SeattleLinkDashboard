"""Calls to the Puget Sound OneBusAway API."""
import requests
from google.transit import gtfs_realtime_pb2

from . import config


def _get(path, **params):
    r = requests.get(f"{config.OBA_BASE}/{path}", params={"key": config.OBA_KEY, **params}, timeout=15)
    r.raise_for_status()
    return r


def fetch_trains(route_id):
    """Active trips on one route, with position and schedule deviation."""
    j = _get(f"where/trips-for-route/{config.AGENCY}_{route_id}.json", includeStatus="true").json()
    if "data" not in j:  # throttled or error: OBA returns 200 with a code/text instead of data
        raise RuntimeError(f"OBA {j.get('code')}: {j.get('text')}")
    refs = j["data"]["references"]
    stops = {s["id"]: s["name"] for s in refs["stops"]}
    headsigns = {t["id"]: t.get("tripHeadsign", "") for t in refs["trips"]}

    trains = []
    for t in j["data"]["list"]:
        s = t["status"]
        if not s.get("position"):
            continue
        trains.append({
            "id": s.get("vehicleId") or s["activeTripId"],
            "route": route_id,
            "lat": s["position"]["lat"],
            "lon": s["position"]["lon"],
            "delay": s["scheduleDeviation"],
            "predicted": s["predicted"],
            "headsign": headsigns.get(s["activeTripId"], ""),
            "next_stop": stops.get(s.get("nextStop"), ""),
            "closest_stop": stops.get(s.get("closestStop"), ""),
            "closest_offset": s.get("closestStopTimeOffset", 0),
        })
    return trains


def fetch_alerts(route_ids):
    """Service alerts touching any of route_ids, or agency-wide ones."""
    feed = gtfs_realtime_pb2.FeedMessage()
    feed.ParseFromString(_get(f"gtfs_realtime/alerts-for-agency/{config.AGENCY}.pb").content)

    def text(ts):
        return ts.translation[0].text if ts.translation else ""

    alerts = []
    for e in feed.entity:
        a = e.alert
        routes = sorted({ie.route_id for ie in a.informed_entity if ie.route_id})
        if routes and not set(routes) & set(route_ids):
            continue
        alerts.append({
            "id": e.id,
            "header": text(a.header_text),
            "description": text(a.description_text),
            "url": text(a.url),
            "routes": [r for r in routes if r in route_ids],
            "start": a.active_period[0].start if a.active_period else 0,
            "end": a.active_period[0].end if a.active_period else 0,
        })
    return sorted(alerts, key=lambda a: a["start"], reverse=True)
