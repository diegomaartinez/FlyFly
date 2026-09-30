import argparse
import json
import re
import sys
import time
import unicodedata
from pathlib import Path
from urllib.parse import quote

import requests

SPARQL_ENDPOINTS = [
    "https://query.wikidata.org/sparql",
    "https://wikidata.demo.openlinksw.com/sparql",
]

HEADERS = {
    "User-Agent": "SkyExplorerBot/1.0 (educational project; contact@example.com)"
}

# UTILIDADES
def slugify(text: str) -> str:
    text = unicodedata.normalize("NFKD", text)
    text = text.encode("ascii", "ignore").decode("ascii")
    text = re.sub(r"[^\w\s-]", "", text.lower())
    return re.sub(r"[\s_-]+", "_", text).strip("_")

def get(url: str, params=None, retries=5, extra_headers=None):
    headers = HEADERS.copy()
    if extra_headers:
        headers.update(extra_headers)

    for attempt in range(retries):
        try:
            r = requests.get(url, params=params, headers=headers, timeout=20)
            r.raise_for_status()
            return r.json()
        except Exception:
            wait = 2 ** attempt
            print(f"  ⚠ Retry {attempt+1}/{retries} in {wait}s...")
            time.sleep(wait)

    print(f"  ❌ Final failure: {url}")
    return None

# WIKIPEDIA
def resolve_wikipedia_title(city, lang):
    data = get(
        f"https://{lang}.wikipedia.org/w/api.php",
        {
            "action": "query",
            "list": "search",
            "srsearch": city,
            "format": "json",
        },
    )
    results = (data or {}).get("query", {}).get("search", [])
    return results[0]["title"] if results else None

def city_coords(title, lang):
    data = get(
        f"https://{lang}.wikipedia.org/w/api.php",
        {
            "action": "query",
            "titles": title,
            "prop": "coordinates",
            "format": "json",
        },
    )
    pages = (data or {}).get("query", {}).get("pages", {})
    for page in pages.values():
        coords = page.get("coordinates")
        if coords:
            return coords[0]["lat"], coords[0]["lon"]
    return None

# SPARQL ROBUSTO
def sparql_query(query):
    for endpoint in SPARQL_ENDPOINTS:
        print(f"   🌐 Trying endpoint: {endpoint}")
        data = get(
            endpoint,
            params={"query": query, "format": "json"},
            extra_headers={"Accept": "application/sparql-results+json"},
        )
        if data:
            return data
    return None

def wikipedia_nearby_pois(lat, lng, radius_km, limit, lang):
    print("   🌍 Using Wikipedia GeoSearch (stable fallback)")

    data = get(
        f"https://{lang}.wikipedia.org/w/api.php",
        params={
            "action": "query",
            "list": "geosearch",
            "gscoord": f"{lat}|{lng}",
            "gsradius": int(radius_km * 1000),  # metros
            "gslimit": limit,
            "format": "json",
        },
    )

    if not data:
        return None

    results = []
    for item in data.get("query", {}).get("geosearch", []):
        results.append({
            "name": item["title"],
            "lat": round(item["lat"], 5),
            "lng": round(item["lon"], 5),
        })

    return results

# WIKIPEDIA ENRICH
def wikipedia_summary(title, lang):
    data = get(f"https://{lang}.wikipedia.org/api/rest_v1/page/summary/{quote(title)}")
    if data:
        return data.get("extract", "")[:500]
    return ""

# BUILD
def build_places(city, lang, limit, radius):
    print(f"\n🌍 {city}")

    title = resolve_wikipedia_title(city, lang)
    coords = city_coords(title, lang)

    if not coords:
        sys.exit("❌ No coordinates")

    lat, lng = coords

    pois = wikipedia_nearby_pois(lat, lng, radius, limit, lang)

    if pois is None:
        print("❌ SPARQL failed")
        return []

    if len(pois) == 0:
        print("⚠ No POIs found")
        return []

    places = []
    for p in pois[:limit]:
        places.append({
            "id": slugify(p["name"]),
            "name": p["name"],
            "icon": "📍",
            "lat": p["lat"],
            "lng": p["lng"],
            "description": wikipedia_summary(p["name"], lang),
            "photos": [],
        })

    return places


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("city")
    parser.add_argument("--lang", default="es")
    parser.add_argument("--limit", type=int, default=20)
    parser.add_argument("--radius", type=float, default=8.0)
    parser.add_argument("--out", default="./places", help="output directory")
    args = parser.parse_args()

    places = build_places(args.city, args.lang, args.limit, args.radius)

    if not places:
        sys.exit(1)

    path = Path(args.out) / (slugify(args.city) + ".json")

    with open(path, "w", encoding="utf-8") as f:
        json.dump(places, f, ensure_ascii=False, indent=2)

    print(f"\n✅ Saved → {path}")


if __name__ == "__main__":
    main()