// DOM Elements
const logweightbutton = document.getElementById("logweightbutton");
const sid_progress = document.getElementById("sid_progress");
const sid_words = document.getElementById("sid_words");
const welcomeText = document.getElementById("welcomeText");
const recordList = document.getElementById("recordList");
const submitButton = document.getElementById("submitButton");
const weightFormDialog = document.getElementById("weightFormDialog");
const signindialog = document.getElementById("signindialog");
const GraphTabs = document.getElementById("GraphTabs");
const loadingText = document.getElementById('loadingtext');
const loadingTextLines = Array.from(loadingText.children);

// Global state
let GLOBALmode = "Absolute";
const pocketBase = new PocketBase("https://petition.pockethost.io/");
let chartInstance = null;
let currentUser = {};
let GLOBALWeightData = null;
let showHiddenWeights = true;

// NEW: remember which participants are hidden on the graph (persisted)
let GLOBALHiddenSeries = new Set();

function toggleHiddenForLabel(label) {
    if (GLOBALHiddenSeries.has(label)) GLOBALHiddenSeries.delete(label);
    else GLOBALHiddenSeries.add(label);
}


async function toggleHiddenWeights() {
    // Toggle whether hidden-marked points are shown.
    // Do NOT reload weights from the server; just update the chart in-place.
    showHiddenWeights = !showHiddenWeights;

    // If chart exists, update datasets to hide/show points marked as hidden.
    if (chartInstance && chartInstance.data && chartInstance.data.datasets) {
        chartInstance.data.datasets.forEach(ds => {
            if (ds._fullData && Array.isArray(ds._fullData)) {
                ds.data = showHiddenWeights
                    ? ds._fullData.slice()
                    : ds._fullData.filter(pt => !pt._hidden);
            } else {
                // Fallback: operate on current data if no _fullData present
                ds.data = showHiddenWeights
                    ? ds.data
                    : ds.data.filter(pt => !pt._hidden);
            }
        });
        chartInstance.update();
    }
    // Do not change sign-in dialog state or reload weights
}

// Try to restore PocketBase auth from localStorage and refresh if possible
async function tryRestoreAuth() {
    // Restore token and model from localStorage if present
    const pbAuth = localStorage.getItem("pocketbase_auth");
    if (pbAuth) {
        try {
            const { token, model } = JSON.parse(pbAuth);
            pocketBase.authStore.save(token, model);
            // Try to refresh the session
            await pocketBase.collection('fat_users').authRefresh();
            currentUser = pocketBase.authStore.model;
            updateWelcomeTextAndWords();

            await loadWeights();

            setSigninDialogMode("closed");
            return true;
        } catch (e) {
            // If refresh fails, clear auth and show sign-in
            pocketBase.authStore.clear();
            localStorage.removeItem("pocketbase_auth");
        }
    }
    setSigninDialogMode("signin");
    return false;
}

// Updated signIn to use authWithPassword authentication
async function signIn(username, password) {
    setSigninDialogMode("loading");
    if (!username || !password) {
        setSigninDialogMode("signin");
        return;
    }
    try {
        await pocketBase.collection('fat_users').authWithPassword(username, password);
        currentUser = pocketBase.authStore.model;
    } catch (e) {
        console.error("Error during sign in:", e);
        setSigninDialogMode("signin");
        return;
    }
    await loadWeights();
    setSigninDialogMode("closed");
    updateWelcomeTextAndWords();
    updateCharts();
}

function updateWelcomeTextAndWords() {
    welcomeText.innerText = `Hello ${currentUser.username}`;

    // Check if the user is a physicist
    if (currentUser.is_physicist) {

        // Replace all occurrences of "weight" with "mass"
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
            node.textContent = node.textContent.replace(/\bweight\b/gi, "Mass");
        }

    } else {
        // Replace all occurrences of "mass" with "weight"
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
            node.textContent = node.textContent.replace(/\bMass\b/gi, "Weight");
        }
    }
}

