import {
  GAMEMODE,
  defaultStyle,
  guessedStyle,
  highlightStyle,
} from "./game-config.js";
import {
  loadProgress,
  loadStartTimestamp,
  saveProgress,
  saveStartTimestamp,
} from "./game-storage.js";
import { formatTime, normalizeString } from "./game-utils.js";
import { getLocalityNames, loadAlternateNames } from "./locality-data.js";
import { registerServiceWorker } from "./pwa.js";

const { L, shp } = window;

function getElement(id) {
  const element = document.getElementById(id);
  if (!element) throw new Error(`Missing required element: #${id}`);
  return element;
}

const elements = Object.freeze({
  achievementsIframe: getElement("achievementsIframe"),
  countdown: getElement("countdown"),
  finalTime: getElement("final-time"),
  flagContainer: getElement("flag-container"),
  flagImage: getElement("flag-image"),
  flagsModeButton: getElement("flags-mode"),
  guessDialog: getElement("guess-dialog"),
  guessInput: getElement("guess-input"),
  infoBox: getElement("info-box"),
  mouselessModeButton: getElement("mouseless-mode"),
  musicToggle: getElement("musictoggle"),
  nonCountdown: getElement("noncountdown"),
  normalModeButton: getElement("normal-mode"),
  playAgainButton: getElement("play-again"),
  progressBar: getElement("progress-bar"),
  progressContainer: getElement("progress-container"),
  progressText: getElement("progress-text"),
  startOverlay: getElement("start-overlay"),
  stopwatch: getElement("stopwatch"),
  winModal: getElement("win-modal"),
  winModalContent: getElement("win-modal-content"),
  continueLastSave: getElement("continueLastSave"),
});

let map;
let geoJsonLayer;
let selectedLayer;
let currentFlagLayer = null;
let totalShapes = 0;
let guessedShapes = 0;
let backgroundMusic;
let chosenGamemode = GAMEMODE.normal;
let shouldLoadSave = false;
let stopwatchInterval = null;
let startTimestamp = null;
let allowedStartOverlayCloseEvents = 0;

function promoteStartOverlayToModal() {
  if (elements.startOverlay.open) {
    allowedStartOverlayCloseEvents++;
    elements.startOverlay.close();
  }
  elements.startOverlay.classList.add("is-modal");
  elements.startOverlay.showModal();
}

function closeStartOverlay() {
  if (!elements.startOverlay.open) return;

  allowedStartOverlayCloseEvents++;
  elements.startOverlay.close();
}

function initializeMap() {
  if (map) map.remove();

  const renderer = L.svg({ padding: 1 });
  map = L.map("map", {
    wheelDebounceTime: 1,
    zoomAnimation: false,
    doubleClickZoom: true,
    minZoom: 10,
    renderer,
    zoomControl: false,
    attributionControl: false,
    zoomSnap: 0,
    wheelPxPerZoomLevel: 100,
  });

  map.on("load", () => {
    hideGuessModal();
  });

  map.on("movestart", () => {
    if (chosenGamemode === GAMEMODE.normal) {
      hideGuessModal();
    }
  });
}

function loadShapefile(buffer) {
  shp(buffer)
    .then((geojson) => {
      if (!geojson || (geojson.features && geojson.features.length === 0)) {
        return;
      }

      const firstProperties = geojson.features[0].properties;
      if (
        !firstProperties ||
        (firstProperties.LAU_Name === undefined &&
          firstProperties.LAU_Latin === undefined)
      ) {
        return;
      }

      geoJsonLayer = L.geoJSON(geojson, {
        style: defaultStyle,
        onEachFeature,
      }).addTo(map);
      map.fitBounds(geoJsonLayer.getBounds());
      map.panBy([0, 20]);
      totalShapes = geojson.features.length;
      updateProgress();

      elements.progressContainer.classList.remove("hidden");
      elements.infoBox.classList.add("md:w-auto");

      if (shouldLoadSave) {
        const { guessedIds } = loadProgress();
        applySavedProgress(guessedIds);
      }

      if (chosenGamemode === GAMEMODE.flags) {
        startNextFlagRound();
      } else if (chosenGamemode === GAMEMODE.mouseless) {
        selectRandomUnguessedFeature();
      }
    })
    .catch((error) => {
      console.error("Shapefile parsing error:", error);
    });
}

