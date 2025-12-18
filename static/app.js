const elements = {
  form: document.getElementById("upload-form"),
  fileInput: document.getElementById("file-input"),
  sampleButton: document.getElementById("sample-button"),
  searchInput: document.getElementById("search-input"),
  status: document.getElementById("status"),
  grid: document.getElementById("game-grid"),
  template: document.getElementById("game-card-template"),
  detailTemplate: document.getElementById("detail-panel-template"),
  lightboxOverlay: document.getElementById("lightbox-overlay"),
  lightboxImage: document.getElementById("lightbox-image"),
  lightboxCloseEls: document.querySelectorAll("[data-overlay-close]"),
  lightboxFullscreen: document.querySelector("[data-overlay-fullscreen]"),
  listTemplate: document.getElementById("game-row-template"),
  viewButtons: document.querySelectorAll("[data-view-mode]"),
  loadingIndicator: document.getElementById("loading-indicator"),
  manualForm: document.getElementById("manual-form"),
  manualTitleInput: document.getElementById("manual-title"),
  manualPlatformInput: document.getElementById("manual-platform"),
  manualSourceInput: document.getElementById("manual-source"),
  profilePathInput: document.getElementById("profile-path"),
  profileLoadButton: document.getElementById("profile-load"),
  profileSaveButton: document.getElementById("profile-save"),
  profileDeleteButton: document.getElementById("profile-delete"),
  sortSelect: document.getElementById("sort-select"),
  storeFilterSelect: document.getElementById("store-filter"),
  cacheClearButton: document.getElementById("cache-clear"),
  confirmDialog: document.getElementById("confirm-dialog"),
  confirmCancelButtons: document.querySelectorAll("[data-confirm-cancel]"),
  confirmConfirmButton: document.querySelector("[data-confirm-confirm]"),
  searchDialog: document.getElementById("search-dialog"),
  searchInputField: document.getElementById("search-input-field"),
  searchFetchButton: document.getElementById("search-fetch"),
  searchCancelButtons: document.querySelectorAll("[data-search-cancel]"),
  searchConfirmButton: document.querySelector("[data-search-confirm]"),
  searchResults: document.getElementById("search-results"),
};

const state = {
  games: [],
  filtered: [],
  selection: null,
  viewMode: "grid",
  sortMode: "alphabetical",
  storeFilter: "",
  profilePath: null,
};

const detailState = {
  node: null,
  refs: null,
  galleryUrls: [],
  activeIndex: null,
};

let gameIdCounter = 0;
const BATCH_SIZE = 24;
let renderGeneration = 0;
let pendingDetailId = null;
const PROFILE_STORAGE_KEY = "glProfilePath";
const CACHE_STORAGE_KEY = "glCachedGames";
let pendingDeleteId = null;
let pendingRefineId = null;
let pendingRefineSelection = null;
let pendingRefineMatches = [];

const formatPlatform = (game) => {
  if (!game.platform && !game.source) {
    return "Unknown platform";
  }
  if (game.platform && game.source && game.platform !== game.source) {
    return `${game.platform} · ${game.source}`;
  }
  return game.platform || game.source || "Unknown platform";
};

const formatRating = (value) => {
  if (value == null) return null;
  return `${Math.round(value)}%`;
};

const applyRating = (element, rating) => {
  if (!element) return;
  const formatted = formatRating(rating);
  if (!formatted) {
    element.dataset.hidden = "true";
    element.textContent = "";
  } else {
    element.dataset.hidden = "false";
    element.textContent = formatted;
  }
};

const showStatus = (message, type = "info") => {
  if (!elements.status) return;
  elements.status.textContent = message ?? "";
  elements.status.classList.toggle("error", type === "error");
};

const showLoadingIndicator = () => {
  elements.loadingIndicator?.classList.remove("hidden");
};

const hideLoadingIndicator = () => {
  elements.loadingIndicator?.classList.add("hidden");
};

const serializeGames = (games) =>
  games.map((game) => ({
    ...game,
    gallery_urls: game.gallery_urls ?? [],
    __id: `game-${Date.now()}-${gameIdCounter++}`,
  }));

