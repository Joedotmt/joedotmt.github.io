// --- Global Variables ---
let map;
let geoJsonLayer;
let selectedLayer;
let totalShapes = 0;
let guessedShapes = 0;
let backgroundMusic;
let currentFlagLayer = null; // To store the layer for the current flag guess

const progressContainer = document.getElementById('progress-container');
const progressText = document.getElementById('progress-text');
const progressBar = document.getElementById('progress-bar');
const infoBox = document.getElementById('info-box');

const guessDialog = document.getElementById('guess-dialog');
const guessInput = document.getElementById('guess-input');

const winModal = document.getElementById('win-modal');
const winModalContent = document.getElementById('win-modal-content');
const playAgainBtn = document.getElementById('play-again');

const startOverlay = document.getElementById('start-overlay');
const countdown = document.getElementById('countdown');

// New DOM elements for Flag Mode
const flagContainer = document.getElementById('flag-container');
const flagImage = document.getElementById('flag-image');

// --- Styles for Shapes ---
const defaultStyle = { color: "#3388ff", weight: 2, opacity: 1, fillColor: "#3388ff", fillOpacity: 0.3 };
const highlightStyle = { color: "#ff7800", weight: 4, fillOpacity: 0.5 };
const guessedStyle = { color: "#28a745", weight: 2, opacity: 1, fillColor: "#28a745", fillOpacity: 0.6, interactive: false };

// --- Map Initialization (Blank Background) ---
function initializeMap() {
    if (map) map.remove();


    // Initialize the map, restricting it to the bounds of Malta
    var myRenderer = L.svg({ padding: 1 });
    map = L.map('map', {
        wheelDebounceTime: 1,
        zoomAnimation: false,
        doubleClickZoom: true,
        minZoom: 10,
        renderer: myRenderer,
        zoomControl: false,
        attributionControl: false,
        wheelPxPerZoomLevel: 100,
    });



    map.on('load', function (e) {
        hideGuessModal();
    });
    map.on('movestart', function (e) {
        if (chosenGamemode === GAMEMODE.normal) {
            hideGuessModal();
        }
    });

}



// --- Input Normalization ---
/**
 * Normalizes a string for comparison by making it lowercase,
 * replacing special Maltese characters and diacritics, and handling hyphens.
 * Also ignores anything before the first dash (e.g., "l-isla" becomes "isla").
 * @param {string} str The string to normalize.
 * @returns {string} The normalized string.
 */