function onEachFeature(feature, layer) {
  layer.maltalocalityid = feature.properties.LocalityId || "";
  layer.isGuessed = false;
  layer.on({
    mouseover: highlightFeature,
    mouseout: resetHighlight,
    click: handleLayerClick,
  });
}

function highlightFeature(event) {
  const layer = event.target;
  if (!layer.isGuessed) {
    layer.setStyle(highlightStyle);
    layer.bringToFront();
  }
}

function resetHighlight(event) {
  if (!geoJsonLayer) return;

  const layer = event.target;
  if (!layer.isGuessed && layer !== selectedLayer) {
    geoJsonLayer.resetStyle(layer);
  }
}

function handleLayerClick(event) {
  const clickedLayer = event.target;
  if (clickedLayer.isGuessed) return;

  if (chosenGamemode === GAMEMODE.flags) {
    if (
      currentFlagLayer &&
      clickedLayer.maltalocalityid === currentFlagLayer.maltalocalityid
    ) {
      selectFeatureForGuessing(event);
    } else {
      clickedLayer.setStyle({ color: "red", weight: 3 });
      setTimeout(() => {
        if (!clickedLayer.isGuessed) {
          geoJsonLayer.resetStyle(clickedLayer);
        }
      }, 300);
    }
  } else {
    selectFeatureForGuessing(event);
  }
}

function selectRandomUnguessedFeature() {
  if (!geoJsonLayer) return;

  const unguessedLayers = [];
  geoJsonLayer.eachLayer((layer) => {
    if (!layer.isGuessed) unguessedLayers.push(layer);
  });

  if (unguessedLayers.length > 0) {
    const randomLayer =
      unguessedLayers[Math.floor(Math.random() * unguessedLayers.length)];
    selectFeatureForGuessing({ target: randomLayer });
  }
}

function selectFeatureForGuessing(event) {
  elements.guessInput.value = "";

  if (selectedLayer && !selectedLayer.isGuessed) {
    geoJsonLayer.resetStyle(selectedLayer);
  }

  selectedLayer = event.target;
  if (selectedLayer.isGuessed) {
    selectedLayer = null;
    return;
  }

  selectedLayer.setStyle(highlightStyle);
  selectedLayer.bringToFront();

  const layerToHighlight = selectedLayer;
  setTimeout(() => {
    if (layerToHighlight === selectedLayer && !layerToHighlight.isGuessed) {
      layerToHighlight.setStyle(highlightStyle);
      layerToHighlight.bringToFront();
    }
  }, 10);

  showGuessModal();
}

function handleCorrectGuess() {
  if (!selectedLayer || selectedLayer.isGuessed) return;

  selectedLayer.isGuessed = true;
  selectedLayer.setStyle(guessedStyle);
  selectedLayer.unbindPopup();
  selectedLayer.off("click mouseover mouseout");

  guessedShapes++;
  updateProgress();
  saveProgressToLocalStorage();
  hideGuessModal();

  const correctAudio = new Audio("app/correct.mp3");
  correctAudio.play();

  if (guessedShapes === totalShapes) {
    showWinScreen();
  } else if (chosenGamemode === GAMEMODE.flags) {
    startNextFlagRound();
  } else if (chosenGamemode === GAMEMODE.mouseless) {
    selectRandomUnguessedFeature();
  }
}

function liveCheckGuess() {
  const userGuess = elements.guessInput.value;
  if (!userGuess || !selectedLayer) return;

  const normalizedGuess = normalizeString(userGuess);
  const normalizedNames = getLocalityNames(
    selectedLayer.maltalocalityid,
  ).map((name) => normalizeString(name));

  if (normalizedNames.includes(normalizedGuess)) {
    handleCorrectGuess();
  }
}