// Update renderSignInForm to pass username and password to signIn
function renderSignInForm() {
    const container = document.getElementById("participantButtons");
    if (container) {
        const form = document.getElementById("signinForm");
        form.addEventListener("submit", async (event) => {
            setSigninDialogMode("loading");
            event.preventDefault();
            const username = document.getElementById("usernameInput").value;
            const password = document.getElementById("passwordInput").value;
            await signIn(username, password);
        });

        const guestButton = document.getElementById("guestSignInButton");
        guestButton.addEventListener("click", async () => {
            await signIn("guest", "guestacc");
        });
    }
}

// Load weights data
async function loadWeights() {
    try {
        const allVisibleToUser = [...currentUser.friends, currentUser.id];

        const friendFilters = allVisibleToUser
            .map(id => `user.id = "${id}"`)
            .join(' || ');

        // If showHiddenWeights is true, don't filter by hidden
        const hiddenFilter = showHiddenWeights ? "" : "hidden = false && ";

        GLOBALWeightData = await pocketBase.collection("weights").getFullList({
            sort: "-created",
            expand: "user",
            filter: `${hiddenFilter}(${friendFilters})`
        });
        updateCharts();
        return true;
    } catch (e) {
        console.error("Error loading weights:", e);
        return [];
    }
}

// Update grouping to use the expanded user field
function groupWeights(weights) {
    const groups = {};
    weights.forEach(element => {
        const name = element.expand.user.username;
        if (!groups[name]) groups[name] = [];
        groups[name].push(element);
    });
    return groups;
}

// In renderRecordList, update the user goal logic – assume the authenticated user holds their own goal.
function renderRecordList(groupedWeights) {
    let html = '';
    const allNames = Object.keys(groupedWeights);
    allNames.sort((a, b) => {
        if (a === currentUser.username) return -1;
        if (b === currentUser.username) return 1;
        return 0;
    });
    allNames.forEach(name => {
        const elements = groupedWeights[name];
        const goal = elements[0].expand.user.goal;
        const height_m = elements[0].expand.user.height_cm / 100;
        const startingWeight = elements[elements.length - 1].weight;
        const currentWeight = elements[0].weight;
        const weightLost = (startingWeight - currentWeight).toFixed(1);
        const totalToLose = (startingWeight - goal);
        const progressPercent = totalToLose ? ((weightLost / totalToLose) * 100).toFixed(1) : 0;
        const bmi = currentWeight / (height_m * height_m);
        
        html += `<article style="padding: 0; border-bottom: .0625rem solid var(--surface-variant); box-shadow: none; border-radius:0;">
  <progress class="max" value="${progressPercent}" max="100"></progress>
<h3 style="margin:0em 0.8rem;">${name}</h3>
</article>
    <ul class="list border">
      <li style="display: flex; flex-direction: column; align-items: flex-start; gap:0; min-height: fit-content; padding:1em;">
        <div>Goal&#160&#160&#160: ${startingWeight} to ${goal}kg (Lose ${startingWeight - goal}kg)</div>
        <div>Lost&#160&#160&#160: ${weightLost}kg</div>
        <div>Left&#160&#160&#160: ${(currentWeight - goal).toFixed(1)}kg</div>
        <div>BMI&#160&#160&#160&#160: ${bmi.toFixed(1)}kg/m² <a target="_blank" style="text-decoration: underline;" href="https://www.calculator.net/bmi-calculator.html?cheightmeter=${elements[0].expand.user.height_cm}&ckg=${currentWeight}&printit=0&ctype=metric&x=Calculate">More Info</a></div>
        <div>Height&#160: ${elements[0].expand.user.height_cm}cm</div>
        <div style="display:flex; gap:0.5em; align-items:center">${progressPercent}%<progress value="${progressPercent}" max="100" class="large"></progress></div>
      </li>`;
        elements.forEach((x, i) => {
            // Use date field if present, otherwise fall back to created
            const recordDate = x.date ? new Date(x.date) : new Date(x.created);
            const date = recordDate.toLocaleDateString("en-GB", { day: "2-digit", month: "long" });
            html += `<li style="${i ? "" : "background-color: var(--inverse-primary);"}">
        <div>${date}</div>
        ${x.weight}kg
      </li>`;
        });
        html += '</ul>';
    });
    recordList.innerHTML = html;
}

