const elements = {
  form: document.getElementById("upload-form"),
  fileInput: document.getElementById("file-input"),
  sampleButton: document.getElementById("sample-button"),
  searchInput: document.getElementById("search-input"),
  status: document.getElementById("status"),
  grid: document.getElementById("game-grid"),
  template: document.getElementById("game-card-template"),
  detailPanel: document.getElementById("detail-panel"),
  detailEmpty: document.getElementById("detail-empty"),
  detailContent: document.getElementById("detail-content"),
  detailTitle: document.getElementById("detail-title"),
  detailPlatform: document.getElementById("detail-platform"),
  detailDescription: document.getElementById("detail-description"),
  detailCover: document.getElementById("detail-cover"),
  detailGallery: document.getElementById("detail-gallery"),
  detailTrailerSection: document.getElementById("detail-trailer-section"),
  detailTrailer: document.getElementById("detail-trailer"),
};

const state = {
  games: [],
  filtered: [],
  selection: null,
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

const renderGallery = (urls = []) => {
  elements.detailGallery.innerHTML = "";
  if (!urls.length) {
    const placeholder = document.createElement("p");
    placeholder.className = "status";
    placeholder.textContent = "No gallery assets were provided for this title.";
    elements.detailGallery.appendChild(placeholder);
    return;
  }

  const fragment = document.createDocumentFragment();
  urls.forEach((url, index) => {
    const link = document.createElement("a");
    link.href = url;
    link.target = "_blank";
    link.rel = "noopener";
    link.title = "Open full resolution image";

    const image = document.createElement("img");
    image.src = url;
    image.alt = `Gallery image ${index + 1}`;
    link.appendChild(image);
    fragment.appendChild(link);
  });

  elements.detailGallery.appendChild(fragment);
};

const openDetail = (game) => {
  state.selection = game;
  if (!game || !elements.detailPanel) {
    return;
  }

  elements.detailPanel.classList.remove("hidden");
  elements.detailEmpty.hidden = true;
  elements.detailContent.hidden = false;

  elements.detailTitle.textContent = game.title;
  elements.detailPlatform.textContent = formatPlatform(game);
  elements.detailDescription.textContent = game.description;
  elements.detailCover.src = game.cover_url;
  elements.detailCover.alt = `${game.title} cover art`;

  renderGallery(game.gallery_urls || []);

  if (game.trailer_url) {
    elements.detailTrailerSection.hidden = false;
    elements.detailTrailer.src = "";
    requestAnimationFrame(() => {
      elements.detailTrailer.src = game.trailer_url;
    });
  } else if (elements.detailTrailerSection) {
    elements.detailTrailerSection.hidden = true;
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

  card.addEventListener("click", () => openDetail(game));
  card.addEventListener("keypress", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openDetail(game);
    }
  });

  return card;
};

const renderGrid = (games) => {
  elements.grid.innerHTML = "";
  if (!games.length) {
    elements.grid.innerHTML =
      '<p class="status">No games match the current filter.</p>';
    return;
  }

  const fragment = document.createDocumentFragment();
  games.forEach((game) => fragment.appendChild(createCard(game)));
  elements.grid.appendChild(fragment);
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
  elements.searchInput.value = "";
  applyFilter();
  if (state.games.length) {
    openDetail(state.games[0]);
  } else if (elements.detailPanel) {
    elements.detailPanel.classList.add("hidden");
    elements.detailContent.hidden = true;
    elements.detailEmpty.hidden = false;
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

// Prime UI with sample data for faster demo sessions.
loadSampleLibrary();