const persistGameCache = () => {
  try {
    if (!state.games.length) {
      localStorage.removeItem(CACHE_STORAGE_KEY);
      return;
    }
    const payload = state.games.map((game) => ({
      ...game,
      cachedAt: Date.now(),
    }));
    localStorage.setItem(CACHE_STORAGE_KEY, JSON.stringify(payload));
  } catch (error) {
    console.warn("Failed to cache games", error);
  }
};

const updateStoreFilterOptions = () => {
  const select = elements.storeFilterSelect;
  if (!select) return;
  const normalizedTarget = (state.storeFilter || "").toLowerCase();
  const stores = Array.from(
    new Set(
      state.games
        .map((game) => (game.source || "").trim())
        .filter((value) => value.length)
    )
  ).sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  select.innerHTML = "";
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "All stores";
  select.appendChild(defaultOption);
  stores.forEach((store) => {
    const option = document.createElement("option");
    option.value = store;
    option.textContent = store;
    select.appendChild(option);
  });
  if (normalizedTarget) {
    const matchIndex = stores.findIndex(
      (store) => store.toLowerCase() === normalizedTarget
    );
    if (matchIndex === -1) {
      state.storeFilter = "";
    } else {
      state.storeFilter = stores[matchIndex];
    }
  }
  select.disabled = stores.length === 0;
  select.value = state.storeFilter || "";
};

const ensureDetailNode = () => {
  if (detailState.node) {
    return detailState;
  }
  if (!elements.detailTemplate) {
    return null;
  }
  const node = elements.detailTemplate.content.firstElementChild.cloneNode(true);
  const refs = {
    platform: node.querySelector("[data-detail-platform]"),
    title: node.querySelector("[data-detail-title]"),
    description: node.querySelector("[data-detail-description]"),
    cover: node.querySelector("[data-detail-cover]"),
    gallery: node.querySelector("[data-detail-gallery]"),
    trailerSection: node.querySelector("[data-detail-trailer-section]"),
    trailer: node.querySelector("[data-detail-trailer]"),
    close: node.querySelector("[data-detail-close]"),
    rating: node.querySelector("[data-detail-rating]"),
    refine: node.querySelector("[data-detail-refine]"),
  };
  refs.close?.addEventListener("click", () => closeDetail());
  refs.refine?.addEventListener("click", () => openRefineDialog(state.selection));
  detailState.node = node;
  detailState.refs = refs;
  return detailState;
};

const hideLightbox = () => {
  if (!elements.lightboxOverlay) return;
  elements.lightboxOverlay.hidden = true;
  document.body.classList.remove("lightbox-open");
  detailState.activeIndex = null;
};

const openLightboxAt = (index) => {
  const urls = detailState.galleryUrls;
  if (!urls?.length || index < 0 || index >= urls.length) {
    return;
  }
  detailState.activeIndex = index;
  if (!elements.lightboxOverlay || !elements.lightboxImage) return;
  const title = detailState.refs?.title?.textContent ?? "Artwork";
  elements.lightboxImage.src = urls[index];
  elements.lightboxImage.alt = `${title} artwork`;
  elements.lightboxOverlay.hidden = false;
  document.body.classList.add("lightbox-open");
};

const stepLightbox = (delta) => {
  if (detailState.activeIndex == null) return;
  const urls = detailState.galleryUrls;
  if (!urls?.length) return;
  let nextIndex = detailState.activeIndex + delta;
  if (nextIndex < 0) {
    nextIndex = urls.length - 1;
  } else if (nextIndex >= urls.length) {
    nextIndex = 0;
  }
  openLightboxAt(nextIndex);
};

const renderGallery = (container, urls = []) => {
  container.innerHTML = "";
  if (!urls.length) {
    const placeholder = document.createElement("p");
    placeholder.className = "status";
    placeholder.textContent = "No gallery assets were provided for this title.";
    container.appendChild(placeholder);
    return;
  }

  const fragment = document.createDocumentFragment();
  urls.forEach((url, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "gallery-thumb";
    button.title = "Expand artwork";

    const image = document.createElement("img");
    image.src = url;
    image.alt = `Gallery image ${index + 1}`;
    button.appendChild(image);
    button.addEventListener("click", () => openLightboxAt(index));

    fragment.appendChild(button);
  });

  container.appendChild(fragment);
};

