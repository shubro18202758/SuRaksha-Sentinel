from __future__ import annotations

import html
import json
import re
import time
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode
from urllib.request import Request, urlopen
from xml.etree import ElementTree

from .data_provider import CACHE_DIR, load_dossier_data, read_json, write_json


CACHE_PATH = CACHE_DIR / "connectors.json"
DEFAULT_TTL_SECONDS = 180
HTTP_TIMEOUT_SECONDS = 8


def connector_snapshot(force: bool = False) -> dict[str, Any]:
    cache = _read_cache()
    now = time.time()
    if not force and cache.get("expiresAt", 0) > now:
        return cache

    previous = cache if cache.get("connectors") else None
    refreshed = _refresh_all(previous)
    write_json(CACHE_PATH, refreshed)
    return refreshed


def connector_status() -> dict[str, Any]:
    return connector_snapshot(force=False)


def refresh_connectors() -> dict[str, Any]:
    return connector_snapshot(force=True)


def source_signals() -> list[dict[str, Any]]:
    snapshot = connector_snapshot(force=False)
    signals: list[dict[str, Any]] = []
    for connector in snapshot["connectors"]:
        for item in connector.get("items", []):
            signals.append(_to_signal(connector, item))
    return sorted(signals, key=lambda signal: (signal["confidence"], signal["retrievedAt"]), reverse=True)


def _refresh_all(previous: dict[str, Any] | None) -> dict[str, Any]:
    data = load_dossier_data()
    queries = data.get("connectorQueries", {})
    connectors = [
        _run_connector("rbi-press", "RBI Press Releases", "OSINT", _fetch_rbi_feed, "https://rbi.org.in/pressreleases_rss.xml", previous),
        _run_connector("rbi-notifications", "RBI Notifications", "OSINT", _fetch_rbi_feed, "https://rbi.org.in/notifications_rss.xml", previous),
        _run_connector("rbi-youtube", "RBI YouTube Videos", "SOCMINT", _fetch_youtube_feed, "https://www.youtube.com/feeds/videos.xml?channel_id=UCIfCOl43tunZVNYafeC4RQA", previous),
        _run_connector("cert-in", "CERT-In Advisories", "CYBINT", _fetch_cert_in, "https://www.cert-in.org.in/s2cMainServlet?pageid=PUBADVLIST02&year=2026", previous),
        _run_connector("gdelt-doc", "GDELT DOC", "OSINT", _fetch_gdelt, str(queries.get("gdelt", "")), previous),
        _run_connector("ct-log", "Certificate Transparency", "TECHINT", _fetch_ct, str(queries.get("certificateTransparency", "")), previous),
        _run_connector("rdap", "RDAP Domain Registry", "TECHINT", _fetch_rdap, str(queries.get("rdap", "")), previous),
    ]
    now = time.time()
    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "expiresAt": now + DEFAULT_TTL_SECONDS,
        "ttlSeconds": DEFAULT_TTL_SECONDS,
        "connectors": connectors,
    }


def _run_connector(
    connector_id: str,
    name: str,
    signal_type: str,
    fetcher: Any,
    argument: str,
    previous: dict[str, Any] | None,
) -> dict[str, Any]:
    started = time.perf_counter()
    try:
        items = fetcher(argument)
        return {
            "id": connector_id,
            "name": name,
            "type": signal_type,
            "status": "live",
            "detail": f"{len(items)} source items retrieved",
            "sourceUrl": _source_url(connector_id, argument),
            "retrievedAt": datetime.now(timezone.utc).isoformat(),
            "latencyMs": int((time.perf_counter() - started) * 1000),
            "items": items[:8],
        }
    except Exception as exc:  # Connector boundaries must not take down the cockpit.
        stale = _stale_connector(previous, connector_id)
        return {
            "id": connector_id,
            "name": name,
            "type": signal_type,
            "status": "stale" if stale else "degraded",
            "detail": f"{type(exc).__name__}: {exc}",
            "sourceUrl": _source_url(connector_id, argument),
            "retrievedAt": stale.get("retrievedAt") if stale else datetime.now(timezone.utc).isoformat(),
            "latencyMs": int((time.perf_counter() - started) * 1000),
            "items": stale.get("items", []) if stale else [],
        }


def _fetch_rbi_feed(url: str) -> list[dict[str, Any]]:
    body = _request_text(url)
    root = ElementTree.fromstring(body)
    items = []
    for item in root.findall("./channel/item")[:6]:
        title = _text(item.findtext("title"))
        description = _clean_html(_text(item.findtext("description")))[:360]
        link = _text(item.findtext("link"))
        published = _parse_pub_date(_text(item.findtext("pubDate")))
        items.append(
            {
                "title": title,
                "summary": description or title,
                "sourceUrl": link,
                "publishedAt": published,
                "severity": _severity_from_text(title + " " + description),
                "confidence": _confidence_from_text(title + description, 68),
            }
        )
    return items