function updateProgress() {
  elements.progressText.textContent = `${guessedShapes} / ${totalShapes}`;
  const percentage =
    totalShapes > 0 ? (guessedShapes / totalShapes) * 100 : 0;
  elements.progressBar.style.width = `${percentage}%`;
}

function showGuessModal() {
  elements.guessDialog.show();
  elements.guessInput.focus();
}

function hideGuessModal() {
  elements.guessDialog.close();

  if (selectedLayer && !selectedLayer.isGuessed) {
    geoJsonLayer.resetStyle(selectedLayer);
  }
  selectedLayer = null;

  setTimeout(() => {
    elements.guessInput.value = "";
    elements.guessInput.placeholder = "Enter name...";
    elements.guessInput.classList.remove("border-red-500");
  }, 200);
}

function startStopwatch() {
  startTimestamp = Date.now();
  saveStartTimestamp(startTimestamp);
  updateStopwatchDisplay();
  stopwatchInterval = setInterval(updateStopwatchDisplay, 33);
}

function resumeStopwatch() {
  startTimestamp = loadStartTimestamp() || Date.now();
  updateStopwatchDisplay();
  stopwatchInterval = setInterval(updateStopwatchDisplay, 33);
}

function updateStopwatchDisplay() {
  const now = Date.now();
  const elapsed = now - (startTimestamp || now);
  elements.stopwatch.textContent = formatTime(elapsed);
}

function stopStopwatch() {
  if (stopwatchInterval) clearInterval(stopwatchInterval);
  stopwatchInterval = null;
}

function showWinScreen() {
  stopStopwatch();
  const now = Date.now();
  const elapsed = now - (startTimestamp || now);
  elements.finalTime.textContent = formatTime(elapsed);
  elements.achievementsIframe.contentWindow.postMessage(
    {
      type: "registerAchievement",
      achievement: "won-local-council-game",
    },
    window.location.origin,
  );

  if (chosenGamemode === GAMEMODE.flags) {
    elements.flagContainer.classList.add("hidden");
  }

  elements.winModal.classList.remove("hidden");
  elements.winModal.classList.add("flex");
  setTimeout(() => {
    elements.winModalContent.classList.remove("scale-95", "opacity-0");
    elements.winModalContent.classList.add("scale-100", "opacity-100");
  }, 10);
}

function startNextFlagRound() {
  if (!geoJsonLayer) return;

  hideGuessModal();

  const unguessedLayers = [];
  geoJsonLayer.eachLayer((layer) => {
    if (!layer.isGuessed) unguessedLayers.push(layer);
  });

  if (unguessedLayers.length === 0) {
    if (guessedShapes === totalShapes) showWinScreen();
    return;
  }

  currentFlagLayer =
    unguessedLayers[Math.floor(Math.random() * unguessedLayers.length)];
  elements.flagImage.src = `coas/${currentFlagLayer.maltalocalityid}.png`;
  elements.flagContainer.classList.remove("hidden");
}

function startGame() {
  elements.nonCountdown.style.display = "none";

  if (shouldLoadSave) {
    closeStartOverlay();
    backgroundMusic = new Audio("app/music.mp3");
    backgroundMusic.loop = true;
    backgroundMusic.volume = 0.2;
    backgroundMusic.play();

    resumeStopwatch();
    autoLoadFile();
    return;
  }

  const countdownAudio = new Audio("app/321.mp3");
  countdownAudio.play();

  setTimeout(() => {
    backgroundMusic = new Audio("app/music.mp3");
    backgroundMusic.loop = true;
    backgroundMusic.volume = 0.2;

    elements.countdown.style.display = "block";

    let count = 3;
    elements.countdown.textContent = count;
    autoLoadFile();

    const countInterval = setInterval(() => {
      count--;
      if (count > 0) {
        elements.countdown.textContent = count;
      } else {
        clearInterval(countInterval);
        closeStartOverlay();
        backgroundMusic.play();

        if (!shouldLoadSave) {
          startStopwatch();
        } else {
          resumeStopwatch();
        }
      }
    }, 300);
  }, 350);
}