const closeDetail = (clearSelection = true) => {
  if (clearSelection) {
    state.selection = null;
  }
  hideLightbox();
  if (detailState.node?.parentNode) {
    detailState.node.parentNode.removeChild(detailState.node);
  }
};

const deleteGameById = (gameId) => {
  const index = state.games.findIndex((game) => game.__id === gameId);
  if (index === -1) {
    return;
  }
  const [removed] = state.games.splice(index, 1);
  state.games = [...state.games];
  if (state.selection?.__id === gameId) {
    closeDetail();
  }
  applyFilter();
  showStatus(`${removed.title} removed from the library.`);
  autoSaveProfile();
};

const requestDeleteGame = (gameId) => {
  pendingDeleteId = gameId;
  if (elements.confirmDialog) {
    elements.confirmDialog.hidden = false;
  }
};

const cancelDeleteGame = () => {
  pendingDeleteId = null;
  if (elements.confirmDialog) {
    elements.confirmDialog.hidden = true;
  }
};

const confirmDeleteGame = () => {
  if (!pendingDeleteId) return;
  deleteGameById(pendingDeleteId);
  cancelDeleteGame();
};

const openRefineDialog = (game) => {
  if (!game || !elements.searchDialog) return;
  pendingRefineId = game.__id;
  elements.searchDialog.hidden = false;
  if (elements.searchInputField) {
    elements.searchInputField.value = game.title;
    elements.searchInputField.focus();
  }
};

const cancelRefineDialog = () => {
  pendingRefineId = null;
  pendingRefineSelection = null;
  pendingRefineMatches = [];
  if (elements.searchDialog) {
    elements.searchDialog.hidden = true;
  }
  if (elements.searchResults) {
    elements.searchResults.innerHTML = "";
  }
  elements.searchConfirmButton?.setAttribute("disabled", "true");
};

const renderSearchResults = (matches = []) => {
  if (!elements.searchResults) return;
  elements.searchResults.innerHTML = "";
  if (!matches.length) {
    const info = document.createElement("p");
    info.className = "status";
    info.textContent = "Run a search to see suggestions.";
    elements.searchResults.appendChild(info);
    return;
  }
  const fragment = document.createDocumentFragment();
  matches.forEach((match, index) => {
    const item = document.createElement("article");
    item.className = "search-result";
    if (
      pendingRefineSelection &&
      pendingRefineSelection.__matchIndex === index
    ) {
      item.classList.add("active");
    }
    const title = document.createElement("h4");
    title.textContent = match.title;
    const description = document.createElement("p");
    description.textContent =
      match.description || "No summary available for this entry.";
    item.appendChild(title);
    item.appendChild(description);
    item.addEventListener("click", () => {
      pendingRefineSelection = { ...match, __matchIndex: index };
      elements.searchConfirmButton?.removeAttribute("disabled");
      elements.searchResults
        ?.querySelectorAll(".search-result")
        ?.forEach((el, idx) => {
          el.classList.toggle("active", idx === index);
        });
    });
    fragment.appendChild(item);
  });
  elements.searchResults.appendChild(fragment);
};

const fetchRefineMatches = async () => {
  const query = elements.searchInputField?.value.trim();
  if (!query) {
    showStatus("Enter a title to search.", "error");
    return;
  }
  console.debug("Fetch matches clicked with query:", query);
  showStatus("Searching IGDB…");
  elements.searchConfirmButton?.setAttribute("disabled", "true");
  pendingRefineSelection = null;
  renderSearchResults([]);
  try {
    const response = await fetch("/api/games/search", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: query }),
    });
    if (!response.ok) {
      console.error("Fetch matches failed with status", response.status);
      throw new Error(await parseApiError(response));
    }
    const data = await response.json();
    pendingRefineMatches = data.suggestions ?? [];
    renderSearchResults(pendingRefineMatches);
    showStatus(`Choose one of the ${pendingRefineMatches.length} matches.`);
  } catch (error) {
    showStatus(error.message, "error");
    pendingRefineMatches = [];
    renderSearchResults([]);
  }
};