def _fetch_youtube_feed(url: str) -> list[dict[str, Any]]:
    body = _request_text(url)
    root = ElementTree.fromstring(body)
    ns = {
        "atom": "http://www.w3.org/2005/Atom",
        "yt": "http://www.youtube.com/xml/schemas/2015",
        "media": "http://search.yahoo.com/mrss/",
    }
    items = []
    for entry in root.findall("atom:entry", ns)[:6]:
        title = _text(entry.findtext("atom:title", namespaces=ns))
        video_id = _text(entry.findtext("yt:videoId", namespaces=ns))
        published = _gdelt_date(_text(entry.findtext("atom:published", namespaces=ns)))
        group = entry.find("media:group", ns)
        description = _clean_html(_text(group.findtext("media:description", namespaces=ns) if group is not None else ""))[:260]
        thumbnail = ""
        if group is not None:
            thumb = group.find("media:thumbnail", ns)
            thumbnail = thumb.attrib.get("url", "") if thumb is not None else ""
        watch_url = f"https://www.youtube.com/watch?v={quote(video_id)}" if video_id else url
        media = []
        if thumbnail and video_id:
            media.append(
                {
                    "id": f"yt-{video_id}",
                    "kind": "video",
                    "title": title,
                    "url": watch_url,
                    "previewUrl": f"/api/source-media/proxy?{urlencode({'url': thumbnail})}",
                    "embedUrl": f"https://www.youtube.com/embed/{quote(video_id)}",
                    "contentType": "text/html",
                    "role": "official RBI YouTube video",
                    "confidence": 98,
                }
            )
        items.append(
            {
                "title": title or "RBI video update",
                "summary": description or "Official Reserve Bank of India video feed item.",
                "sourceUrl": watch_url,
                "publishedAt": published,
                "severity": "Low",
                "confidence": 82,
                "media": media,
            }
        )
    return items


def _fetch_cert_in(url: str) -> list[dict[str, Any]]:
    body = _request_text(url)
    pattern = re.compile(
        r"CERT-In Advisory (?P<id>CIAD-\d{4}-\d{4}).{0,220}?\((?P<date>[^)]+)\)\s*(?P<title>[^<]+)",
        re.IGNORECASE | re.DOTALL,
    )
    items = []
    for match in pattern.finditer(body):
        title = _clean_html(match.group("title"))
        if not title:
            continue
        advisory_id = match.group("id")
        items.append(
            {
                "title": f"{advisory_id}: {title}",
                "summary": f"CERT-In advisory observed for banking cyber-risk correlation: {title}",
                "sourceUrl": url,
                "publishedAt": _parse_loose_date(match.group("date")),
                "severity": _severity_from_text(title),
                "confidence": _confidence_from_text(title, 76),
            }
        )
    return items[:8]


def _fetch_gdelt(query: str) -> list[dict[str, Any]]:
    if not query:
        return []
    url = (
        "https://api.gdeltproject.org/api/v2/doc/doc"
        f"?query={quote(query)}&mode=ArtList&format=json&maxrecords=8&sort=HybridRel"
    )
    payload = json.loads(_request_text(url))
    articles = payload.get("articles", [])
    return [
        {
            "title": str(article.get("title", "GDELT article"))[:180],
            "summary": str(article.get("seendate", "recent")) + " | " + str(article.get("sourceCountry", "global")),
            "sourceUrl": str(article.get("url", url)),
            "publishedAt": _gdelt_date(str(article.get("seendate", ""))),
            "severity": "Medium",
            "confidence": 72,
        }
        for article in articles[:8]
    ]


def _fetch_ct(query: str) -> list[dict[str, Any]]:
    if not query:
        return []
    url = f"https://crt.sh/?q={quote(query)}&output=json"
    payload = json.loads(_request_text(url, timeout=12))
    seen: set[str] = set()
    items = []
    for row in payload:
        name_value = str(row.get("name_value", "")).splitlines()[0].strip()
        if not name_value or name_value in seen:
            continue
        seen.add(name_value)
        items.append(
            {
                "title": f"Certificate observed for {name_value}",
                "summary": f"Issuer {row.get('issuer_name', 'unknown')} | not_before {row.get('not_before', 'unknown')}",
                "sourceUrl": url,
                "publishedAt": _gdelt_date(str(row.get("entry_timestamp", ""))),
                "severity": "Medium",
                "confidence": 70,
            }
        )
        if len(items) >= 8:
            break
    return items


def _fetch_rdap(domain: str) -> list[dict[str, Any]]:
    if not domain:
        return []
    url = f"https://rdap.org/domain/{quote(domain)}"
    payload = json.loads(_request_text(url))
    events = payload.get("events", [])
    items = []
    for event in events[:5]:
        action = str(event.get("eventAction", "domain registry event"))
        event_date = str(event.get("eventDate", ""))
        items.append(
            {
                "title": f"RDAP {action} for {domain}",
                "summary": f"Registry event observed at {event_date or 'unknown time'}",
                "sourceUrl": url,
                "publishedAt": _gdelt_date(event_date),
                "severity": "Low",
                "confidence": 67,
            }
        )
    return items