// Calculate goal line values based on currentUserWeights and mode
function calculateGoalLineValues(currentUserWeights, mode) {
    const weights = currentUserWeights.length
        ? currentUserWeights
        : GLOBALWeightData.map(entry => ({ weight: entry.weight || 0 }));

    const firstWeight = weights[weights.length - 1].weight;
    let goal = currentUser.goal || Math.min(...GLOBALWeightData.map(entry => entry.expand.user.goal || 0));

    switch (mode) {
        case "Absolute":
            return { goalLineValue: goal, lineStartValue: firstWeight };
        case "Relative":
            return { goalLineValue: -(firstWeight - goal), lineStartValue: 0 };
        case "Progress":
            return { goalLineValue: 100, lineStartValue: 0 };
        default:
            return { goalLineValue: 0, lineStartValue: firstWeight };
    }
}


// In updateCharts, update filter and datasets to use the 'user' field
async function updateCharts() {
    // Create chart datasets
    function createDatasets(groupedWeights, mode) {
        const colors = ["#0000ff", "#0964ed", "#ff0000", "#00ff00", "#00b350"];

        // Hash function to generate a consistent index based on the participant's name
        function getColorIndex(name) {
            let hash = 0;
            for (let i = 0; i < name.length; i++) {
                hash = (hash << 5) - hash + name.charCodeAt(i);
                hash |= 0; // Convert to 32-bit integer
            }
            return Math.abs(hash) % colors.length;
        }

        return Object.entries(groupedWeights).map(([name, elements], i) => {
            const startWeight = elements[elements.length - 1].weight;

            return {
                label: name,
                data: elements
                    .sort((a, b) => {
                        // Sort using date field if present, otherwise use created
                        const dateA = a.date ? new Date(a.date) : new Date(a.created);
                        const dateB = b.date ? new Date(b.date) : new Date(b.created);
                        return dateA - dateB;
                    })
                    .map(x => {
                        let y;
                        if (mode === "Relative") {
                            y = x.weight - startWeight;
                        } else if (mode === "Progress") {
                            y = ((x.weight - startWeight) / (elements[0].expand.user.goal - startWeight)) * 100;
                        } else { // Absolute
                            y = x.weight;
                        }
                        // Use date field if present, otherwise fall back to created
                        return { 
                            x: x.date ? new Date(x.date) : new Date(x.created), 
                            y, 
                            _hidden: !!x.hidden 
                        };
                    }),
                borderColor: colors[getColorIndex(name)],
                fill: false,
                // IMPORTANT: preserve the user's hidden state (legend toggles)
                hidden: GLOBALHiddenSeries.has(name)
            };
        });
    }
    try {
        const weights = GLOBALWeightData;
        const grouped = groupWeights(weights);
        renderRecordList(grouped);
        const currentUserWeights = currentUser.id ?
            weights.filter(w => w.expand.user.id === currentUser.id) : [];
        const { goalLineValue, lineStartValue } = calculateGoalLineValues(currentUserWeights, GLOBALmode);

        const ctx = document.getElementById("ProgressGraph").getContext("2d");
        const datasets = createDatasets(grouped, GLOBALmode);
        const margin = 5;

        // If chart already exists, try to preserve per-dataset full data backups (_fullData)
        if (chartInstance && chartInstance.data && chartInstance.data.datasets) {
            const prevFullMap = new Map(chartInstance.data.datasets.map(ds => [ds.label, ds._fullData || ds.data.slice()]));
            // Attach preserved full data where available and apply point-level hidden filtering based on showHiddenWeights
            chartInstance.data.datasets = datasets.map(ds => {
                const preserved = prevFullMap.get(ds.label);
                // set _fullData to preserved data (if present) or to newly created data
                // Always rebuild fresh values based on current mode
                ds._fullData = ds.data.slice();
                // Then apply hidden filtering
                ds.data = showHiddenWeights
                    ? ds._fullData.slice()
                    : ds._fullData.filter(pt => !pt._hidden);

                ds.data = showHiddenWeights ? ds._fullData.slice() : ds._fullData.filter(pt => !pt._hidden);
                // apply persisted legend-hidden state
                ds.hidden = GLOBALHiddenSeries.has(ds.label);
                return ds;
            });
        }

        const yAxisReverse = GLOBALmode === "Progress";
        let highestValue;

        if (yAxisReverse) {
            highestValue = Math.min(...datasets.flatMap(ds => ds.data.map(pt => pt.y)));
        } else {
            highestValue = Math.max(...datasets.flatMap(ds => ds.data.map(pt => pt.y)));
        }

        const yAxisLabel = GLOBALmode === "Absolute" ? "Weight (kg)" :
            GLOBALmode === "Relative" ? "Weight Change (kg)" :
                "Progress (%)";

        if (chartInstance) {
            // Update existing chart
            // (when chartInstance.data.datasets already set above for the preserved case)
            if (!chartInstance.data.datasets || !chartInstance.data.datasets.length) {
                // fallback: set datasets directly and ensure _fullData + filtering
                chartInstance.data.datasets = datasets.map(ds => {
                    ds._fullData = ds.data.slice();
                    ds.data = showHiddenWeights ? ds._fullData.slice() : ds._fullData.filter(pt => !pt._hidden);
                    ds.hidden = GLOBALHiddenSeries.has(ds.label);
                    return ds;
                });
            }

            if (chartInstance.options.plugins?.annotation?.annotations) {
                const ann = chartInstance.options.plugins.annotation.annotations;
                ann.lineStart.yMin = lineStartValue;
                ann.lineStart.yMax = lineStartValue;
                ann.goalLine.yMin = goalLineValue;
                ann.goalLine.yMax = goalLineValue;
                ann.box1.yMax = goalLineValue;
                ann.box1.yMin = goalLineValue + (yAxisReverse ? margin : -margin);
            }

            chartInstance.options.scales.y.reverse = yAxisReverse;
            chartInstance.options.scales.y.title.text = yAxisLabel;

            if (yAxisReverse) {
                chartInstance.options.scales.y.max = (goalLineValue + margin);
                chartInstance.options.scales.y.min = (highestValue - margin);
            } else {
                chartInstance.options.scales.y.max = (highestValue + margin);
                chartInstance.options.scales.y.min = (goalLineValue - margin);
            }

            chartInstance.update();
        } else {
            // Create new chart
            chartInstance = new Chart(ctx,
                {
                    type: "line",
                    data: { datasets },
                    options:
                    {
                        responsive: true,
                        maintainAspectRatio: false,
                        animation: {
                            duration: 0 // Disable all animations
                        },
                        scales: {
                            x: {
                                type: "time",
                                time: {
                                    unit: "day",
                                    displayFormats: { day: "dd MMM" },
                                    tooltipFormat: "dd MMM yyyy"
                                },
                                title: { display: false },
                                ticks: {
                                    autoSkip: true,
                                    maxRotation: 0,
                                    minRotation: 0
                                }
                            },
                            y: {
                                title: { display: true, text: yAxisLabel },
                                reverse: yAxisReverse,
                                min: (goalLineValue - 5),
                                max: (highestValue + 5),
                            }
                        },
                        plugins: {
                            legend: {
                                display: true,
                                position: "top",
                                // CUSTOM: remember toggles by label when legend items are clicked
                                onClick: function (e, legendItem, legend) {
                                    const ci = legend.chart;
                                    const label = legendItem.text;
                                    // toggle stored hidden state for this label
                                    toggleHiddenForLabel(label);
                                    // find the dataset index for this label and apply hidden flag
                                    const dsIndex = ci.data.datasets.findIndex(d => d.label === label);
                                    if (dsIndex >= 0) {
                                        const meta = ci.getDatasetMeta(dsIndex);
                                        meta.hidden = GLOBALHiddenSeries.has(label);
                                        ci.update();
                                    }
                                }
                            },
                            annotation: {
                                annotations: {
                                    lineStart: {
                                        type: "line",
                                        yMin: lineStartValue,
                                        yMax: lineStartValue,
                                        borderColor: "rgba(0,0,0,0.2)",
                                        borderWidth: 2,
                                        borderDash: [5, 5]
                                    },
                                    goalLine: {
                                        type: "line",
                                        yMin: goalLineValue,
                                        yMax: goalLineValue,
                                        borderColor: "rgba(0,0,0,0.8)",
                                        borderWidth: 2,
                                        borderDash: [5, 5]
                                    },
                                    box1: {
                                        type: "box",
                                        yMin: goalLineValue - 5,
                                        yMax: goalLineValue,
                                        backgroundColor: "rgba(0,0,0,0.25)"
                                    }
                                }
                            }
                        }
                    }
                });
        }

        // Preserve full data per dataset so toggle can restore points later
        chartInstance.data.datasets.forEach((ds, idx) => {
            // datasets[idx] is the created dataset; copy its full data snapshot
            ds._fullData = datasets[idx] ? datasets[idx].data.slice() : ds.data.slice();
            // apply showHiddenWeights filtering immediately
            ds.data = showHiddenWeights ? ds._fullData.slice() : ds._fullData.filter(pt => !pt._hidden);
            // apply persisted legend-hidden state
            ds.hidden = GLOBALHiddenSeries.has(ds.label);
        });
    }
    catch (error) {
        console.error("Error in updateCharts:", error);
    }
}