const confirmRefineDialog = async () => {
  if (!pendingRefineId || !pendingRefineSelection) return;
  const existing = state.games.find((game) => game.__id === pendingRefineId);
  if (!existing) {
    cancelRefineDialog();
    return;
  }
  showStatus("Refreshing metadata…");
  try {
    const response = await fetch("/api/games/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: pendingRefineSelection.title,
        platform: existing.platform,
        source: existing.source,
        record_id: pendingRefineSelection.record_id,
      }),
    });
    if (!response.ok) {
      throw new Error(await parseApiError(response));
    }
    const updatedGame = await response.json();
    const [serialized] = serializeGames([updatedGame]);
    serialized.__id = existing.__id;
    const index = state.games.findIndex((game) => game.__id === existing.__id);
	if (index !== -1) {
	  state.games[index] = serialized;
	  state.games = [...state.games];
	  state.selection = serialized;
	  applyFilter();
	  persistGameCache();
	  openDetail(serialized, { preserveSelection: true });
	  showStatus(`${serialized.title} updated.`);
	  autoSaveProfile();
	}
  } catch (error) {
    showStatus(error.message, "error");
  } finally {
    cancelRefineDialog();
  }
};
const openDetail = (
  game,
  { preserveSelection = false, scrollIntoView = false } = {}
) => {
  if (!game) {
    closeDetail();
    return;
  }

  const detail = ensureDetailNode();
  if (!detail) {
    return;
  }

  if (!preserveSelection) {
    state.selection = game;
  }

  const { refs, node } = detail;
  refs.title.textContent = game.title;
  refs.platform.textContent = formatPlatform(game);
  refs.description.textContent = game.description;
  refs.cover.src = game.cover_url;
  refs.cover.alt = `${game.title} cover art`;
  detailState.galleryUrls = game.gallery_urls || [];
  detailState.activeIndex = null;
  renderGallery(refs.gallery, detailState.galleryUrls);
  applyRating(refs.rating, game.rating);
  hideLightbox();

  if (game.trailer_url) {
    refs.trailerSection.hidden = false;
    refs.trailer.src = "";
    requestAnimationFrame(() => {
      refs.trailer.src = game.trailer_url;
    });
  } else {
    refs.trailerSection.hidden = true;
  }

  const card = elements.grid.querySelector(`[data-id="${game.__id}"]`);
  if (!card) {
    closeDetail();
    return;
  }

  card.insertAdjacentElement("afterend", node);
  if (scrollIntoView) {
    node.scrollIntoView({ behavior: "smooth", block: "start" });
  }
};

const createCard = (game) => {
  const template =
    state.viewMode === "list" ? elements.listTemplate : elements.template;
  const content = template.content.cloneNode(true);
  const card = content.querySelector(
    state.viewMode === "list" ? ".game-row" : ".game-card"
  );
  card.dataset.id = game.__id;

  if (state.viewMode === "list") {
    const thumb = card.querySelector("img.thumb");
    thumb.src = game.thumbnail_url || game.cover_url;
    thumb.alt = `${game.title} artwork`;
    card.querySelector(".info .platform").textContent = formatPlatform(game);
    card.querySelector(".info .title").textContent = game.title;
    card.querySelector(".info .description").textContent = game.description;
    applyRating(card.querySelector(".row-meta .rating-pill"), game.rating);
    const store = card.querySelector(".row-meta .store");
    store.textContent =
      game.source || game.platform || "";
  } else {
    const cover = card.querySelector("img.cover");
    cover.src = game.cover_url;
    cover.alt = `${game.title} cover art`;
    card.querySelector(".platform").textContent = formatPlatform(game);
    card.querySelector(".title").textContent = game.title;
    card.querySelector(".description").textContent = game.description;
    applyRating(card.querySelector(".card-meta .rating-pill"), game.rating);
  }

  const deleteBtn = card.querySelector(".delete-game");
  deleteBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    requestDeleteGame(game.__id);
  });

  card.addEventListener("click", () => openDetail(game, { scrollIntoView: true }));
  card.addEventListener("keypress", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDetail(game, { scrollIntoView: true });
    }
  });

  return card;
};

const renderGrid = (games) => {
  renderGeneration += 1;
  const generation = renderGeneration;
  elements.grid.innerHTML = "";
  elements.grid.classList.toggle("list-view", state.viewMode === "list");
  if (!games.length) {
    closeDetail();
    hideLoadingIndicator();
    elements.grid.innerHTML =
      '<p class="status">No games match the current filter.</p>';
    return;
  }

  pendingDetailId = state.selection ? state.selection.__id : null;
  showLoadingIndicator();
  streamRender(generation, games);
};

