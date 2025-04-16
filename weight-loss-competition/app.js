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

// Show signin dialog initially
setSigninDialogMode("loading");

// Updated signIn to use authWithPassword authentication
async function signIn(username, password) {
    if (!username || !password) {
        setSigninDialogMode("signin");
        return;
    }
    setSigninDialogMode("loading");
    try {
        const authData = await pocketBase.collection('users').authWithPassword(username, password);
        currentUser = pocketBase.authStore.model;
    } catch (e) {
        console.error("Error during sign in:", e);
        alert("Error signing in");
        setSigninDialogMode("signin");
        return;
    }
    setSigninDialogMode("closed");
    welcomeText.innerText = `Hello ${currentUser.username}`;
    updateCharts();
}

// Update renderSignInForm to pass username and password to signIn
function renderSignInForm() {
    const container = document.getElementById("participantButtons");
    if (container) {
        container.innerHTML = `
            <form id="signinForm" style="display: flex; flex-direction: column; gap: 1em;">
                <input type="text" id="usernameInput" placeholder="Username or Email" required>
                <input type="password" id="passwordInput" placeholder="Password" required>
                <button type="submit">Sign In</button>
                <button type="button" id="guestSignInButton">Sign in as Guest</button>
            </form>
        `;
        const form = document.getElementById("signinForm");
        form.addEventListener("submit", async (event) => {
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

let GLOBALWeightData = null;
// Load weights data
async function loadWeights() {
    try {
        GLOBALWeightData = await pocketBase.collection("weights").getFullList({
            sort: "-created",
            expand: "user",
            filter: "hidden = false"
        });
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
    Object.entries(groupedWeights).forEach(([name, elements]) => {
        // Use currentUser.goal if the group corresponds to the logged in user; otherwise assume a goal of 0.
        const goal = (name === currentUser.username) ? currentUser.goal : 0;
        const startingWeight = elements[elements.length - 1].weight;
        const currentWeight = elements[0].weight;
        const weightLost = (startingWeight - currentWeight).toFixed(1);
        const totalToLose = (startingWeight - goal);
        const progressPercent = totalToLose ? ((weightLost / totalToLose) * 100).toFixed(1) : 0;
        html += `<article style="padding: 0; border-bottom: .0625rem solid var(--surface-variant); box-shadow: none; border-radius:0;">
  <progress class="max" value="${progressPercent}" max="100"></progress>
<h3 style="margin:0em 0.8rem;">${name}</h3>
</article>
    <ul class="list border">
      <li style="display: flex; flex-direction: column; align-items: flex-start; gap:0; min-height: fit-content">
        <div>Lost: ${weightLost}kg</div>
        <div>Goal: ${goal}kg</div>
        <div>Left: ${(currentWeight - goal).toFixed(1)}kg</div>
        <div style="display:flex; gap:0.5em; align-items:center">${progressPercent}%<progress value="${progressPercent}" max="100" class="large"></progress></div>
      </li>`;
        elements.forEach((x, i) => {
            const date = new Date(x.created).toLocaleDateString("en-GB", { day: "2-digit", month: "long" });
            html += `<li style="${i ? "" : "background-color: var(--inverse-primary);"}">
        <div>${date}</div>
        ${x.weight}kg
      </li>`;
        });
        html += '</ul>';
    });
    recordList.innerHTML = html;
}

// Update calculateGoalLineValues to use currentUser.goal
function calculateGoalLineValues(currentUserWeights, mode) {
    const lastWeight = currentUserWeights.length > 0 ? currentUserWeights[currentUserWeights.length - 1].weight : 0;
    let goalLineValue = 0;
    let lineStartValue = lastWeight;
    if (currentUserWeights.length > 0) {
        const goal = currentUser.goal;
        if (mode === "Absolute") {
            goalLineValue = goal;
            lineStartValue = lastWeight;
        } else if (mode === "Relative") {
            goalLineValue = -(lastWeight - goal);
            lineStartValue = 0;
        } else if (mode === "Progress") {
            goalLineValue = 100;
            lineStartValue = 0;
        }
    }
    return { goalLineValue, lineStartValue };
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
                    .sort((a, b) => Date.parse(a.created) - Date.parse(b.created))
                    .map(x => {
                        let y;
                        if (mode === "Relative") {
                            y = x.weight - startWeight;
                        } else if (mode === "Progress") {
                            y = ((x.weight - startWeight) / (elements[0].expand.user.goal - startWeight)) * 100;
                        } else { // Absolute
                            y = x.weight;
                        }
                        return { x: new Date(x.created), y };
                    }),
                borderColor: colors[getColorIndex(name)],
                fill: false
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
            chartInstance.data.datasets = datasets;

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
            chartInstance = new Chart(ctx, {
                type: "line",
                data: { datasets },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
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
                        legend: { display: true, position: "top" },
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
    } catch (error) {
        console.error("Error in updateCharts:", error);
    }
}

// Update logWeight to use the authenticated user relationship
async function logWeight() {
    if (currentUser.id == "soavzbhd6bu6y5r") {
        submitButton.innerText = ("You CAN'T log weights you're mearly a guest")
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
        submitButton.innerText = ("Submit")
        renderSignInForm()
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
        await updateCharts();
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
    await loadWeights();
    // Use stored username for auto sign-in if desired (password must be re-entered for security)
    const storedUsername = localStorage.getItem("participant") || "";
    await signIn(storedUsername, ""); // will show the signin dialog if password is missing
}
init();