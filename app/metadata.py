"""Helpers that enrich a plain game title with metadata for the grid view."""

from __future__ import annotations

import csv
import hashlib
import logging
import os
import re
import time
from difflib import SequenceMatcher
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import httpx

from .models import Game

logger = logging.getLogger(__name__)
BASE_DIR = Path(__file__).resolve().parent.parent
RATINGS_PATH = BASE_DIR / "database" / "critic_ratings.csv"

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
EXCLUDED_KEYWORDS = {"bundle", "mobile"}
STRIP_KEYWORDS = {"goty", "game of the year", "edition"}


class MetadataLookupError(RuntimeError):
    """Raised when a provider fails to resolve metadata for a title."""


def normalize_key(value: str) -> str:
    """Return a normalized key for easy dictionary lookups."""
    cleaned = re.sub(r"[^a-z0-9]+", " ", value.lower())
    return re.sub(r"\s+", " ", cleaned).strip()


def normalize_optional(value: Optional[str]) -> str:
    if not value:
        return ""
    return normalize_key(value)


def slugify(value: str) -> str:
    return normalize_key(value).replace(" ", "-") or "game"


def strip_keywords(value: str) -> str:
    normalized = normalize_key(value)
    for keyword in STRIP_KEYWORDS:
        normalized = normalized.replace(keyword, " ")
    normalized = re.sub(r"\s+", " ", normalized).strip()
    return normalized if normalized else value


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
            record_id=None,
            description=description,
            thumbnail_url=catalog.get("thumbnail_url") or thumbnail_url,
            cover_url=catalog.get("cover_url") or cover_url,
            trailer_url=trailer_url,
            rating=rating,
            gallery_urls=gallery_urls,
            status="not_allocated",
            finish_count=0,
            genres=catalog.get("genres") or [],
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

    def search_games(
        self, title: str, limit: int = 5, strip_input: bool = True
    ) -> list[Dict]:
        query_value = strip_keywords(title) if strip_input else title
        query_title = query_value.replace('"', " ")
        query = (
            f'search "{query_title}";'
            " fields name,summary,platforms.name,platforms.abbreviation,"
            "cover.image_id,artworks.image_id,screenshots.image_id,videos.video_id,"
            "genres.name;"
            f" limit {limit};"
        )

        response = self._http.post(
            f"{self.API_BASE}/games",
            data=query,
            headers=self._auth_headers(),
        )
        response.raise_for_status()
        results = response.json()
        logger.debug("IGDB search for '%s' returned %s results", title, len(results))
        return results

    def get_game_by_id(self, record_id: int) -> Optional[Dict]:
        query = (
            f"where id = {record_id};"
            " fields name,summary,platforms.name,platforms.abbreviation,"
            "cover.image_id,artworks.image_id,screenshots.image_id,videos.video_id,"
            "genres.name;"
        )
        response = self._http.post(
            f"{self.API_BASE}/games",
            data=query,
            headers=self._auth_headers(),
        )
        response.raise_for_status()
        results = response.json()
        return results[0] if results else None


class IgdbMetadataProvider:
    def __init__(self, client_id: str, client_secret: str) -> None:
        self.client = IgdbClient(client_id, client_secret)

    def build_game(
        self,
        title: str,
        platform: Optional[str] = None,
        source: Optional[str] = None,
        record_id: Optional[int] = None,
    ) -> Game:
        if record_id is not None:
            record = self.client.get_game_by_id(record_id)
            if record:
                return self._build_from_record(record, title, platform, source)

        records = self.client.search_games(title)
        record = self._select_record(records, title)
        if not record:
            raise MetadataLookupError(f"No IGDB match for '{title}'")

        return self._build_from_record(record, title, platform, source)

    def build_game_from_record(
        self, record: Dict, fallback_title: str, platform: Optional[str], source: Optional[str]
    ) -> Game:
        return self._build_from_record(record, fallback_title, platform, source)

    def _build_from_record(
        self, record: Dict, fallback_title: str, platform: Optional[str], source: Optional[str]
    ) -> Game:
        thumbnail_url, cover_url = self._image_urls(record, fallback_title)
        gallery_urls = self._gallery_urls(record, fallback_title)
        trailer_url = self._trailer_url(record)
        description = record.get("summary") or DEFAULT_DESCRIPTION
        resolved_platform = platform or self._platform_name(record)
        resolved_source = source or resolved_platform
        user_title = (fallback_title or "").strip()
        resolved_title = (
            user_title or record.get("name") or fallback_title or "Untitled Game"
        )
        genres = self._genre_names(record)

        return Game(
            title=resolved_title,
            platform=resolved_platform,
            source=resolved_source,
            record_id=record.get("id"),
            description=description,
            thumbnail_url=thumbnail_url,
            cover_url=cover_url,
            trailer_url=trailer_url or DEFAULT_TRAILER,
            rating=None,
            gallery_urls=gallery_urls,
            status="not_allocated",
            finish_count=0,
            genres=genres,
        )

    @staticmethod
    def _select_record(records: list[Dict], original_title: str) -> Optional[Dict]:
        normalized_input = normalize_key(strip_keywords(original_title))
        for record in records:
            name = record.get("name") or ""
            lower_name = name.lower()
            excluded = any(
                keyword in lower_name and keyword not in normalized_input
                for keyword in EXCLUDED_KEYWORDS
            )
            if excluded:
                continue
            return record
        return records[0] if records else None

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

    @staticmethod
    def _genre_names(record: Dict) -> list[str]:
        genres: Sequence[Dict] = record.get("genres") or []
        names: list[str] = []
        for entry in genres:
            name = entry.get("name")
            if name:
                names.append(name)
        return names