// Update logWeight to use the authenticated user relationship
async function logWeight() {
    if (currentUser.id == "soavzbhd6bu6y5r") {
        submitButton.innerText = ("You CAN'T log weights you're mearly a guest");
        console.error("Unauthorized: Guests can't log weights.");
        return;
    }
    weightFormDialog.close();
    const weight = +document.getElementById("weightInput").value;
    if (!currentUser.id || isNaN(weight)) return;
    try {
        await pocketBase.collection("weights").create({
            weight: weight,
            user: currentUser.id
        });
        document.getElementById("weightInput").value = "";
    } catch (e) {
        console.error("Error logging weight:", e);
    }
}

function setSigninDialogMode(mode) {
    if (mode === "loading") {
        // Randomly choose one line
        const chosen = Math.floor(Math.random() * loadingTextLines.length);

        // Hide all lines except the chosen one
        loadingTextLines.forEach((line, index) => {
            line.style.display = index === chosen ? 'block' : 'none';
        });
        sid_progress.style.display = "block";
        sid_words.style.display = "none";
        signindialog.showModal();
    }
    else if (mode === "signin") {
        submitButton.innerText = ("Submit");
        renderSignInForm();
        sid_progress.style.display = "none";
        sid_words.style.display = "block";
        signindialog.showModal();
    } else if (mode === "closed") {
        sid_progress.style.display = "none";
        sid_words.style.display = "none";
        signindialog.close();
    }
}

// Initialize application
async function init() {
    pocketBase.collection('weights').subscribe('*', async function (e) {
        await loadWeights();
    });
    //EVENT LISTENERS...
    const tabs = GraphTabs.querySelectorAll("a");
    tabs.forEach(tab => {
        tab.addEventListener("click", async () => {
            GLOBALmode = tab.innerText;
            await updateCharts();
        });
    });
    submitButton.addEventListener("click", logWeight);
    ///////////////////////////////

    setSigninDialogMode("loading");
    // Try to restore session, otherwise show sign-in dialog
    await tryRestoreAuth();


}
init();