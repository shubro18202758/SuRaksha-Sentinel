from __future__ import annotations

import hashlib
import html
import ipaddress
import re
import shutil
import socket
import subprocess
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode, urljoin, urlparse, urlunparse
from urllib.request import Request, urlopen

import fitz

from .data_provider import CACHE_DIR, read_json, write_json


CACHE_PATH = CACHE_DIR / "source_media.json"
PREVIEW_CACHE_DIR = CACHE_DIR / "source_previews"
CACHE_VERSION = "source-media-v7"
MEDIA_TTL_SECONDS = 60 * 30
HTTP_TIMEOUT_SECONDS = 8
MAX_PROXY_BYTES = 18 * 1024 * 1024
MAX_PDF_PREVIEW_BYTES = 14 * 1024 * 1024
PAGE_PREVIEW_TTL_SECONDS = 60 * 60 * 3

IMAGE_EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp", ".gif", ".avif")
VIDEO_EXTENSIONS = (".mp4", ".webm", ".mov", ".m4v")
PDF_EXTENSIONS = (".pdf",)

LOW_VALUE_PATTERNS = (
    "bbbp_logo",
    "rbi-company-logo",
    "twitter_new",
    "videos-icon",
    "logo",
    "letspace",
    "font-",
    "dark-theme",
    "bright-theme",
    "graytheme",
    "print-icon",
    "rss-icon",
    "favicon",
    "apple-touch-icon",
    "spacer",
    "blank",
)

LOW_VALUE_ALT_PATTERNS = (
    "logo",
    "follow rbi",
    "check rbi videos",
    "skip",
)


def resolve_source_media(source_url: str, title: str = "", force: bool = False) -> dict[str, Any]:
    source_url = _normalize_page_url(source_url)
    if not source_url:
        return _empty_payload(source_url, "missing source URL")

    cache = read_json(CACHE_PATH, {})
    cache_key = _cache_key(source_url)
    cached = cache.get(cache_key)
    now = time.time()
    if not force and cached and cached.get("expiresAt", 0) > now:
        return cached["payload"]

    try:
        payload = _resolve_live(source_url, title)
    except Exception as exc:
        if cached:
            stale_payload = {**cached["payload"], "status": "stale", "detail": f"{type(exc).__name__}: {exc}"}
            cache[cache_key] = {"expiresAt": now + 120, "payload": stale_payload}
            write_json(CACHE_PATH, cache)
            return stale_payload
        payload = _empty_payload(source_url, f"{type(exc).__name__}: {exc}", status="degraded")

    cache[cache_key] = {"expiresAt": now + MEDIA_TTL_SECONDS, "payload": payload}
    write_json(CACHE_PATH, cache)
    return payload


def proxy_source_media(url: str) -> tuple[bytes, str, str]:
    media_url = _normalize_media_url(url)
    _assert_public_http_url(media_url)
    request = Request(media_url, headers={"User-Agent": _user_agent()})
    with urlopen(request, timeout=HTTP_TIMEOUT_SECONDS) as response:
        content_type = response.headers.get_content_type() or _content_type_from_url(media_url)
        content_length = response.headers.get("Content-Length")
        if content_length and int(content_length) > MAX_PROXY_BYTES:
            raise ValueError("Media asset exceeds preview proxy size limit")
        body = response.read(MAX_PROXY_BYTES + 1)
    if len(body) > MAX_PROXY_BYTES:
        raise ValueError("Media asset exceeds preview proxy size limit")
    return body, content_type, media_url


def render_pdf_preview(url: str) -> tuple[bytes, str, str]:
    pdf_url = _normalize_media_url(url)
    _assert_public_http_url(pdf_url)
    if not _extension_path(pdf_url).endswith(PDF_EXTENSIONS):
        raise ValueError("Only PDF URLs can be rendered as document previews")

    PREVIEW_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    preview_path = PREVIEW_CACHE_DIR / f"{_cache_key(pdf_url)}.png"
    if preview_path.exists() and time.time() - preview_path.stat().st_mtime < MEDIA_TTL_SECONDS * 12:
        return preview_path.read_bytes(), "image/png", pdf_url

    request = Request(pdf_url, headers={"User-Agent": _user_agent(), "Accept": "application/pdf,*/*"})
    with urlopen(request, timeout=HTTP_TIMEOUT_SECONDS) as response:
        content_type = response.headers.get_content_type()
        content_length = response.headers.get("Content-Length")
        if content_length and int(content_length) > MAX_PDF_PREVIEW_BYTES:
            raise ValueError("PDF source exceeds preview renderer size limit")
        body = response.read(MAX_PDF_PREVIEW_BYTES + 1)
    if len(body) > MAX_PDF_PREVIEW_BYTES:
        raise ValueError("PDF source exceeds preview renderer size limit")
    if content_type != "application/pdf" and not body.startswith(b"%PDF"):
        raise ValueError("Source did not return a PDF document")

    document = fitz.open(stream=body, filetype="pdf")
    try:
        if document.page_count < 1:
            raise ValueError("PDF source has no pages")
        page = document.load_page(0)
        pixmap = page.get_pixmap(matrix=fitz.Matrix(1.45, 1.45), alpha=False)
        png_bytes = pixmap.tobytes("png")
    finally:
        document.close()

    preview_path.write_bytes(png_bytes)
    return png_bytes, "image/png", pdf_url


