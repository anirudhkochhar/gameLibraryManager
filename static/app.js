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
  statusFilterSelect: document.getElementById("status-filter"),
  genreFilterSelect: document.getElementById("genre-filter"),
  selectionBar: document.getElementById("selection-bar"),
  selectionCount: document.getElementById("selection-count"),
  selectionStatus: document.getElementById("selection-status"),
  selectionApplyButton: document.getElementById("selection-apply"),
  selectionClearButton: document.getElementById("selection-clear"),
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

const DEFAULT_STATUS = "not_allocated";
const STATUS_OPTIONS = [
  { value: "not_allocated", label: "Not allocated" },
  { value: "backlog", label: "Backlog" },
  { value: "playing", label: "Playing" },
  { value: "finished", label: "Finished" },
  { value: "replaying", label: "Replaying" },
];
const STATUS_LABEL_LOOKUP = STATUS_OPTIONS.reduce((acc, option) => {
  acc[option.value] = option.label;
  return acc;
}, {});
const STATUS_FILTER_LABELS = {
  ...STATUS_LABEL_LOOKUP,
  without_not_allocated: "Everything but Not allocated",
};
const UNKNOWN_GENRE_VALUE = "__unknown";
const UNKNOWN_GENRE_LABEL = "Unknown genre";
const BROKEN_IMAGE_URL =
  "data:image/svg+xml;utf8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="200" viewBox="0 0 320 200"><rect width="100%" height="100%" fill="#1b1e2a"/><path d="M40 40h240v120H40z" fill="none" stroke="#e57373" stroke-width="6"/><path d="M70 150l60-60 40 40 30-30 40 50" fill="none" stroke="#e57373" stroke-width="6"/><path d="M100 70l120 60M220 70L100 130" stroke="#e57373" stroke-width="6"/></svg>'
  );

const resolveImageUrl = (url) => (url ? url : BROKEN_IMAGE_URL);

const sanitizeStatus = (value) => {
  if (!value) return DEFAULT_STATUS;
  const normalized = value.toString().toLowerCase();
  return STATUS_OPTIONS.some((option) => option.value === normalized)
    ? normalized
    : DEFAULT_STATUS;
};

const clampFinishCount = (value) => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return 0;
  }
  return Math.floor(numeric);
};

const normalizeGame = (game) => {
  const finishValue =
    game.finish_count ?? game.finishCount ?? game.finish ?? 0;
  return {
    ...game,
    gallery_urls: game.gallery_urls ?? [],
    status: sanitizeStatus(game.status),
    finish_count: clampFinishCount(finishValue),
    genres: Array.isArray(game.genres) ? game.genres.filter(Boolean) : [],
  };
};

const populateStatusSelect = (select, { includePlaceholder = false } = {}) => {
  if (!select || select.dataset.populated === "true") {
    return;
  }
  if (includePlaceholder) {
    const placeholder = document.createElement("option");
    placeholder.value = "";
    placeholder.textContent = "Choose status…";
    select.appendChild(placeholder);
  }
  STATUS_OPTIONS.forEach((option) => {
    const node = document.createElement("option");
    node.value = option.value;
    node.textContent = option.label;
    select.appendChild(node);
  });
  select.dataset.populated = "true";
};

const state = {
  games: [],
  filtered: [],
  selection: null,
  viewMode: "grid",
  sortMode: "alphabetical",
  storeFilter: "",
  statusFilter: "",
  genreFilter: "",
  selectedIds: new Set(),
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
  if (value == null || Number.isNaN(Number(value))) return "N/A";
  return `${Math.round(value)}%`;
};

const formatStatusLabel = (value) => {
  const status = sanitizeStatus(value);
  return STATUS_LABEL_LOOKUP[status] || STATUS_LABEL_LOOKUP[DEFAULT_STATUS];
};

