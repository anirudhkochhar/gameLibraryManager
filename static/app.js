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
};

const state = {
  games: [],
  filtered: [],
  selection: null,
};

const detailState = {
  node: null,
  refs: null,
  galleryUrls: [],
  activeIndex: null,
};

let gameIdCounter = 0;

const formatPlatform = (game) => {
  if (!game.platform && !game.source) {
    return "Unknown platform";
  }
  if (game.platform && game.source && game.platform !== game.source) {
    return `${game.platform} · ${game.source}`;
  }
  return game.platform || game.source || "Unknown platform";
};

const showStatus = (message, type = "info") => {
  if (!elements.status) return;
  elements.status.textContent = message ?? "";
  elements.status.classList.toggle("error", type === "error");
};

const serializeGames = (games) =>
  games.map((game) => ({
    ...game,
    gallery_urls: game.gallery_urls ?? [],
    __id: `game-${Date.now()}-${gameIdCounter++}`,
  }));

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
  };
  refs.close?.addEventListener("click", () => closeDetail());
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
  const content = elements.template.content.cloneNode(true);
  const card = content.querySelector(".game-card");
  card.dataset.id = game.__id;

  const cover = card.querySelector("img.cover");
  cover.src = game.cover_url;
  cover.alt = `${game.title} cover art`;

  card.querySelector(".platform").textContent = formatPlatform(game);
  card.querySelector(".title").textContent = game.title;
  card.querySelector(".description").textContent = game.description;

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
  elements.grid.innerHTML = "";
  if (!games.length) {
    closeDetail();
    elements.grid.innerHTML =
      '<p class="status">No games match the current filter.</p>';
    return;
  }

  const fragment = document.createDocumentFragment();
  games.forEach((game) => fragment.appendChild(createCard(game)));
  elements.grid.appendChild(fragment);

  if (state.selection) {
    const stillVisible = games.find((g) => g.__id === state.selection.__id);
    if (stillVisible) {
      openDetail(stillVisible, { preserveSelection: true });
    } else {
      closeDetail();
    }
  } else {
    closeDetail(false);
  }
};

const applyFilter = () => {
  const query = elements.searchInput.value.trim().toLowerCase();
  if (!query) {
    state.filtered = [...state.games];
    renderGrid(state.filtered);
    showStatus(`Displaying ${state.filtered.length} games.`);
    return;
  }

  state.filtered = state.games.filter((game) => {
    const haystack = `${game.title} ${game.platform ?? ""} ${
      game.source ?? ""
    } ${game.description}`.toLowerCase();
    return haystack.includes(query);
  });
  renderGrid(state.filtered);
  showStatus(`Found ${state.filtered.length} result(s) for “${query}”.`);
};

const ingestGames = (games) => {
  state.games = serializeGames(games);
  state.selection = null;
  elements.searchInput.value = "";
  applyFilter();
  closeDetail();
};

const parseApiError = async (response) => {
  try {
    const data = await response.json();
    return data.detail || data.message || "Unknown error";
  } catch {
    return response.statusText || "Unknown error";
  }
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
    ingestGames(data.games ?? []);
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

// Wait for user interaction (upload or sample) before populating the grid.