def render_page_preview(url: str) -> tuple[bytes, str, str]:
    page_url = _normalize_page_url(url)
    _assert_public_http_url(page_url)
    PREVIEW_CACHE_DIR.mkdir(parents=True, exist_ok=True)
    preview_key = _cache_key(page_url)
    preview_path = PREVIEW_CACHE_DIR / f"{preview_key}-page.png"
    if preview_path.exists() and time.time() - preview_path.stat().st_mtime < PAGE_PREVIEW_TTL_SECONDS:
        return preview_path.read_bytes(), "image/png", page_url

    browser = _browser_path()
    if not browser:
        raise ValueError("No Chromium or Edge browser found for source page preview rendering")

    profile_dir = PREVIEW_CACHE_DIR / f"{preview_key}-profile"
    profile_dir.mkdir(parents=True, exist_ok=True)
    command = [
        browser,
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--disable-extensions",
        "--disable-sync",
        "--no-first-run",
        "--no-default-browser-check",
        "--hide-scrollbars",
        "--window-size=1280,900",
        f"--user-data-dir={profile_dir}",
        f"--screenshot={preview_path}",
        page_url,
    ]
    completed = subprocess.run(command, cwd=str(CACHE_DIR.parent.parent), capture_output=True, timeout=24, check=False)
    if completed.returncode != 0 or not preview_path.exists() or preview_path.stat().st_size < 2048:
        detail = (completed.stderr or completed.stdout or b"").decode("utf-8", errors="replace")[:220]
        raise ValueError(f"Source page screenshot failed: {detail or completed.returncode}")
    return preview_path.read_bytes(), "image/png", page_url


def _resolve_live(source_url: str, title: str) -> dict[str, Any]:
    _assert_public_http_url(source_url)
    request = Request(source_url, headers={"User-Agent": _user_agent()})
    with urlopen(request, timeout=HTTP_TIMEOUT_SECONDS) as response:
        content_type = response.headers.get_content_type()
        body = response.read(900_000)
        final_url = response.geturl()

    retrieved_at = datetime.now(timezone.utc).isoformat()
    if content_type == "application/pdf" or _extension_path(final_url).endswith(PDF_EXTENSIONS):
        media = [_media_item("pdf", final_url, "Source PDF", "document", 96)]
    else:
        text = body.decode("utf-8", errors="replace")
        media = _extract_media(text, final_url, title)
        if _is_html_content(content_type, text):
            media.insert(0, _page_screenshot_item(final_url, title))

    return {
        "sourceUrl": final_url,
        "retrievedAt": retrieved_at,
        "status": "live" if media else "empty",
        "detail": f"{len(media)} source media assets resolved" if media else "Live source exposes no embeddable image, video, or PDF asset",
        "items": media[:14],
    }


def _extract_media(document: str, base_url: str, title: str) -> list[dict[str, Any]]:
    candidates: list[dict[str, Any]] = []
    candidates.extend(_meta_media(document, base_url))
    candidates.extend(_linked_media(document, base_url))
    candidates.extend(_tag_media(document, base_url))

    deduped: dict[str, dict[str, Any]] = {}
    for candidate in candidates:
        url = candidate["url"]
        if not _is_http_url(url):
            continue
        current = deduped.get(url)
        if not current or candidate["score"] > current["score"]:
            deduped[url] = candidate

    ranked = sorted(deduped.values(), key=lambda item: item["score"], reverse=True)
    media = [
        _media_item(
            kind=item["kind"],
            url=item["url"],
            title=item.get("title") or title or _filename_label(item["url"]),
            role=item.get("role", "source media"),
            confidence=item["score"],
        )
    for item in ranked[:18]
    ]
    return _limit_media_mix(media)


