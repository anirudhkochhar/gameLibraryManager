"""FastAPI entry point for the Game Library Manager prototype."""

from __future__ import annotations

import json
import logging
from pathlib import Path
from typing import Iterable, Optional, Tuple

from dotenv import load_dotenv
from fastapi import APIRouter, FastAPI, File, HTTPException, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from .metadata import MetadataProvider
from .models import Game, GameCollection

load_dotenv()

BASE_DIR = Path(__file__).resolve().parent.parent
STATIC_DIR = BASE_DIR / "static"
STORE_KEYWORDS = {
    "steam",
    "epic",
    "epic games",
    "epic games store",
    "gog",
    "gog galaxy",
    "amazon",
    "prime gaming",
}

logger = logging.getLogger(__name__)

app = FastAPI(
    title="Game Library Manager",
    description="Upload a text file and surface quick metadata for each game.",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

api_router = APIRouter(prefix="/api")
metadata_provider = MetadataProvider()
PROFILE_FILENAME = "profile.json"


class ProfileDirectory(BaseModel):
    directory: str


class ProfileEntry(BaseModel):
    title: str
    platform: Optional[str] = None
    source: Optional[str] = None
    record_id: Optional[int] = None


class ProfileSaveRequest(ProfileDirectory):
    games: list[ProfileEntry]


class ManualGameRequest(BaseModel):
    title: str
    platform: Optional[str] = None
    source: Optional[str] = None
    record_id: Optional[int] = None


@api_router.get("/health")
async def healthcheck() -> JSONResponse:
    return JSONResponse({"status": "ok"})


def _parse_line(line: str) -> Optional[Tuple[str, Optional[str], Optional[str]]]:
    raw = line.strip()
    if not raw or raw.startswith("#"):
        return None

    source = None
    if ":" in raw:
        maybe_source, remainder = raw.split(":", 1)
        if maybe_source.strip().lower() in STORE_KEYWORDS and remainder.strip():
            source = maybe_source.strip().title()
            raw = remainder.strip()

    platform = None
    if "|" in raw:
        title_part, platform_part = raw.split("|", 1)
        raw = title_part.strip()
        platform = platform_part.strip() or None

    title = raw.strip()
    if not title:
        return None

    if source and not platform:
        platform = source

    return title, platform, source


def _parse_file_payload(text: str) -> list[Game]:
    parsed_games: list[Game] = []
    for idx, line in enumerate(text.splitlines(), start=1):
        parsed = _parse_line(line)
        if not parsed:
            continue
        title, platform, source = parsed
        try:
            parsed_games.append(metadata_provider.build_game(title, platform, source))
        except Exception as exc:  # pragma: no cover - just logging for now
            logger.exception("Failed to build metadata for line %s", idx)
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Unable to process '{title}': {exc}",
            ) from exc
    return parsed_games


@api_router.post("/games/upload", response_model=GameCollection)
async def upload_games(file: UploadFile = File(...)) -> GameCollection:
    contents = await file.read()
    if not contents:
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
    try:
        text = contents.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise HTTPException(
            status_code=400, detail="File must be UTF-8 encoded text."
        ) from exc

    games = _parse_file_payload(text)
    if not games:
        raise HTTPException(
            status_code=400, detail="No games were detected. Check the file format."
        )
    return GameCollection(games=games)


@api_router.post("/games/create", response_model=Game)
async def create_game(payload: ManualGameRequest) -> Game:
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title is required.")
    return metadata_provider.build_game(
        title,
        payload.platform,
        payload.source,
        record_id=payload.record_id,
    )


class GameSuggestion(BaseModel):
    title: str
    description: Optional[str] = None
    record_id: Optional[int] = None


class GameSuggestionCollection(BaseModel):
    suggestions: list[GameSuggestion]


@api_router.post("/games/search", response_model=GameSuggestionCollection)
async def search_games(payload: ManualGameRequest) -> GameSuggestionCollection:
    title = payload.title.strip()
    if not title:
        raise HTTPException(status_code=400, detail="Title is required.")
    logger.debug("Received manual search for title='%s'", title)
    matches = metadata_provider.search_suggestions(title, limit=5)
    logger.debug("Manual search for '%s' yielded %d suggestions", title, len(matches))
    if not matches:
        raise HTTPException(status_code=404, detail="No matches found.")
    return GameSuggestionCollection(
        suggestions=[GameSuggestion(**item) for item in matches]
    )


def _profile_file(path: str) -> Path:
    directory = Path(path).expanduser()
    directory.mkdir(parents=True, exist_ok=True)
    return directory / PROFILE_FILENAME


@api_router.post("/profile/save")
async def save_profile(payload: ProfileSaveRequest) -> JSONResponse:
    file_path = _profile_file(payload.directory)
    entries = [
        {
            "title": entry.title,
            "platform": entry.platform,
            "source": entry.source,
            "record_id": entry.record_id,
        }
        for entry in payload.games
    ]
    file_path.write_text(json.dumps(entries, indent=2), encoding="utf-8")
    return JSONResponse({"path": str(file_path)})


@api_router.post("/profile/load", response_model=GameCollection)
async def load_profile(payload: ProfileDirectory) -> GameCollection:
    file_path = _profile_file(payload.directory)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Profile not found.")
    try:
        entries = json.loads(file_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(
            status_code=400, detail="Profile file is invalid JSON."
        ) from exc
    games: list[Game] = []
    for entry in entries:
        title = entry.get("title")
        if not title:
            continue
        games.append(
            metadata_provider.build_game(
                title,
                entry.get("platform"),
                entry.get("source"),
                record_id=entry.get("record_id"),
            )
        )
    if not games:
        raise HTTPException(status_code=400, detail="Profile contains no games.")
    return GameCollection(games=games)


@api_router.post("/profile/delete")
async def delete_profile(payload: ProfileDirectory) -> JSONResponse:
    file_path = _profile_file(payload.directory)
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="Profile not found.")
    file_path.unlink()
    return JSONResponse({"deleted": True})


SAMPLE_ENTRIES: Iterable[Tuple[str, Optional[str], Optional[str]]] = [
    ("Elden Ring", "Steam", "Steam"),
    ("Hades", "Epic", "Epic"),
    ("The Witcher 3: Wild Hunt", "GOG", "GOG"),
    ("Doom Eternal", "Steam", "Steam"),
    ("God of War", "Steam", "Steam"),
]


@api_router.get("/games/sample", response_model=GameCollection)
async def sample_games() -> GameCollection:
    games = [
        metadata_provider.build_game(title, platform, source)
        for title, platform, source in SAMPLE_ENTRIES
    ]
    return GameCollection(games=games)


app.include_router(api_router)


if STATIC_DIR.exists():
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")


@app.get("/", include_in_schema=False)
async def serve_index() -> FileResponse:
    index_file = STATIC_DIR / "index.html"
    if not index_file.exists():
        raise HTTPException(
            status_code=404,
            detail="Frontend assets are missing. Did you delete the static directory?",
        )
    return FileResponse(index_file)