const streamRender = async (generation, games) => {
  const queue = [...games];
  while (queue.length && generation === renderGeneration) {
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < BATCH_SIZE && queue.length; i += 1) {
      const game = queue.shift();
      fragment.appendChild(createCard(game));
    }
    elements.grid.appendChild(fragment);

    if (pendingDetailId) {
      const targetCard = elements.grid.querySelector(
        `[data-id="${pendingDetailId}"]`
      );
      if (targetCard && state.selection) {
        openDetail(state.selection, { preserveSelection: true });
        pendingDetailId = null;
      }
    }

    await new Promise((resolve) => requestAnimationFrame(resolve));
  }

  if (generation !== renderGeneration) {
    return;
  }

  hideLoadingIndicator();
  pendingDetailId = null;
  if (!state.selection) {
    closeDetail(false);
  } else {
    const stillVisible = games.find((g) => g.__id === state.selection.__id);
    if (!stillVisible) {
      closeDetail();
    } else {
      openDetail(stillVisible, { preserveSelection: true });
    }
  }
};

const renderNextBatch = () => {
  // No-op retained for legacy callers (if any).
};

const compareTitles = (a, b) =>
  (a.title || "").localeCompare(b.title || "", undefined, { sensitivity: "base" });

const sortGames = (games) => {
  const sorted = [...games];
  if (state.sortMode === "score") {
    sorted.sort((a, b) => {
      const ratingA = typeof a.rating === "number" ? a.rating : -Infinity;
      const ratingB = typeof b.rating === "number" ? b.rating : -Infinity;
      if (ratingB !== ratingA) {
        return ratingB - ratingA;
      }
      return compareTitles(a, b);
    });
    return sorted;
  }

  sorted.sort(compareTitles);
  return sorted;
};

const applyFilter = () => {
  const query = elements.searchInput.value.trim().toLowerCase();
  const storeFilter = (state.storeFilter || "").toLowerCase();

  state.filtered = state.games.filter((game) => {
    const haystack = `${game.title} ${game.platform ?? ""} ${
      game.source ?? ""
    } ${game.description}`.toLowerCase();
    const matchesQuery = !query || haystack.includes(query);
    const matchesStore =
      !storeFilter || (game.source || "").toLowerCase() === storeFilter;
    return matchesQuery && matchesStore;
  });

  state.filtered = sortGames(state.filtered);
  renderGrid(state.filtered);

  let message = "";
  if (!query && !storeFilter) {
    message = `Displaying ${state.filtered.length} games.`;
  } else if (query && storeFilter) {
    message = `Found ${state.filtered.length} result(s) for “${query}” in ${state.storeFilter}.`;
  } else if (query) {
    message = `Found ${state.filtered.length} result(s) for “${query}”.`;
  } else {
    message = `Displaying ${state.filtered.length} games from ${state.storeFilter}.`;
  }
  showStatus(message);
};

const ingestGames = (games, { skipAutoSave = false, append = false } = {}) => {
  const serialized = serializeGames(games);
  if (append && state.games.length) {
    state.games = [...state.games, ...serialized];
  } else {
    state.games = serialized;
  }
  state.selection = null;
  elements.searchInput.value = "";
  updateStoreFilterOptions();
  applyFilter();
  closeDetail();
  persistGameCache();
  if (!skipAutoSave) {
    autoSaveProfile();
  }
};

const parseApiError = async (response) => {
  try {
    const data = await response.json();
    return data.detail || data.message || "Unknown error";
  } catch {
    return response.statusText || "Unknown error";
  }
};

const getProfilePathInput = () => elements.profilePathInput?.value.trim() || "";

const persistProfilePath = (path) => {
  state.profilePath = path || null;
  if (elements.profilePathInput) {
    elements.profilePathInput.value = path || "";
  }
  try {
    if (path) {
      localStorage.setItem(PROFILE_STORAGE_KEY, path);
    } else {
      localStorage.removeItem(PROFILE_STORAGE_KEY);
    }
  } catch (error) {
    console.warn("Unable to persist profile path", error);
  }
};