def _meta_media(document: str, base_url: str) -> list[dict[str, Any]]:
    media = []
    for tag in re.findall(r"<meta\b[^>]*>", document, flags=re.IGNORECASE):
        attrs = _attrs(tag)
        name = (attrs.get("property") or attrs.get("name") or "").lower()
        content = attrs.get("content", "")
        if not content:
            continue
        if name in {"og:image", "og:image:url", "twitter:image"}:
            media.append({"kind": "image", "url": urljoin(base_url, html.unescape(content)), "score": 98, "role": "OpenGraph image"})
        if name in {"og:video", "og:video:url", "og:video:secure_url", "twitter:player"}:
            media.append({"kind": "video", "url": urljoin(base_url, html.unescape(content)), "score": 99, "role": "OpenGraph video"})
    return media


def _linked_media(document: str, base_url: str) -> list[dict[str, Any]]:
    media = []
    for tag in re.findall(r"<a\b[^>]*>", document, flags=re.IGNORECASE):
        attrs = _attrs(tag)
        href = attrs.get("href", "")
        if not href:
            continue
        url = urljoin(base_url, html.unescape(href))
        path = _extension_path(url)
        if path.endswith(PDF_EXTENSIONS):
            media.append({"kind": "pdf", "url": url, "score": 92, "role": "linked source PDF"})
        elif path.endswith(VIDEO_EXTENSIONS):
            media.append({"kind": "video", "url": url, "score": 94, "role": "linked source video"})
        elif path.endswith(IMAGE_EXTENSIONS):
            score = _image_score(url, "", linked=True)
            if score > 0:
                media.append({"kind": "image", "url": url, "score": score, "role": "linked source image"})
    return media


def _tag_media(document: str, base_url: str) -> list[dict[str, Any]]:
    media = []
    for tag in re.findall(r"<img\b[^>]*>", document, flags=re.IGNORECASE):
        attrs = _attrs(tag)
        src = attrs.get("src") or attrs.get("data-src") or ""
        if not src:
            continue
        url = urljoin(base_url, html.unescape(src))
        alt = attrs.get("alt", "")
        score = _image_score(url, alt, linked=False)
        if score <= 0:
            continue
        media.append({"kind": "image", "url": url, "score": score, "role": "source page image", "title": alt})

    for tag in re.findall(r"<(?:video|source)\b[^>]*>", document, flags=re.IGNORECASE):
        attrs = _attrs(tag)
        src = attrs.get("src", "")
        if src:
            media.append({"kind": "video", "url": urljoin(base_url, html.unescape(src)), "score": 95, "role": "source page video"})
    return media


def _fallback_favicon(document: str, base_url: str) -> list[dict[str, Any]]:
    icons = []
    for tag in re.findall(r"<link\b[^>]*>", document, flags=re.IGNORECASE):
        attrs = _attrs(tag)
        rel = attrs.get("rel", "").lower()
        href = attrs.get("href", "")
        if href and "icon" in rel:
            icons.append({"kind": "image", "url": urljoin(base_url, html.unescape(href)), "score": 34, "role": "site icon"})
    if icons:
        return icons[:2]
    parsed = urlparse(base_url)
    return [{"kind": "image", "url": f"{parsed.scheme}://{parsed.netloc}/favicon.ico", "score": 25, "role": "site icon"}]


def _media_item(kind: str, url: str, title: str, role: str, confidence: int) -> dict[str, Any]:
    media_url = _normalize_media_url(url)
    query = urlencode({"url": media_url})
    preview_path = "/api/source-media/pdf-preview" if kind == "pdf" else "/api/source-media/proxy"
    return {
        "id": _cache_key(media_url)[:16],
        "kind": kind,
        "title": title[:120],
        "url": media_url,
        "previewUrl": f"{preview_path}?{query}",
        "contentType": _content_type_from_url(media_url, kind),
        "role": role,
        "confidence": confidence,
    }


def _page_screenshot_item(url: str, title: str) -> dict[str, Any]:
    page_url = _normalize_page_url(url)
    query = urlencode({"url": page_url})
    return {
        "id": _cache_key(f"page:{page_url}")[:16],
        "kind": "image",
        "title": title[:120] if title else _filename_label(page_url),
        "url": page_url,
        "previewUrl": f"/api/source-media/page-preview?{query}",
        "contentType": "image/png",
        "role": "live source page screenshot",
        "confidence": 99,
    }


def _attrs(tag: str) -> dict[str, str]:
    attrs: dict[str, str] = {}
    for name, _, value in re.findall(r"([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*=\s*(['\"])(.*?)\2", tag, flags=re.DOTALL):
        attrs[name.lower()] = html.unescape(value.strip())
    return attrs