function saveProgressToLocalStorage() {
  if (!geoJsonLayer) return;

  const guessedIds = [];
  geoJsonLayer.eachLayer((layer) => {
    if (layer.isGuessed) guessedIds.push(layer.maltalocalityid);
  });
  saveProgress(guessedIds, chosenGamemode);
}

function applySavedProgress(guessedIds) {
  if (!geoJsonLayer) return;

  guessedShapes = 0;
  geoJsonLayer.eachLayer((layer) => {
    if (guessedIds.includes(layer.maltalocalityid)) {
      layer.isGuessed = true;
      layer.setStyle(guessedStyle);
      layer.unbindPopup();
      layer.off("click mouseover mouseout");
      guessedShapes++;
    }
  });
  updateProgress();
}

function handleStartClick(mode, loadSave = false) {
  chosenGamemode = mode;
  shouldLoadSave = loadSave;
  startGame();
}

function toggleBackgroundMusic() {
  backgroundMusic.volume = backgroundMusic.volume === 0 ? 0.2 : 0;
  elements.musicToggle.src =
    backgroundMusic.volume === 0 ? "app/musicoff.png" : "app/musicon.png";
}

function autoLoadFile() {
  fetch("app/Malta-LAU2.zip")
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.arrayBuffer();
    })
    .then((buffer) => loadShapefile(buffer))
    .catch((error) => {
      console.error("Fetch error:", error);
    });
}

elements.normalModeButton.addEventListener("click", () => {
  handleStartClick(GAMEMODE.normal);
});
elements.mouselessModeButton.addEventListener("click", () => {
  handleStartClick(GAMEMODE.mouseless);
});
elements.flagsModeButton.addEventListener("click", () => {
  handleStartClick(GAMEMODE.flags);
});

elements.musicToggle.addEventListener("click", toggleBackgroundMusic);
elements.musicToggle.addEventListener("keydown", (event) => {
  if (event.key === "Enter" || event.key === " ") {
    event.preventDefault();
    toggleBackgroundMusic();
  }
});

elements.guessInput.addEventListener("input", liveCheckGuess);
elements.playAgainButton.addEventListener("click", () => {
  window.location.reload();
});

elements.startOverlay.addEventListener("cancel", (event) => {
  event.preventDefault();
});

elements.startOverlay.addEventListener(
  "keydown",
  (event) => {
    if (event.key !== "Escape") return;

    event.preventDefault();
    event.stopPropagation();
  },
  { capture: true },
);

elements.startOverlay.addEventListener("close", () => {
  if (allowedStartOverlayCloseEvents > 0) {
    allowedStartOverlayCloseEvents--;
    return;
  }

  queueMicrotask(() => {
    if (!elements.startOverlay.open) {
      elements.startOverlay.showModal();
    }
  });
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;

  if (elements.startOverlay.open) {
    event.preventDefault();
    return;
  }

  if (chosenGamemode === GAMEMODE.flags && guessedShapes < totalShapes) {
    startNextFlagRound();
  } else {
    hideGuessModal();
  }
});

document.addEventListener("DOMContentLoaded", () => {
  const progress = loadProgress();
  if (progress.guessedIds.length > 0) {
    elements.continueLastSave.style.display = "flex";
  }

  elements.continueLastSave.addEventListener("click", () => {
    handleStartClick(progress.savedGamemode || GAMEMODE.normal, true);
  });
});

window.addEventListener("load", () => {
  loadAlternateNames();
  initializeMap();
  elements.startOverlay.style.opacity = "1";
  elements.startOverlay.style.transition = "opacity 1s";
  registerServiceWorker();
});

promoteStartOverlayToModal();