const saveProfile = async (path, { silent = false } = {}) => {
  if (!path) throw new Error("Profile directory is required.");
  if (!state.games.length) throw new Error("No games to save.");
  const payload = {
    directory: path,
    games: state.games.map((game) => ({
      title: game.title,
      platform: game.platform,
      source: game.source,
      record_id: game.record_id ?? null,
    })),
  };
  try {
    if (!silent) {
      showStatus("Saving profile…");
    }
    const response = await fetch("/api/profile/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(await parseApiError(response));
    }
    persistProfilePath(path);
    if (!silent) {
      showStatus("Profile saved.");
    }
  } catch (error) {
    if (!silent) {
      showStatus(error.message, "error");
    }
    throw error;
  }
};

const loadProfile = async (path) => {
  if (!path) {
    showStatus("Enter a profile directory.", "error");
    return;
  }
  showStatus("Loading profile…");
  try {
    const response = await fetch("/api/profile/load", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ directory: path }),
    });
    if (!response.ok) {
      throw new Error(await parseApiError(response));
    }
    const data = await response.json();
    persistProfilePath(path);
    ingestGames(data.games ?? [], { skipAutoSave: true });
    showStatus(`Profile loaded from ${path}.`);
  } catch (error) {
    showStatus(error.message, "error");
  }
};

const deleteProfile = async (path) => {
  if (!path) {
    throw new Error("Profile directory is required.");
  }
  showStatus("Deleting profile…");
  try {
    const response = await fetch("/api/profile/delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ directory: path }),
    });
    if (!response.ok) {
      throw new Error(await parseApiError(response));
    }
    persistProfilePath("");
    ingestGames([], { skipAutoSave: true });
    localStorage.removeItem(CACHE_STORAGE_KEY);
    showStatus("Profile deleted.");
  } catch (error) {
    showStatus(error.message, "error");
    throw error;
  }
};

const autoSaveProfile = () => {
  if (!state.profilePath || !state.games.length) {
    return;
  }
  saveProfile(state.profilePath, { silent: true }).catch((error) =>
    console.warn("Auto profile save failed", error)
  );
};

const handleManualAdd = async (event) => {
  event.preventDefault();
  const title = elements.manualTitleInput?.value.trim();
  if (!title) {
    showStatus("Enter a title before adding.", "error");
    return;
  }
  const payload = {
    title,
    platform: elements.manualPlatformInput?.value.trim() || undefined,
    source: elements.manualSourceInput?.value.trim() || undefined,
  };
  showStatus("Adding game…");
  try {
    const response = await fetch("/api/games/create", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!response.ok) {
      throw new Error(await parseApiError(response));
    }
    const game = await response.json();
    const [gameWithId] = serializeGames([game]);
    state.games = [gameWithId, ...state.games];
    if (elements.manualForm) {
      elements.manualForm.reset();
    }
    applyFilter();
    persistGameCache();
    showStatus(`${gameWithId.title} added to your library.`);
    autoSaveProfile();
  } catch (error) {
    showStatus(error.message, "error");
  }
};

const setViewMode = (mode) => {
  if (state.viewMode === mode) return;
  state.viewMode = mode;
  elements.viewButtons?.forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.viewMode === mode);
  });
  const source = state.filtered.length ? state.filtered : state.games;
  if (!source.length) {
    return;
  }
  renderGrid(sortGames(source));
};

elements.lightboxCloseEls?.forEach((el) =>
  el.addEventListener("click", (event) => {
    event.preventDefault();
    hideLightbox();
  })
);

elements.lightboxFullscreen?.addEventListener("click", () => {
  const url = elements.lightboxImage?.src;
  if (url) {
    window.open(url, "_blank", "noopener");
  }
});

document.addEventListener("keydown", (event) => {
  if (elements.lightboxOverlay?.hidden) {
    return;
  }
  if (event.key === "Escape") {
    hideLightbox();
  } else if (event.key === "ArrowRight") {
    event.preventDefault();
    stepLightbox(1);
  } else if (event.key === "ArrowLeft") {
    event.preventDefault();
    stepLightbox(-1);
  }
});