def _image_score(url: str, alt: str, linked: bool) -> int:
    lowered = url.lower()
    alt_lowered = alt.lower()
    if any(pattern in lowered for pattern in LOW_VALUE_PATTERNS):
        return 0
    if any(pattern in alt_lowered for pattern in LOW_VALUE_ALT_PATTERNS):
        return 0
    if "rbi.org.in/images/" in lowered:
        return 0
    score = 58 if linked else 50
    if any(word in lowered for word in ("og", "banner", "hero", "photo", "image", "logo", "company", "youtube", "video")):
        score += 18
    if _extension_path(url).endswith((".jpg", ".jpeg", ".png", ".webp")):
        score += 10
    return min(score, 88)


def _limit_media_mix(items: list[dict[str, Any]]) -> list[dict[str, Any]]:
    pdfs = [item for item in items if item["kind"] == "pdf"]
    videos = [item for item in items if item["kind"] == "video"]
    images = [item for item in items if item["kind"] == "image"]
    selected: list[dict[str, Any]] = []
    selected.extend(videos[:5])
    selected.extend(images[:5])
    selected.extend(pdfs[:6])
    if len(selected) < 14:
        for item in items:
            if len(selected) >= 14:
                break
            if not any(existing["id"] == item["id"] for existing in selected):
                selected.append(item)
    return selected[:14]


def _normalize_page_url(url: str) -> str:
    url = (url or "").strip()
    if url.startswith("http://www.rbi.org.in/"):
        url = "https://" + url[len("http://") :]
    return url


def _normalize_media_url(url: str) -> str:
    parsed = urlparse((url or "").strip())
    if parsed.scheme == "http" and parsed.netloc.lower().endswith("rbi.org.in"):
        parsed = parsed._replace(scheme="https")
    return urlunparse(parsed)


def _assert_public_http_url(url: str) -> None:
    parsed = urlparse(url)
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise ValueError("Only http(s) media URLs are supported")
    host = parsed.hostname
    if not host:
        raise ValueError("Media URL host is missing")
    try:
        infos = socket.getaddrinfo(host, None)
    except socket.gaierror as exc:
        raise ValueError(f"Unable to resolve media host: {host}") from exc
    for info in infos:
        address = ipaddress.ip_address(info[4][0])
        if address.is_private or address.is_loopback or address.is_link_local or address.is_multicast:
            raise ValueError("Private network media URLs are blocked")


def _content_type_from_url(url: str, kind: str = "") -> str:
    path = _extension_path(url)
    if kind == "pdf" or path.endswith(PDF_EXTENSIONS):
        return "application/pdf"
    if kind == "video" or path.endswith(VIDEO_EXTENSIONS):
        return "video/mp4" if not path.endswith(".webm") else "video/webm"
    if path.endswith(".png"):
        return "image/png"
    if path.endswith(".webp"):
        return "image/webp"
    if path.endswith(".gif"):
        return "image/gif"
    return "image/jpeg" if kind == "image" else "application/octet-stream"


def _is_html_content(content_type: str, text: str) -> bool:
    return content_type in {"text/html", "application/xhtml+xml"} or "<html" in text[:500].lower()


def _browser_path() -> str:
    for command in ("msedge", "chrome", "chromium"):
        found = shutil.which(command)
        if found:
            return found
    candidates = [
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Microsoft\Edge\Application\msedge.exe",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    ]
    for candidate in candidates:
        if Path(candidate).exists():
            return candidate
    return ""


def _extension_path(url: str) -> str:
    return urlparse(url).path.lower()


def _filename_label(url: str) -> str:
    stem = _extension_path(url).rsplit("/", 1)[-1].rsplit(".", 1)[0]
    return stem.replace("-", " ").replace("_", " ").title() or "Source media"


def _is_http_url(url: str) -> bool:
    parsed = urlparse(url)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def _cache_key(value: str) -> str:
    return hashlib.sha256(f"{CACHE_VERSION}:{value}".encode("utf-8")).hexdigest()


def _user_agent() -> str:
    return "Mozilla/5.0 (Windows NT 10.0; Win64; x64) SuRakshaSentinel/0.1"


def _empty_payload(source_url: str, detail: str, status: str = "empty") -> dict[str, Any]:
    return {
        "sourceUrl": source_url,
        "retrievedAt": datetime.now(timezone.utc).isoformat(),
        "status": status,
        "detail": detail,
        "items": [],
    }
