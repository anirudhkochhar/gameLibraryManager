"""Pydantic models shared across the Game Library API."""

from typing import Optional

from pydantic import BaseModel, Field, HttpUrl


class Game(BaseModel):
    """Metadata that the frontend knows how to render for a game."""

    title: str
    platform: Optional[str] = None
    source: Optional[str] = None
    description: str
    thumbnail_url: HttpUrl
    cover_url: HttpUrl
    trailer_url: Optional[HttpUrl] = None
    rating: Optional[float] = None
    gallery_urls: list[HttpUrl] = Field(default_factory=list)


class GameCollection(BaseModel):
    games: list[Game]
