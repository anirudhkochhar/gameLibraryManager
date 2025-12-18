"""Helpers that enrich a plain game title with metadata for the grid view."""

from __future__ import annotations

import hashlib
import logging
import os
import re
import time
from typing import Dict, List, Optional, Sequence

import httpx

from .models import Game

logger = logging.getLogger(__name__)

# A light-weight offline catalog that keeps the UI interesting without any API keys.
HANDCRAFTED_METADATA: Dict[str, Dict[str, str]] = {
    "elden ring": {
        "description": "Claim the Elden Ring and become an Elden Lord in FromSoftware's open-world action RPG.",
        "thumbnail_url": "https://images.igdb.com/igdb/image/upload/t_cover_big/co2mjs.jpg",
        "cover_url": "https://images.igdb.com/igdb/image/upload/t_1080p/co2mjs.jpg",
        "trailer_url": "https://www.youtube.com/embed/E3Huy2cdih0?rel=0",
        "rating": 95.0,
    },
    "the witcher 3: wild hunt": {
        "description": "Geralt of Rivia embarks on his most personal contract across war-torn Northern Kingdoms.",
        "thumbnail_url": "https://images.igdb.com/igdb/image/upload/t_cover_big/co1wyy.jpg",
        "cover_url": "https://images.igdb.com/igdb/image/upload/t_1080p/co1wyy.jpg",
        "trailer_url": "https://www.youtube.com/embed/xx8kQ4s5hCY?rel=0",
        "rating": 93.0,
    },
    "hades": {
        "description": "Battle out of the Underworld in this rogue-like dungeon crawler from Supergiant Games.",
        "thumbnail_url": "https://images.igdb.com/igdb/image/upload/t_cover_big/co25lx.jpg",
        "cover_url": "https://images.igdb.com/igdb/image/upload/t_1080p/co25lx.jpg",
        "trailer_url": "https://www.youtube.com/embed/591V2E1jZ1E?rel=0",
        "rating": 94.0,
    },
    "doom eternal": {
        "description": "Rip and tear across dimensions to stop Hell's invasion once again.",
        "thumbnail_url": "https://images.igdb.com/igdb/image/upload/t_cover_big/co1r87.jpg",
        "cover_url": "https://images.igdb.com/igdb/image/upload/t_1080p/co1r87.jpg",
        "trailer_url": "https://www.youtube.com/embed/FkklG9MA0vM?rel=0",
        "rating": 89.0,
    },
    "god of war": {
        "description": "Kratos and Atreus journey through Norse realms filled with gods and monsters.",
        "thumbnail_url": "https://images.igdb.com/igdb/image/upload/t_cover_big/co1tmu.jpg",
        "cover_url": "https://images.igdb.com/igdb/image/upload/t_1080p/co1tmu.jpg",
        "trailer_url": "https://www.youtube.com/embed/K0u_kAWLJOA?rel=0",
        "rating": 94.0,
    },
}

DEFAULT_DESCRIPTION = (
    "Game metadata placeholder. Connect a provider such as IGDB to enrich this entry."
)
DEFAULT_TRAILER = "https://www.youtube.com/embed/dQw4w9WgXcQ?rel=0"


class MetadataLookupError(RuntimeError):
    """Raised when a provider fails to resolve metadata for a title."""


def normalize_key(value: str) -> str:
    """Return a normalized key for easy dictionary lookups."""
    cleaned = re.sub(r"[^a-z0-9]+", " ", value.lower())
    return re.sub(r"\s+", " ", cleaned).strip()


def slugify(value: str) -> str:
    return normalize_key(value).replace(" ", "-") or "game"


def placeholder_art(seed: str, width: int, height: int) -> str:
    return f"https://picsum.photos/seed/{seed}/{width}/{height}"


def _slug_and_seed(title: str) -> tuple[str, str]:
    normalized = normalize_key(title)
    slug = slugify(title)
    hash_seed = hashlib.sha256(normalized.encode("utf-8")).hexdigest()[:8]
    return slug, hash_seed


def placeholder_assets(title: str) -> tuple[str, str]:
    slug, hash_seed = _slug_and_seed(title)
    thumbnail_url = placeholder_art(f"{slug}-{hash_seed}-thumb", 320, 200)
    cover_url = placeholder_art(f"{slug}-{hash_seed}-cover", 512, 768)
    return thumbnail_url, cover_url


def placeholder_gallery(title: str, count: int = 4) -> List[str]:
    slug, hash_seed = _slug_and_seed(title)
    return [
        placeholder_art(f"{slug}-{hash_seed}-gallery-{idx}", 1024, 576)
        for idx in range(count)
    ]


class PlaceholderMetadataProvider:
    """Offline metadata provider that keeps the UI interesting without API keys."""

    def build_game(
        self, title: str, platform: Optional[str] = None, source: Optional[str] = None
    ) -> Game:
        normalized = normalize_key(title)
        catalog = HANDCRAFTED_METADATA.get(normalized, {})
        thumbnail_url, cover_url = placeholder_assets(title)
        trailer_url = catalog.get("trailer_url") or DEFAULT_TRAILER
        description = catalog.get("description") or DEFAULT_DESCRIPTION
        gallery_urls = catalog.get("gallery_urls") or placeholder_gallery(title)
        rating = catalog.get("rating")

        return Game(
            title=title,
            platform=platform,
            source=source or platform,
            description=description,
            thumbnail_url=catalog.get("thumbnail_url") or thumbnail_url,
            cover_url=catalog.get("cover_url") or cover_url,
            trailer_url=trailer_url,
            rating=rating,
            gallery_urls=gallery_urls,
        )


