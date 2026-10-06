"""All tunable settings live here. Colors live in static/css/theme.css."""
import os
from pathlib import Path

OBA_KEY = os.environ.get("OBA_KEY", "")
CARTO_KEY = os.environ.get("CARTO_KEY", "")  # basemap tiles; without it we fall back to keyless Esri dark gray
OBA_BASE = "https://api.pugetsound.onebusaway.org/api"
AGENCY = "40"  # Sound Transit
STATIC_GTFS_URL = "https://www.soundtransit.org/GTFS-rail/40_gtfs.zip"

# route_id -> display name. Add more Sound Transit routes here.
ROUTES = {"100479": "1 Line", "2LINE": "2 Line"}

POLL_SECONDS = 30       # how often the server hits OBA
REQUEST_GAP_SECONDS = 3  # OBA throttles back-to-back calls (HTTP 429)
MAX_BACKOFF_SECONDS = 300  # after repeated failures, wait up to this long between polls

DELAY_S = 180           # >= this many seconds late -> train drawn red
AT_STATION_S = 30       # within this many seconds of closest stop -> "at station"
ON_TIME_EARLY_S = -60   # on-time window: [ON_TIME_EARLY_S, ON_TIME_LATE_S]
ON_TIME_LATE_S = 300

HISTORY_HOURS = 24
DATA_DIR = Path(os.environ.get("DATA_DIR", "data"))
