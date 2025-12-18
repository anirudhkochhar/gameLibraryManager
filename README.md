# Game Library Integrator

Browser-first experience that lets you upload a plain text export of the games you own on Steam, Epic, Amazon/Prime Gaming and GOG, then browse them inside a unified, searchable grid. The FastAPI backend is intentionally tiny so you can later plug in Playnite-like metadata extensions such as IGDB, RAWG or the Steam Storefront APIs.

## Getting started

```bash
# From the repo root
conda create -y -p ./.condaenv python=3.10
./.condaenv/bin/pip install -r requirements.txt
./.condaenv/bin/uvicorn app.main:app --reload
```

Then open <http://127.0.0.1:8000/> in your browser. The UI automatically fetches a sample library so you can play with the grid before uploading your own text file.

### IGDB integration

IGDB data is fetched through Twitch Developer credentials. Create an application on <https://dev.twitch.tv/console/apps>, copy the **Client ID** and generate a **Client Secret**, then expose them to the backend:

```bash
export IGDB_CLIENT_ID=<twitch client id>
export IGDB_CLIENT_SECRET=<twitch client secret>
```

or drop them inside a local `.env` file (loaded automatically):

```
IGDB_CLIENT_ID=xxxx
IGDB_CLIENT_SECRET=yyyy
```

If the variables are missing, the API falls back to deterministic placeholder art/metadata so the UI still works offline.

## Text file format

Each non-empty line is treated as a game entry. Comments starting with `#` are ignored.

```
Steam: Baldur's Gate 3
Epic Games Store: Alan Wake 2
GOG: The Witcher 3: Wild Hunt | PC
Amazon: Ghostwire Tokyo | PS5
```

* Prefix notation (`Steam: ...`) identifies the source/store.
* Suffix notation (`| PC`) is treated as a platform override.
* If both notations are present, the suffix becomes the platform and the prefix remains as the store/source.

You can use `samples/sample-library.txt` as a template.

## API surface

| Endpoint | Description |
| --- | --- |
| `POST /api/games/upload` | Multipart form upload (`file` field). Returns an array of enriched `Game` objects. |
| `GET /api/games/sample` | Quick starter library using the offline metadata catalog. |
| `GET /api/health` | Liveness probe for deployment environments. |
| `POST /api/profile/save` | Persist the current library (titles/platforms) to a user-selected folder. |
| `POST /api/profile/load` | Rebuild a library from a previously saved profile. |

The metadata layer is handled by `app/metadata.py`. With IGDB credentials present it hydrates each entry using IGDB's API, and if credentials are missing or the lookup fails it falls back to deterministic placeholder assets so the grid always renders.

## Frontend UX

* Upload text exports directly from the hero card or reuse the sample data.
* Search-as-you-type filters across title, platform/store and description.
* Cards expand inline—click one to open a spotlight pane right under the tile with cover art, IGDB screenshots, trailer, IGDB rating and a “Back to grid” toggle. Switch between the dense list view or masonry grid via the layout pills above the search bar.
* Profiles persist the names/platforms you uploaded—pick any directory (e.g. on an external drive) and use the Load/Save buttons. The browser remembers that directory and automatically reloads the profile on your next visit.
* Gallery thumbnails deep-link to the IGDB CDN so you can inspect the original full-resolution renders.

Because everything is static assets under `static/`, the FastAPI app simply mounts the directory. Swap it for any SPA framework later if you need routing, authentication or data caching.

## Next steps

1. **Metadata extensions** – add modules that call IGDB, Steamworks Web API, the Epic Catalog or Amazon's Prime Gaming data so each entry gets real box art, release dates and genres.
2. **Persistent library** – store parsed games in SQLite/Postgres with per-user accounts instead of keeping everything in-memory.
3. **Marketplace syncing** – Schedule background jobs that hit each store's API to refresh entitlements, similar to how Playnite extensions work.
4. **Richer filters** – add tags, genres, backlog/completed states and sorting (recently added, playtime, metascore, etc.).