def _to_signal(connector: dict[str, Any], item: dict[str, Any]) -> dict[str, Any]:
    source_url = item.get("sourceUrl") or connector.get("sourceUrl", "")
    title = str(item.get("title", connector["name"]))
    confidence = float(item.get("confidence", 70))
    return {
        "id": _signal_id(connector["id"], title, source_url),
        "source": connector["name"],
        "type": connector["type"],
        "title": title,
        "severity": item.get("severity", "Medium"),
        "summary": item.get("summary", title),
        "confidence": round(confidence, 1),
        "observedAt": item.get("publishedAt") or connector.get("retrievedAt"),
        "retrievedAt": connector.get("retrievedAt"),
        "sourceUrl": source_url,
        "previewUrl": "",
        "sourceMedia": item.get("media", []),
        "provenance": {
            "connectorId": connector["id"],
            "connectorStatus": connector["status"],
            "sourceUrl": source_url,
            "retrievedAt": connector.get("retrievedAt"),
        },
    }


def _read_cache() -> dict[str, Any]:
    return read_json(CACHE_PATH, {"expiresAt": 0, "connectors": []})


def _stale_cache(cache: dict[str, Any]) -> dict[str, Any]:
    connectors = []
    for connector in cache.get("connectors", []):
        if connector.get("status") == "live":
            connectors.append({**connector, "status": "stale", "detail": f"Serving cached data beyond TTL: {connector.get('detail', '')}"})
        else:
            connectors.append(connector)
    return {**cache, "connectors": connectors, "stale": True}


def _stale_connector(previous: dict[str, Any] | None, connector_id: str) -> dict[str, Any]:
    if not previous:
        return {}
    for connector in previous.get("connectors", []):
        if connector.get("id") == connector_id and connector.get("items"):
            return connector
    return {}


def _request_text(url: str, timeout: int = HTTP_TIMEOUT_SECONDS) -> str:
    request = Request(url, headers={"User-Agent": "SuRakshaSentinel/0.1 defensive-prototype"})
    with urlopen(request, timeout=timeout) as response:
        return response.read().decode("utf-8", errors="replace")


def _text(value: str | None) -> str:
    return html.unescape(value or "").strip()


def _clean_html(value: str) -> str:
    value = html.unescape(value)
    value = re.sub(r"<[^>]+>", " ", value)
    value = re.sub(r"\s+", " ", value)
    return value.strip()


def _parse_pub_date(value: str) -> str:
    try:
        return parsedate_to_datetime(value).astimezone(timezone.utc).isoformat()
    except (TypeError, ValueError, AttributeError):
        return datetime.now(timezone.utc).isoformat()


def _parse_loose_date(value: str) -> str:
    try:
        return datetime.strptime(value.strip(), "%B %d, %Y").replace(tzinfo=timezone.utc).isoformat()
    except ValueError:
        return datetime.now(timezone.utc).isoformat()


def _gdelt_date(value: str) -> str:
    for fmt in ("%Y%m%dT%H%M%SZ", "%Y-%m-%dT%H:%M:%SZ", "%Y-%m-%dT%H:%M:%S.%fZ"):
        try:
            return datetime.strptime(value[:24], fmt).replace(tzinfo=timezone.utc).isoformat()
        except ValueError:
            pass
    return datetime.now(timezone.utc).isoformat()


def _severity_from_text(value: str) -> str:
    lowered = value.lower()
    if any(word in lowered for word in ("critical", "fraud", "forgery", "attack", "phishing", "vulnerability")):
        return "High"
    if any(word in lowered for word in ("warning", "risk", "amendment", "compliance", "direction")):
        return "Medium"
    return "Low"


def _confidence_from_text(value: str, base: int) -> int:
    lowered = value.lower()
    bonus = sum(4 for word in ("bank", "fraud", "document", "certificate", "loan", "security", "rbi", "cert-in") if word in lowered)
    return max(45, min(96, base + bonus))


def _source_url(connector_id: str, argument: str) -> str:
    if connector_id in {"rbi-press", "rbi-notifications", "cert-in"}:
        return argument
    if connector_id == "gdelt-doc":
        return "https://api.gdeltproject.org/api/v2/doc/doc"
    if connector_id == "ct-log":
        return f"https://crt.sh/?q={quote(argument)}&output=json"
    if connector_id == "rdap":
        return f"https://rdap.org/domain/{quote(argument)}"
    return argument


def _safe_asset_id(value: str) -> str:
    safe = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return safe[:48] or "source"


def _signal_id(connector_id: str, title: str, source_url: str) -> str:
    import hashlib

    digest = hashlib.sha1(f"{connector_id}:{title}:{source_url}".encode("utf-8")).hexdigest()[:10]
    return f"SIG-{connector_id.upper()}-{digest}"