function normalizeString(str) {
    if (!str) return '';
    let normalized = str.toLowerCase();

    // Specific Maltese character replacements
    normalized = normalized.replace(/ġ/g, 'g');
    normalized = normalized.replace(/ħ/g, 'h');
    normalized = normalized.replace(/ċ/g, 'c');
    normalized = normalized.replace(/ż/g, 'z');

    // General diacritic removal
    normalized = normalized.normalize('NFD').replace(/[\u0300-\u036f]/g, '');

    // Replace hyphens and dashes with a space
    normalized = normalized.replace(/[-–—]/g, ' ');

    // Remove apostrophes
    normalized = normalized.replace(/[']/g, '');

    // Remove extra spaces and trim
    normalized = normalized.replace(/\s+/g, ' ').trim();

    // **Remove all letters before the last space unless "san" is present**
    if (!normalized.includes('san') && !normalized.includes('bay')) {
        const lastSpaceIndex = normalized.lastIndexOf(' ');
        if (lastSpaceIndex !== -1) {
            normalized = normalized.substring(lastSpaceIndex + 1);
        }
    }

    return normalized;
}



// --- Game Logic ---
function loadShapefile(buffer) {
    shp(buffer).then(function (geojson) {
        if (!geojson || (geojson.features && geojson.features.length === 0)) {
            return;
        }
        const firstProps = geojson.features[0].properties;
        if (!firstProps || (firstProps.LAU_Name === undefined && firstProps.LAU_Latin === undefined)) {
            return;
        }
        geoJsonLayer = L.geoJSON(geojson, { style: defaultStyle, onEachFeature }).addTo(map);
        map.fitBounds(geoJsonLayer.getBounds());
        map.panBy([0, 20]);
        totalShapes = geojson.features.length;
        updateProgress();

        progressContainer.classList.remove('hidden');
        infoBox.classList.add('md:w-auto');

        // If loading from save, apply saved progress
        if (shouldLoadSave) {
            const { guessedIds } = loadProgressFromLocalStorage();
            applySavedProgress(guessedIds);
        }

        // Start game based on mode after setup is complete
        if (chosenGamemode === GAMEMODE.flags) {
            startNextFlagRound();
        } else if (chosenGamemode === GAMEMODE.mouseless) {
            selectRandomUnguessedFeature();
        }

    }).catch(function (err) {
        console.error("Shapefile parsing error:", err);
    });
}

function onEachFeature(feature, layer) {
    layer.maltalocalityid = feature.properties.LocalityId || '';
    layer.isGuessed = false;
    layer.on({
        mouseover: highlightFeature,
        mouseout: resetHighlight,
        click: handleLayerClick
    });
}

// --- Feature Interaction ---
function highlightFeature(e) {
    const layer = e.target;
    if (!layer.isGuessed) {
        layer.setStyle(highlightStyle);
        layer.bringToFront();
    }
}

function resetHighlight(e) {
    if (geoJsonLayer) {
        const layer = e.target;
        if (!layer.isGuessed && layer !== selectedLayer) {
            geoJsonLayer.resetStyle(layer);
        }
    }
}


// NEW: Function to handle clicks based on game mode
function handleLayerClick(e) {
    const clickedLayer = e.target;
    if (clickedLayer.isGuessed) return;

    if (chosenGamemode === GAMEMODE.flags) {
        // In flag mode, check if the clicked layer is the correct one for the current flag
        if (currentFlagLayer && clickedLayer.maltalocalityid === currentFlagLayer.maltalocalityid) {
            selectFeatureForGuessing(e); // Correct shape, now prompt for the name
        } else {
            // Optional: Visual feedback for a wrong click
            clickedLayer.setStyle({ color: 'red', weight: 3 });
            setTimeout(() => {
                if (!clickedLayer.isGuessed) {
                    geoJsonLayer.resetStyle(clickedLayer);
                }
            }, 300);
        }
    } else {
        // For normal and mouseless modes, any click on an unguessed shape is valid
        selectFeatureForGuessing(e);
    }
}


function selectRandomUnguessedFeature() {
    if (!geoJsonLayer) return;

    const unguessedLayers = [];
    geoJsonLayer.eachLayer(layer => {
        if (!layer.isGuessed) {
            unguessedLayers.push(layer);
        }
    });

    if (unguessedLayers.length > 0) {
        const randomLayer = unguessedLayers[Math.floor(Math.random() * unguessedLayers.length)];
        selectFeatureForGuessing({ target: randomLayer });
    }
}

function selectFeatureForGuessing(e) {
    guessInput.value = '';


    if (selectedLayer && !selectedLayer.isGuessed) {
        geoJsonLayer.resetStyle(selectedLayer);
    }
    selectedLayer = e.target;
    if (selectedLayer.isGuessed) {
        selectedLayer = null;
        return;
    }
    selectedLayer.setStyle(highlightStyle);
    selectedLayer.bringToFront();

    setTimeout(() => {
        selectedLayer.setStyle(highlightStyle);
        selectedLayer.bringToFront();
    }, 10);
    showGuessModal();

}

// --- Guessing Logic ---
function handleCorrectGuess() {
    if (!selectedLayer || selectedLayer.isGuessed) return; // Prevent double processing

    selectedLayer.isGuessed = true;
    selectedLayer.setStyle(guessedStyle);
    selectedLayer.unbindPopup();
    selectedLayer.off('click mouseover mouseout');

    guessedShapes++;
    updateProgress();
    saveProgressToLocalStorage();
    hideGuessModal(); // Just closes the dialog now

    const correctAudio = new Audio('correct.mp3');
    correctAudio.play();

    if (guessedShapes === totalShapes) {
        showWinScreen();
    } else {
        // Move to the next round based on game mode
        if (chosenGamemode === GAMEMODE.flags) {
            startNextFlagRound();
        } else if (chosenGamemode === GAMEMODE.mouseless) {
            selectRandomUnguessedFeature();
        }
    }
}

let altNamesData = null;

async function loadAltNames() {
    try {
        const response = await fetch('app/altnames.json');
        altNamesData = await response.json();
        console.log('altnames.json loaded');
    } catch (error) {
        console.error('Failed to load altnames.json:', error);
    }
}

function getLocalityNames(localityId) {
    if (!altNamesData) {
        return [];
    }
    const locality = altNamesData.find(item => item.LocalityId === localityId);
    if (!locality) {
        return [];
    }
    return [...new Set(locality.Names.split(',').map(name => name.trim()).filter(name => name.length > 0))];
}

window.addEventListener('load', () => {
    loadAltNames();
});


function liveCheckGuess() {
    const userGuess = guessInput.value;
    if (!userGuess || !selectedLayer) return;

    const normalizedGuess = normalizeString(userGuess);
    const names = getLocalityNames(selectedLayer.maltalocalityid);
    const normalizedNames = names.map(name => normalizeString(name));

    let isCorrect = normalizedNames.includes(normalizedGuess)

    if (isCorrect) {
        handleCorrectGuess();
    }
}


// --- UI Management ---
function updateProgress() {
    progressText.textContent = `${guessedShapes} / ${totalShapes}`;
    const percentage = totalShapes > 0 ? (guessedShapes / totalShapes) * 100 : 0;
    progressBar.style.width = `${percentage}%`;
}

function showGuessModal() {
    guessDialog.show();
    guessInput.focus();
}

// MODIFIED: This function is now simpler and just handles the UI
function hideGuessModal() {
    guessDialog.close();

    if (selectedLayer && !selectedLayer.isGuessed) {
        geoJsonLayer.resetStyle(selectedLayer);
    }
    selectedLayer = null;

    setTimeout(() => {
        guessInput.value = '';
        guessInput.placeholder = 'Enter name...';
        guessInput.classList.remove('border-red-500');
    }, 200);
}

let stopwatchInterval = null;
let startTimestamp = null;

// --- Stopwatch Helpers ---
function startStopwatch() {
    startTimestamp = Date.now();
    localStorage.setItem('lcgame_startTime', startTimestamp);
    updateStopwatchDisplay();
    stopwatchInterval = setInterval(updateStopwatchDisplay, 33);
}

function updateStopwatchDisplay() {
    const now = Date.now();
    const elapsed = now - (startTimestamp || now);
    document.getElementById('stopwatch').textContent = formatTime(elapsed);
}

function formatTime(ms) {
    const totalSeconds = ms / 1000;
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.floor(totalSeconds % 60);
    const centiseconds = Math.floor((totalSeconds * 100) % 100);
    return `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}.${centiseconds.toString().padStart(2, '0')}`;
}

function stopStopwatch() {
    if (stopwatchInterval) clearInterval(stopwatchInterval);
    stopwatchInterval = null;
}

// --- Win Screen Update ---
function showWinScreen() {
    stopStopwatch();
    const now = Date.now();
    const elapsed = now - (startTimestamp || now);
    document.getElementById('final-time').textContent = formatTime(elapsed);
    achievementsIframe.contentWindow.postMessage({ type: 'registerAchievement', achievement: "won-local-council-game" }, '*');

    if (chosenGamemode === GAMEMODE.flags) {
        flagContainer.classList.add('hidden');
    }

    winModal.classList.remove('hidden');
    winModal.classList.add('flex');
    setTimeout(() => {
        winModalContent.classList.remove('scale-95', 'opacity-0');
        winModalContent.classList.add('scale-100', 'opacity-100');
    }, 10);
}

// NEW: Function to manage the flag guessing rounds
function startNextFlagRound() {
    if (!geoJsonLayer) return;

    hideGuessModal(); // Close any open input dialog

    const unguessedLayers = [];
    geoJsonLayer.eachLayer(layer => {
        if (!layer.isGuessed) {
            unguessedLayers.push(layer);
        }
    });

    if (unguessedLayers.length === 0) {
        if (guessedShapes === totalShapes) showWinScreen();
        return;
    }

    // Select a new random layer for the flag
    currentFlagLayer = unguessedLayers[Math.floor(Math.random() * unguessedLayers.length)];

    const localityId = currentFlagLayer.maltalocalityid;
    flagImage.src = `coas/${localityId}.png`;
    flagContainer.classList.remove('hidden');
}


// --- Start Game ---
function startGame() {
    document.getElementById("noncountdown").style.display = 'none';

    if (shouldLoadSave) {
        startOverlay.style.display = 'none';
        backgroundMusic = new Audio('music.mp3');
        backgroundMusic.loop = true;
        backgroundMusic.volume = 0.2;
        backgroundMusic.play();

        startTimestamp = parseInt(localStorage.getItem('lcgame_startTime'), 10) || Date.now();
        updateStopwatchDisplay();
        stopwatchInterval = setInterval(updateStopwatchDisplay, 33);
        autoLoadFile();
        return;
    }

    const countdownAudio = new Audio('321.mp3');
    countdownAudio.play();
    setTimeout(() => {
        backgroundMusic = new Audio('music.mp3');
        backgroundMusic.loop = true;
        backgroundMusic.volume = 0.2;

        countdown.style.display = 'block';

        let count = 3;
        countdown.textContent = count;
        autoLoadFile();
        const countInterval = setInterval(() => {
            count--;
            if (count > 0) {
                countdown.textContent = count;
            } else {
                clearInterval(countInterval);
                startOverlay.style.display = 'none';
                backgroundMusic.play();

                if (!shouldLoadSave) {
                    startStopwatch();
                } else {
                    startTimestamp = parseInt(localStorage.getItem('lcgame_startTime'), 10) || Date.now();
                    updateStopwatchDisplay();
                    stopwatchInterval = setInterval(updateStopwatchDisplay, 33);
                }
            }
        }, 300);
    }, 350);

}
const GAMEMODE = {
    normal: 0,
    mouseless: 1,
    flags: 2
}
let chosenGamemode = 0;
// --- LocalStorage Helpers ---
function saveProgressToLocalStorage() {
    if (!geoJsonLayer) return;
    const guessedIds = [];
    geoJsonLayer.eachLayer(layer => {
        if (layer.isGuessed) guessedIds.push(layer.maltalocalityid);
    });
    localStorage.setItem('lcgame_guessedIds', JSON.stringify(guessedIds));
    localStorage.setItem('lcgame_gamemode', chosenGamemode);
}

function loadProgressFromLocalStorage() {
    const guessedIds = JSON.parse(localStorage.getItem('lcgame_guessedIds') || '[]');
    const savedGamemode = parseInt(localStorage.getItem('lcgame_gamemode'), 10);
    return { guessedIds, savedGamemode };
}

function applySavedProgress(guessedIds) {
    if (!geoJsonLayer) return;
    guessedShapes = 0;
    geoJsonLayer.eachLayer(layer => {
        if (guessedIds.includes(layer.maltalocalityid)) {
            layer.isGuessed = true;
            layer.setStyle(guessedStyle);
            layer.unbindPopup();
            layer.off('click mouseover mouseout');
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

document.addEventListener('DOMContentLoaded', () => {
    const continueBtn = document.getElementById("continueLastSave")
    let progress = loadProgressFromLocalStorage()
    if (progress.guessedIds.length > 0) {
        continueBtn.style.display = "flex"
    }
    if (continueBtn) {
        continueBtn.onclick = () => {
            const { savedGamemode } = progress;
            handleStartClick(savedGamemode || GAMEMODE.normal, true);
        };
    }
});

// --- Event Listeners ---
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (chosenGamemode === GAMEMODE.flags && guessedShapes < totalShapes) {
            startNextFlagRound(); // Skips to the next flag
        } else {
            hideGuessModal(); // Original behavior for other modes
        }
    }
});

guessInput.addEventListener('input', liveCheckGuess);
playAgainBtn.addEventListener('click', () => {
    window.location.reload()
});

// --- Initial Setup ---
window.onload = () => {
    initializeMap();
    startOverlay.style.opacity = '1';
    startOverlay.style.transition = 'opacity 1s';
};

function autoLoadFile() {
    fetch('app/Malta-LAU2.zip')
        .then(response => response.arrayBuffer())
        .then(buffer => loadShapefile(buffer))
        .catch(err => {
            console.error("Fetch error:", err);
        });
}