class IgdbClient:
    TOKEN_URL = "https://id.twitch.tv/oauth2/token"
    API_BASE = "https://api.igdb.com/v4"

    def __init__(self, client_id: str, client_secret: str, timeout: float = 10.0) -> None:
        self.client_id = client_id
        self.client_secret = client_secret
        self._token: Optional[str] = None
        self._token_expiry: float = 0
        self._http = httpx.Client(timeout=timeout)

    def _auth_headers(self) -> Dict[str, str]:
        if not self._token or time.time() >= self._token_expiry:
            self._refresh_token()
        assert self._token  # for type checkers
        return {"Client-ID": self.client_id, "Authorization": f"Bearer {self._token}"}

    def _refresh_token(self) -> None:
        response = self._http.post(
            self.TOKEN_URL,
            params={
                "client_id": self.client_id,
                "client_secret": self.client_secret,
                "grant_type": "client_credentials",
            },
        )
        response.raise_for_status()
        payload = response.json()
        self._token = payload["access_token"]
        self._token_expiry = time.time() + int(payload.get("expires_in", 3600)) - 60

    def search_game(self, title: str) -> Optional[Dict]:
        query_title = title.replace('"', " ")
        query = (
            f'search "{query_title}";'
            " fields name,summary,platforms.name,platforms.abbreviation,"
            "cover.image_id,artworks.image_id,screenshots.image_id,videos.video_id,"
            "total_rating;"
            " limit 1;"
        )

        response = self._http.post(
            f"{self.API_BASE}/games",
            data=query,
            headers=self._auth_headers(),
        )
        response.raise_for_status()
        data = response.json()
        return data[0] if data else None


class IgdbMetadataProvider:
    def __init__(self, client_id: str, client_secret: str) -> None:
        self.client = IgdbClient(client_id, client_secret)

    def build_game(
        self, title: str, platform: Optional[str] = None, source: Optional[str] = None
    ) -> Game:
        record = self.client.search_game(title)
        if not record:
            raise MetadataLookupError(f"No IGDB match for '{title}'")

        thumbnail_url, cover_url = self._image_urls(record, title)
        gallery_urls = self._gallery_urls(record, title)
        trailer_url = self._trailer_url(record)
        description = record.get("summary") or DEFAULT_DESCRIPTION
        resolved_platform = platform or self._platform_name(record)
        resolved_source = source or resolved_platform
        rating_value = record.get("total_rating")
        if rating_value is not None:
            rating_value = round(rating_value, 1)

        return Game(
            title=record.get("name") or title,
            platform=resolved_platform,
            source=resolved_source,
            description=description,
            thumbnail_url=thumbnail_url,
            cover_url=cover_url,
            trailer_url=trailer_url or DEFAULT_TRAILER,
            rating=rating_value,
            gallery_urls=gallery_urls,
        )

    @staticmethod
    def _platform_name(record: Dict) -> Optional[str]:
        platforms: Sequence[Dict] = record.get("platforms") or []
        if not platforms:
            return None
        platform = platforms[0]
        return platform.get("abbreviation") or platform.get("name")

    @staticmethod
    def _image_id(record: Dict) -> Optional[str]:
        cover = record.get("cover")
        if cover and cover.get("image_id"):
            return cover["image_id"]
        for field in ("screenshots", "artworks"):
            entries: Sequence[Dict] = record.get(field) or []
            if entries:
                candidate = entries[0].get("image_id")
                if candidate:
                    return candidate
        return None

    def _image_urls(self, record: Dict, title: str) -> tuple[str, str]:
        image_id = self._image_id(record)
        if image_id:
            thumbnail = f"https://images.igdb.com/igdb/image/upload/t_cover_big/{image_id}.jpg"
            cover = f"https://images.igdb.com/igdb/image/upload/t_1080p/{image_id}.jpg"
            return thumbnail, cover

        return placeholder_assets(title)

    def _gallery_urls(self, record: Dict, title: str) -> List[str]:
        gallery: List[str] = []
        for field in ("screenshots", "artworks"):
            entries: Sequence[Dict] = record.get(field) or []
            for entry in entries[:6]:
                image_id = entry.get("image_id")
                if image_id:
                    gallery.append(
                        f"https://images.igdb.com/igdb/image/upload/t_screenshot_huge/{image_id}.jpg"
                    )
        if not gallery:
            return placeholder_gallery(title)
        return gallery

    @staticmethod
    def _trailer_url(record: Dict) -> Optional[str]:
        videos: Sequence[Dict] = record.get("videos") or []
        if not videos:
            return None
        video_id = videos[0].get("video_id")
        if not video_id:
            return None
        return f"https://www.youtube.com/embed/{video_id}?rel=0"


class MetadataProvider:
    """Metadata provider that prefers IGDB but falls back to offline placeholders."""

    def __init__(self) -> None:
        client_id = os.getenv("IGDB_CLIENT_ID")
        client_secret = os.getenv("IGDB_CLIENT_SECRET")
        self.offline_provider = PlaceholderMetadataProvider()
        self.primary_provider: Optional[IgdbMetadataProvider] = None

        if client_id and client_secret:
            self.primary_provider = IgdbMetadataProvider(client_id, client_secret)
            logger.info("IGDB metadata provider enabled.")
        else:
            logger.warning(
                "IGDB_CLIENT_ID/IGDB_CLIENT_SECRET not set. Using placeholder metadata."
            )

    def build_game(
        self, title: str, platform: Optional[str] = None, source: Optional[str] = None
    ) -> Game:
        if self.primary_provider:
            try:
                return self.primary_provider.build_game(title, platform, source)
            except Exception as exc:  # pragma: no cover - best-effort logging
                logger.warning("Falling back to placeholder metadata: %s", exc)

        return self.offline_provider.build_game(title, platform, source)
