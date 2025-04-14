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

// Global state
let GLOBALmode = "Absolute";
const pocketBase = new PocketBase("https://petition.pockethost.io/");
//const pocketBase = new PocketBase("http://127.0.0.1:8090/");
let currentParticipantId = localStorage.getItem("participant") || "";
let chartInstance = null;
let GLOBALparticipants = null

// Show signin dialog initially
setSigninDialogMode("loading");

// Get participant data
async function getParticipant(id) {
    const participantId = id || currentParticipantId;
    if (!participantId) return null;

    localStorage.setItem("participant", participantId);
    try {
        return await pocketBase.collection("participants").getOne(participantId);
    } catch (e) {
        console.error("Error fetching participant:", e);
        return null;
    }
}

// Refresh participant data and UI
async function refreshParticipant(id) {
    setSigninDialogMode("loading");

    const participant = await getParticipant(id);
    if (!participant) return;

    currentParticipantId = participant.id;

    welcomeText.innerText = `Hello ${participant.name}`;
    await updateCharts();
    logweightbutton.disabled = window.location.hash === "#admin" ? "false" : "true";
    setSigninDialogMode("closed");
}
let GLOBALWeightData = null
// Load weights data
async function loadWeights() {
    try {
        GLOBALWeightData = await pocketBase.collection("weights").getFullList({
            sort: "-created",
            expand: "participant",
            filter: "hidden = false"
        });
        return true;
    } catch (e) {
        console.error("Error loading weights:", e);
        return [];
    }
}


// Group weights by participant name
function groupWeights(weights) {
    const groups = {};
    weights.forEach(element => {
        const name = element.expand.participant.name;
        if (!groups[name]) groups[name] = [];
        groups[name].push(element);
    });
    return groups;
}



// Render weight records list
function renderRecordList(groupedWeights) {
    let html = '';
    Object.entries(groupedWeights).forEach(([name, elements]) => {
        //const weightLost = (elements[0].weight - elements[elements.length - 1].weight).toFixed(1);

        const goal = GLOBALparticipants.find(p => p.name === name)?.goal;
        const startingWeight = elements[elements.length - 1].weight;
        const currentWeight = elements[0].weight;
        const weightLost = (startingWeight - currentWeight).toFixed(1);
        const totalToLose = (startingWeight - goal);
        const progressPercent = ((weightLost / totalToLose) * 100).toFixed(1);


        html += `<article style="padding: 0; border-bottom: .0625rem solid var(--surface-variant); box-shadow: none; border-radius:0;">
  <progress class="max" value="${progressPercent}" max="100"></progress>
<h3 style="margin:0em 1rem;">${name}</h3>
</article>
    <ul class="list border">
      <li style="display: flex
;
    flex-direction: column;
    align-items: flex-start; gap:0; min-height: fit-content" ">
        <div>Total weight lost: ${weightLost}kg</div>
        <div>Goal: ${goal}kg</div>
        <div style="display:flex; gap:0.5em; align-items:center">${progressPercent}%<progress value="${progressPercent}" max="100" class="large"></progress></div>
      </li>`;


        elements.forEach((x, i) => {
            const date = new Date(x.created).toLocaleDateString("en-GB", {
                day: "2-digit",
                month: "long"
            });

            html += `<li style="${i ? "" : "background-color: var(--inverse-primary);"}">
        <div>${date}</div>
        ${x.weight}kg
      </li>`;
        });

        html += '</ul>';
    });

    recordList.innerHTML = html;
}

// Calculate goal line values
function calculateGoalLineValues(participantWeights, mode) {
    const lastWeight = participantWeights.length > 0 ?
        participantWeights[participantWeights.length - 1].weight : 0;

    let goalLineValue = 0;
    let lineStartValue = lastWeight;

    if (participantWeights.length > 0) {
        const goal = participantWeights[0].expand.participant.goal;

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

// Update charts
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
                            y = ((x.weight - startWeight) / (elements[0].expand.participant.goal - startWeight)) * 100;
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

        const participantWeights = currentParticipantId ?
            weights.filter(w => w.expand.participant.id === currentParticipantId) : [];


        const { goalLineValue, lineStartValue } = calculateGoalLineValues(participantWeights, GLOBALmode);

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
                            title: { display: true, text: "Weight Lost (kg)" },
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

// Log new weight
async function logWeight() {
    if (window.location.hash !== "#admin") {
        console.error("Unauthorized: Only admin can log weights.");
        return;
    }

    weightFormDialog.close();
    const weight = +document.getElementById("weightInput").value;

    if (!currentParticipantId || isNaN(weight)) return;

    try {
        await pocketBase.collection("weights").create({
            weight: weight,
            participant: currentParticipantId
        });

        document.getElementById("weightInput").value = "";
    } catch (e) {
        console.error("Error logging weight:", e);
    }
}

// Load all participants
async function loadParticipants() {
    try {
        GLOBALparticipants = await pocketBase.collection("participants").getFullList();
    } catch (e) {
        console.error("Error loading participants:", e);
        return [];
    }
}

function setSigninDialogMode(mode) {
    if (mode === "loading") {
        sid_progress.style.display = "block";
        sid_words.style.display = "none";
        signindialog.showModal();
    }
    else if (mode === "signin") {
        renderSignInButtons();
        sid_progress.style.display = "none";
        sid_words.style.display = "block";
        signindialog.showModal();
    } else if (mode === "closed"){
        sid_progress.style.display = "none";
        sid_words.style.display = "none";
        signindialog.close();
    }
}

// Render signin buttons
async function renderSignInButtons() {
    const participants = GLOBALparticipants
    const container = document.getElementById("participantButtons");

    if (container) {
        let html = '';
        participants.forEach(participant => {
            html += `<button onclick="refreshParticipant('${participant.id}')">${participant.name}</button>`;
        });
        container.innerHTML = html;
    }
}

// Initialize application
async function init() {

    pocketBase.collection('weights').subscribe('*', async function (e) {
        await loadWeights()
        await updateCharts()
    }, { /* other options like expand, custom headers, etc. */ });

    //EVENT LISTENERS//////////////
    const tabs = GraphTabs.querySelectorAll("a");
    tabs.forEach(tab => {
        tab.addEventListener("click", async () => {
            GLOBALmode = tab.innerText;
            await updateCharts();
        });
    });
    submitButton.addEventListener("click", logWeight);
    ///////////////////////////////
    await loadParticipants()
    await loadWeights()

    if (currentParticipantId) {
        await refreshParticipant();
    }
    else
    {
        await setSigninDialogMode("signin");
    }
    
}

init();