class MetadataProvider:
    """Metadata provider that prefers IGDB but falls back to offline placeholders."""

    def __init__(self) -> None:
        client_id = os.getenv("IGDB_CLIENT_ID")
        client_secret = os.getenv("IGDB_CLIENT_SECRET")
        self.offline_provider = PlaceholderMetadataProvider()
        self.primary_provider: Optional[IgdbMetadataProvider] = None
        self._cache: Dict[Tuple[str, str, str, Optional[int]], Game] = {}
        self._ratings_map, self._ratings_entries = self._load_critic_ratings()

        if client_id and client_secret:
            self.primary_provider = IgdbMetadataProvider(client_id, client_secret)
            logger.info("IGDB metadata provider enabled.")
        else:
            logger.warning(
                "IGDB_CLIENT_ID/IGDB_CLIENT_SECRET not set. Using placeholder metadata."
            )

    @staticmethod
    def _load_critic_ratings() -> tuple[Dict[str, tuple[str, float]], list[tuple[str, str, float]]]:
        ratings_map: Dict[str, tuple[str, float]] = {}
        entries: list[tuple[str, str, float]] = []
        if not RATINGS_PATH.exists():
            logger.warning("Critic ratings file not found at %s", RATINGS_PATH)
            return ratings_map, entries
        try:
            with RATINGS_PATH.open(newline="", encoding="utf-8") as handle:
                reader = csv.DictReader(handle)
                for row in reader:
                    title = (row.get("title") or "").strip()
                    score_value = (row.get("score") or "").strip()
                    if not title or not score_value:
                        continue
                    try:
                        score = float(score_value)
                    except ValueError:
                        continue
                    normalized = normalize_key(title)
                    ratings_map[normalized] = (title, score)
                    entries.append((normalized, title, score))
        except OSError as exc:
            logger.warning("Failed to read critic ratings file: %s", exc)
        return ratings_map, entries

    @staticmethod
    def _cache_key(
        title: str,
        platform: Optional[str],
        source: Optional[str],
        record_id: Optional[int],
    ) -> Tuple[str, str, str, Optional[int]]:
        normalized_title = normalize_key(title)
        platform_key = normalize_optional(platform)
        source_key = normalize_optional(source)
        return (normalized_title, platform_key, source_key, record_id)

    def build_game(
        self,
        title: str,
        platform: Optional[str] = None,
        source: Optional[str] = None,
        record_id: Optional[int] = None,
    ) -> Game:
        cache_key = self._cache_key(title, platform, source, record_id)
        cached = self._cache.get(cache_key)
        if cached:
            logger.debug(
                "Metadata cache hit for title='%s' platform='%s' source='%s' record_id=%s",
                title,
                platform,
                source,
                record_id,
            )
            return cached

        if self.primary_provider:
            try:
                game = self.primary_provider.build_game(
                    title, platform, source, record_id=record_id
                )
                self._cache[cache_key] = game
                logger.debug(
                    "Metadata cache store (IGDB) for title='%s' platform='%s' source='%s' record_id=%s",
                    title,
                    platform,
                    source,
                    record_id,
                )
                game = game.copy(update={"igdb_match": True})
                return self._apply_critic_rating(game)
            except MetadataLookupError:
                game = self._empty_game(title, platform, source, record_id)
                self._cache[cache_key] = game
                logger.info(
                    "No IGDB match for title='%s' platform='%s' source='%s' record_id=%s",
                    title,
                    platform,
                    source,
                    record_id,
                )
                return self._apply_critic_rating(game)
            except Exception as exc:  # pragma: no cover - best-effort logging
                logger.warning("Falling back to placeholder metadata: %s", exc)

        game = self.offline_provider.build_game(title, platform, source)
        game = game.copy(update={"igdb_match": False})
        game = self._apply_critic_rating(game)
        self._cache[cache_key] = game
        logger.debug(
            "Metadata cache store (placeholder) for title='%s' platform='%s' source='%s'",
            title,
            platform,
            source,
        )
        return game

    def _apply_critic_rating(self, game: Game) -> Game:
        rating, match_title = self._lookup_critic_rating(game.title)
        return game.copy(
            update={
                "rating": rating,
                "rating_match_title": match_title,
                "rating_verified": False,
                "rating_manual": False,
            }
        )

    def _lookup_critic_rating(self, title: str) -> tuple[Optional[float], Optional[str]]:
        normalized = normalize_key(title)
        if not normalized:
            return None, None

        exact = self._ratings_map.get(normalized)
        if exact:
            matched_title, score = exact
            match_title = None if normalize_key(matched_title) == normalized else matched_title
            return score, match_title

        if not self._ratings_entries:
            return None, None

        best_ratio = 0.0
        best_entry: Optional[tuple[str, str, float]] = None
        for key, matched_title, score in self._ratings_entries:
            ratio = SequenceMatcher(None, normalized, key).ratio()
            if ratio > best_ratio:
                best_ratio = ratio
                best_entry = (key, matched_title, score)

        if not best_entry or best_ratio < 0.6:
            return None, None

        key, matched_title, score = best_entry
        match_title = None if normalize_key(matched_title) == normalized else matched_title
        return score, match_title

    def search_critic_ratings(self, query: str, limit: int = 8) -> list[Dict[str, float]]:
        normalized = normalize_key(query)
        if not normalized or not self._ratings_entries:
            return []

        scored: list[tuple[float, str, float]] = []
        for key, matched_title, score in self._ratings_entries:
            ratio = SequenceMatcher(None, normalized, key).ratio()
            if normalized in key:
                ratio += 0.25
            if ratio < 0.35:
                continue
            scored.append((ratio, matched_title, score))

        scored.sort(key=lambda item: (-item[0], item[1]))
        results: list[Dict[str, float]] = []
        seen = set()
        for _, title, score in scored:
            if title in seen:
                continue
            results.append({"title": title, "score": score})
            seen.add(title)
            if len(results) >= limit:
                break
        return results

    def rating_for_title(self, title: str) -> Optional[float]:
        normalized = normalize_key(title)
        if not normalized:
            return None
        match = self._ratings_map.get(normalized)
        return match[1] if match else None

    @staticmethod
    def _empty_game(
        title: str,
        platform: Optional[str],
        source: Optional[str],
        record_id: Optional[int],
    ) -> Game:
        return Game(
            title=title,
            platform=platform,
            source=source or platform,
            record_id=record_id,
            description="",
            thumbnail_url=None,
            cover_url=None,
            trailer_url=None,
            rating=None,
            rating_match_title=None,
            rating_verified=False,
            rating_manual=False,
            igdb_match=False,
            gallery_urls=[],
            status="not_allocated",
            finish_count=0,
            genres=[],
        )

    def search_top_games(
        self,
        title: str,
        platform: Optional[str] = None,
        source: Optional[str] = None,
        limit: int = 10,
    ) -> list[Game]:
        if not self.primary_provider:
            return [self.offline_provider.build_game(title, platform, source)]
        try:
            records = self.primary_provider.client.search_games(
                title, limit=limit, strip_input=False
            )
            logger.debug(
                "Search top games for '%s' yielded %s records", title, len(records)
            )
            games = []
            for record in records:
                try:
                    games.append(
                        self.primary_provider.build_game_from_record(
                            record, title, platform, source
                        )
                    )
                except Exception:
                    continue
            return games or [self.offline_provider.build_game(title, platform, source)]
        except Exception as exc:
            logger.warning("Failed to fetch IGDB choices: %s", exc)
            return [self.offline_provider.build_game(title, platform, source)]

    def search_suggestions(self, title: str, limit: int = 5) -> list[Dict[str, str]]:
        if not self.primary_provider:
            logger.debug("No IGDB provider configured; returning empty suggestions.")
            return []
        try:
            records = self.primary_provider.client.search_games(
                title, limit=limit, strip_input=False
            )
            suggestions: list[Dict[str, str]] = []
            for record in records:
                name = record.get("name")
                if not name:
                    continue
                suggestions.append(
                    {
                        "title": name,
                        "description": record.get("summary") or "",
                        "record_id": record.get("id"),
                    }
                )
            logger.debug(
                "Suggestion search for '%s' produced %s candidates",
                title,
                len(suggestions),
            )
            return suggestions
        except Exception as exc:
            logger.warning("Failed to fetch suggestions: %s", exc)
            return []