const handleUpload = async (event) => {
  event.preventDefault();
  const file = elements.fileInput.files[0];
  if (!file) {
    showStatus("Choose a .txt file that lists your games.", "error");
    return;
  }
  const formData = new FormData();
  formData.append("file", file);

  showStatus("Loading library…");
  try {
    const response = await fetch("/api/games/upload", {
      method: "POST",
      body: formData,
    });
    if (!response.ok) {
      const message = await parseApiError(response);
      throw new Error(message);
    }
    const data = await response.json();
    ingestGames(data.games ?? [], { append: true });
    showStatus(`Loaded ${data.games.length} games from ${file.name}.`);
  } catch (error) {
    console.error(error);
    showStatus(error.message, "error");
  }
};

const loadSampleLibrary = async () => {
  showStatus("Fetching sample library…");
  try {
    const response = await fetch("/api/games/sample");
    if (!response.ok) {
      const message = await parseApiError(response);
      throw new Error(message);
    }
    const data = await response.json();
    ingestGames(data.games ?? []);
    showStatus("Sample library loaded. Try uploading your own export next!");
  } catch (error) {
    console.error(error);
    showStatus(error.message, "error");
  }
};

elements.form?.addEventListener("submit", handleUpload);
elements.sampleButton?.addEventListener("click", loadSampleLibrary);
elements.searchInput?.addEventListener("input", () => {
  if (!state.games.length) {
    return;
  }
  applyFilter();
});

elements.viewButtons?.forEach((button) => {
  button.addEventListener("click", () => setViewMode(button.dataset.viewMode));
});
elements.sortSelect?.addEventListener("change", (event) => {
  const mode = event.target.value;
  state.sortMode = mode === "score" ? "score" : "alphabetical";
  if (state.games.length) {
    applyFilter();
  }
});
elements.storeFilterSelect?.addEventListener("change", (event) => {
  state.storeFilter = event.target.value || "";
  applyFilter();
});

elements.manualForm?.addEventListener("submit", handleManualAdd);
elements.profileLoadButton?.addEventListener("click", () => {
  const path = getProfilePathInput();
  if (!path) {
    showStatus("Enter a profile directory.", "error");
    return;
  }
  loadProfile(path);
});

elements.profileSaveButton?.addEventListener("click", () => {
  const path = getProfilePathInput() || state.profilePath;
  if (!path) {
    showStatus("Enter a profile directory before saving.", "error");
    return;
  }
  saveProfile(path).catch(() => {});
});

elements.profileDeleteButton?.addEventListener("click", async () => {
  const path = getProfilePathInput() || state.profilePath;
  if (!path) {
    showStatus("Enter a profile directory before deleting.", "error");
    return;
  }
  try {
    await deleteProfile(path);
  } catch {
    // Errors are surfaced via showStatus.
  }
});

const bootstrapProfile = () => {
  let stored = null;
  try {
    stored = localStorage.getItem(PROFILE_STORAGE_KEY);
  } catch {
    stored = null;
  }
  if (stored) {
    persistProfilePath(stored);
    loadProfile(stored);
  }

  try {
    const cached = localStorage.getItem(CACHE_STORAGE_KEY);
    if (cached) {
      const parsed = JSON.parse(cached);
      if (Array.isArray(parsed) && parsed.length) {
        ingestGames(parsed, { skipAutoSave: true });
        showStatus("Loaded cached library. Profile will refresh when available.");
      }
    }
  } catch (error) {
    console.warn("Failed to restore cache", error);
  }
};

// Wait for user interaction (upload or sample) before populating the grid.
bootstrapProfile();
elements.confirmCancelButtons?.forEach((button) => {
  button.addEventListener("click", cancelDeleteGame);
});
elements.confirmConfirmButton?.addEventListener("click", confirmDeleteGame);
elements.searchCancelButtons?.forEach((button) => {
  button.addEventListener("click", cancelRefineDialog);
});
elements.searchConfirmButton?.addEventListener("click", confirmRefineDialog);
elements.searchFetchButton?.addEventListener("click", fetchRefineMatches);
elements.cacheClearButton?.addEventListener("click", () => {
  localStorage.removeItem(CACHE_STORAGE_KEY);
  showStatus("Browser cache cleared.");
});
elements.searchCancelButtons?.forEach((button) => {
  button.addEventListener("click", cancelRefineDialog);
});
elements.searchConfirmButton?.addEventListener("click", confirmRefineDialog);