const applyRating = (element, rating, matchTitle, matchElement) => {
  if (!element) return;
  const formatted = formatRating(rating);
  element.dataset.hidden = "false";
  element.textContent = formatted;
  if (matchElement) {
    if (matchTitle) {
      matchElement.dataset.hidden = "false";
      matchElement.textContent = `Matched: ${matchTitle}`;
    } else {
      matchElement.dataset.hidden = "true";
      matchElement.textContent = "";
    }
  }
};

const applyStatusLabel = (element, status) => {
  if (!element) return;
  const label = formatStatusLabel(status);
  if (!label) {
    element.dataset.hidden = "true";
    element.textContent = "";
  } else {
    element.dataset.hidden = "false";
    element.textContent = label;
  }
};

const updateCardStatus = (game) => {
  if (!game) return;
  const card = elements.grid.querySelector(`[data-id="${game.__id}"]`);
  if (!card) return;
  const pill = card.classList.contains("game-row")
    ? card.querySelector(".row-meta .status-pill")
    : card.querySelector(".card-meta .status-pill");
  applyStatusLabel(pill, game.status);
};

const renderGenreTags = (container, genres = [], { limit = null } = {}) => {
  if (!container) return;
  container.innerHTML = "";
  const normalized = Array.isArray(genres) ? genres.filter(Boolean) : [];
  const values = limit ? normalized.slice(0, limit) : normalized;
  if (!values.length) {
    const badge = document.createElement("span");
    badge.className = "genre-badge genre-badge--empty";
    badge.textContent = UNKNOWN_GENRE_LABEL;
    container.appendChild(badge);
    return;
  }
  values.forEach((genre) => {
    const badge = document.createElement("span");
    badge.className = "genre-badge";
    badge.textContent = genre;
    container.appendChild(badge);
  });
  if (limit && normalized.length > limit) {
    const badge = document.createElement("span");
    badge.className = "genre-badge";
    badge.textContent = `+${normalized.length - limit}`;
    container.appendChild(badge);
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
  games.map((game) => {
    const normalized = normalizeGame(game);
    return {
      ...normalized,
      __id: `game-${Date.now()}-${gameIdCounter++}`,
    };
  });

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

const updateGenreFilterOptions = () => {
  const select = elements.genreFilterSelect;
  if (!select) return;
  if (!state.games.length) {
    state.genreFilter = "";
  }
  const normalizedTarget = (state.genreFilter || "").toLowerCase();
  const genreSet = new Map();
  let hasUnknown = false;
  state.games.forEach((game) => {
    const genres = Array.isArray(game.genres) ? game.genres : [];
    if (!genres.length) {
      hasUnknown = true;
      return;
    }
    genres.forEach((genre) => {
      if (!genre) return;
      genreSet.set(genre.toLowerCase(), genre);
    });
  });
  const genres = Array.from(genreSet.values()).sort((a, b) =>
    a.localeCompare(b, undefined, { sensitivity: "base" })
  );
  select.innerHTML = "";
  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = "All genres";
  select.appendChild(defaultOption);
  genres.forEach((genre) => {
    const option = document.createElement("option");
    option.value = genre;
    option.textContent = genre;
    select.appendChild(option);
  });
  if (hasUnknown) {
    const option = document.createElement("option");
    option.value = UNKNOWN_GENRE_VALUE;
    option.textContent = UNKNOWN_GENRE_LABEL;
    select.appendChild(option);
  }
  if (state.genreFilter) {
    if (state.genreFilter === UNKNOWN_GENRE_VALUE && !hasUnknown) {
      state.genreFilter = "";
    } else if (state.genreFilter && state.genreFilter !== UNKNOWN_GENRE_VALUE) {
      const exists = genres.some(
        (genre) => genre.toLowerCase() === normalizedTarget
      );
      if (!exists) {
        state.genreFilter = "";
      }
    }
  }
  select.disabled = genres.length === 0 && !hasUnknown;
  select.value = state.genreFilter || "";
};

const updateSelectionUI = () => {
  if (!elements.selectionBar || !elements.selectionCount) return;
  const count = state.selectedIds.size;
  elements.selectionCount.textContent =
    count > 0 ? `${count} selected` : "No games selected";
  elements.selectionBar.hidden = count === 0;
  if (elements.selectionApplyButton) {
    elements.selectionApplyButton.disabled = count === 0;
  }
};

const toggleGameSelection = (gameId, card) => {
  if (!gameId) return;
  const currentlySelected = state.selectedIds.has(gameId);
  if (currentlySelected) {
    state.selectedIds.delete(gameId);
  } else {
    state.selectedIds.add(gameId);
  }
  const target =
    card || elements.grid.querySelector(`[data-id="${gameId}"]`);
  target?.classList.toggle("selected", !currentlySelected);
  const toggle = target?.querySelector("[data-select-toggle]");
  if (toggle) {
    toggle.setAttribute("aria-pressed", (!currentlySelected).toString());
  }
  updateSelectionUI();
};

const clearSelections = ({ silent = false } = {}) => {
  if (!state.selectedIds.size) {
    return;
  }
  state.selectedIds.forEach((id) => {
    const card = elements.grid.querySelector(`[data-id="${id}"]`);
    card?.classList.remove("selected");
    const toggle = card?.querySelector("[data-select-toggle]");
    toggle?.setAttribute("aria-pressed", "false");
  });
  state.selectedIds.clear();
  updateSelectionUI();
  if (!silent) {
    showStatus("Selection cleared.");
  }
};

const applyBulkStatus = () => {
  if (!state.selectedIds.size) {
    showStatus("Select at least one game first.", "error");
    return;
  }
  const desired = elements.selectionStatus?.value;
  if (!desired) {
    showStatus("Choose a status before applying.", "error");
    return;
  }
  const nextStatus = sanitizeStatus(desired);
  let updatedCount = 0;
  state.selectedIds.forEach((id) => {
    const result = updateGameMetadata(
      id,
      { status: nextStatus },
      { silent: true, deferFilter: true }
    );
    if (result) {
      updatedCount += 1;
    }
  });
  if (updatedCount) {
    applyFilter({ silentStatus: true });
    const label =
      STATUS_LABEL_LOOKUP[nextStatus] || STATUS_LABEL_LOOKUP[DEFAULT_STATUS];
    showStatus(`Updated ${updatedCount} game(s) to ${label}.`);
  } else {
    showStatus("No games were updated.", "error");
  }
};

const updateGameMetadata = (
  gameId,
  updates,
  { message, silent = false, deferFilter = false } = {}
) => {
  if (!gameId) return null;
  const index = state.games.findIndex((game) => game.__id === gameId);
  if (index === -1) return null;
  const merged = normalizeGame({ ...state.games[index], ...updates });
  state.games[index] = merged;
  state.games = [...state.games];
  if (state.selection?.__id === gameId) {
    state.selection = merged;
    renderGenreTags(detailState.refs?.genres, merged.genres);
  }
  updateStoreFilterOptions();
  updateGenreFilterOptions();
  const shouldSilence = silent || Boolean(message);
  if (!deferFilter) {
    applyFilter({ silentStatus: shouldSilence });
  }
  persistGameCache();
  autoSaveProfile();
  if (message) {
    showStatus(message);
  }
  return merged;
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
    ratingMatch: node.querySelector("[data-detail-rating-match]"),
    refine: node.querySelector("[data-detail-refine]"),
    statusControl: node.querySelector("[data-detail-status]"),
    finishCount: node.querySelector("[data-detail-finish-count]"),
    genres: node.querySelector("[data-detail-genres]"),
  };
  refs.close?.addEventListener("click", () => closeDetail());
  refs.refine?.addEventListener("click", () => openRefineDialog(state.selection));
  populateStatusSelect(refs.statusControl);
  refs.statusControl?.addEventListener("change", (event) => {
    const nextStatus = sanitizeStatus(event.target.value);
    if (!state.selection) return;
    const label = STATUS_LABEL_LOOKUP[nextStatus] || STATUS_LABEL_LOOKUP[DEFAULT_STATUS];
    const updated = updateGameMetadata(
      state.selection.__id,
      { status: nextStatus },
      { silent: true, deferFilter: true }
    );
    if (state.statusFilter) {
      applyFilter({ silentStatus: true });
    } else {
      updateCardStatus(updated);
    }
    showStatus(`Moved to ${label}.`);
  });
  refs.finishCount?.addEventListener("change", (event) => {
    if (!state.selection) return;
    const value = clampFinishCount(event.target.value);
    event.target.value = value;
    updateGameMetadata(
      state.selection.__id,
      { finish_count: value },
      { message: `Updated finish count to ${value}.` }
    );
  });
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
  if (state.selectedIds.has(gameId)) {
    state.selectedIds.delete(gameId);
  }
  updateStoreFilterOptions();
  updateGenreFilterOptions();
  applyFilter();
  updateSelectionUI();
  showStatus(`${removed.title} removed from the library.`);
  persistGameCache();
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
	  updateStoreFilterOptions();
	  updateGenreFilterOptions();
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
  refs.cover.src = resolveImageUrl(game.cover_url);
  refs.cover.alt = `${game.title} cover art`;
  if (refs.statusControl) {
    refs.statusControl.value = sanitizeStatus(game.status);
  }
  if (refs.finishCount) {
    refs.finishCount.value = clampFinishCount(game.finish_count);
  }
  renderGenreTags(refs.genres, game.genres);
  detailState.galleryUrls = game.gallery_urls || [];
  detailState.activeIndex = null;
  renderGallery(refs.gallery, detailState.galleryUrls);
  applyRating(refs.rating, game.rating, game.rating_match_title, refs.ratingMatch);
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
    thumb.src = resolveImageUrl(game.thumbnail_url || game.cover_url);
    thumb.alt = `${game.title} artwork`;
    card.querySelector(".info .platform").textContent = formatPlatform(game);
    card.querySelector(".info .title").textContent = game.title;
    card.querySelector(".info .description").textContent = game.description;
    applyRating(
      card.querySelector(".row-meta .rating-pill"),
      game.rating,
      game.rating_match_title,
      card.querySelector(".row-meta .rating-match")
    );
    applyStatusLabel(card.querySelector(".row-meta .status-pill"), game.status);
    renderGenreTags(
      card.querySelector(".info .genre-tags"),
      game.genres,
      { limit: 3 }
    );
    const store = card.querySelector(".row-meta .store");
    store.textContent =
      game.source || game.platform || "";
  } else {
    const cover = card.querySelector("img.cover");
    cover.src = resolveImageUrl(game.cover_url);
    cover.alt = `${game.title} cover art`;
    card.querySelector(".platform").textContent = formatPlatform(game);
    card.querySelector(".title").textContent = game.title;
    card.querySelector(".description").textContent = game.description;
    applyStatusLabel(card.querySelector(".card-meta .status-pill"), game.status);
    applyRating(
      card.querySelector(".card-meta .rating-pill"),
      game.rating,
      game.rating_match_title,
      card.querySelector(".card-meta .rating-match")
    );
    renderGenreTags(card.querySelector(".genre-tags"), game.genres, { limit: 3 });
  }

  card.classList.toggle("selected", state.selectedIds.has(game.__id));

  const selectBtn = card.querySelector("[data-select-toggle]");
  if (selectBtn) {
    selectBtn.setAttribute(
      "aria-pressed",
      state.selectedIds.has(game.__id).toString()
    );
    selectBtn.addEventListener("click", (event) => {
      event.stopPropagation();
      toggleGameSelection(game.__id, card);
    });
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
  if (state.sortMode === "random") {
    for (let i = sorted.length - 1; i > 0; i -= 1) {
      const j = Math.floor(Math.random() * (i + 1));
      [sorted[i], sorted[j]] = [sorted[j], sorted[i]];
    }
    return sorted;
  }
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

const describeStatusFilter = (value) => {
  if (!value) return null;
  return STATUS_FILTER_LABELS[value] || STATUS_LABEL_LOOKUP[value] || null;
};

const describeGenreFilter = (value) => {
  if (!value) return null;
  if (value === UNKNOWN_GENRE_VALUE) {
    return UNKNOWN_GENRE_LABEL;
  }
  return value;
};

const buildFilterMessage = (
  count,
  query,
  storeFilterLabel,
  statusFilterValue,
  genreFilterValue
) => {
  const activeFilters = [];
  if (query) {
    activeFilters.push(`“${query}”`);
  }
  if (storeFilterLabel) {
    activeFilters.push(storeFilterLabel);
  }
  const statusLabel = describeStatusFilter(statusFilterValue);
  if (statusLabel) {
    activeFilters.push(statusLabel);
  }
  const genreLabel = describeGenreFilter(genreFilterValue);
  if (genreLabel) {
    activeFilters.push(genreLabel);
  }
  if (!activeFilters.length) {
    return `Displaying ${count} games.`;
  }
  return `Showing ${count} games (${activeFilters.join(" · ")}).`;
};

const applyFilter = ({ silentStatus = false } = {}) => {
  const queryRaw = elements.searchInput.value.trim();
  const query = queryRaw.toLowerCase();
  const storeFilter = (state.storeFilter || "").toLowerCase();
  const statusFilter = state.statusFilter || "";
  const genreFilter = state.genreFilter || "";

  state.filtered = state.games.filter((game) => {
    const haystack = `${game.title} ${game.platform ?? ""} ${
      game.source ?? ""
    } ${game.description}`.toLowerCase();
    const matchesQuery = !query || haystack.includes(query);
    const matchesStore =
      !storeFilter || (game.source || "").toLowerCase() === storeFilter;
    const gameStatus = sanitizeStatus(game.status);
    const matchesStatus =
      !statusFilter ||
      (statusFilter === "without_not_allocated"
        ? gameStatus !== DEFAULT_STATUS
        : gameStatus === statusFilter);
    const genres = Array.isArray(game.genres) ? game.genres : [];
    const normalizedGenres = genres.map((genre) => genre.toLowerCase());
    const matchesGenre =
      !genreFilter ||
      (genreFilter === UNKNOWN_GENRE_VALUE
        ? normalizedGenres.length === 0
        : normalizedGenres.includes(genreFilter.toLowerCase()));
    return matchesQuery && matchesStore && matchesStatus && matchesGenre;
  });

  state.filtered = sortGames(state.filtered);
  renderGrid(state.filtered);

  const message = buildFilterMessage(
    state.filtered.length,
    queryRaw,
    state.storeFilter,
    statusFilter,
    genreFilter
  );
  if (!silentStatus) {
    showStatus(message);
  }
  return message;
};

const ingestGames = (games, { skipAutoSave = false, append = false } = {}) => {
  const serialized = serializeGames(games);
  if (append && state.games.length) {
    state.games = [...state.games, ...serialized];
  } else {
    clearSelections({ silent: true });
    state.games = serialized;
  }
  state.selection = null;
  elements.searchInput.value = "";
  updateStoreFilterOptions();
  updateGenreFilterOptions();
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
      status: game.status,
      finish_count: game.finish_count,
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
    updateStoreFilterOptions();
    updateGenreFilterOptions();
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
  if (mode === "score" || mode === "random") {
    state.sortMode = mode;
  } else {
    state.sortMode = "alphabetical";
  }
  if (state.games.length) {
    applyFilter();
  }
});
elements.storeFilterSelect?.addEventListener("change", (event) => {
  state.storeFilter = event.target.value || "";
  applyFilter();
});
elements.statusFilterSelect?.addEventListener("change", (event) => {
  state.statusFilter = event.target.value || "";
  applyFilter();
});
elements.genreFilterSelect?.addEventListener("change", (event) => {
  state.genreFilter = event.target.value || "";
  applyFilter();
});
elements.selectionApplyButton?.addEventListener("click", applyBulkStatus);
elements.selectionClearButton?.addEventListener("click", () =>
  clearSelections()
);

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

populateStatusSelect(elements.selectionStatus, { includePlaceholder: true });
updateSelectionUI();

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
