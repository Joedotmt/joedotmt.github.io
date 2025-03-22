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
const currentParticipantId = localStorage.getItem("participant") || "";
let chartInstance = null;

// Show signin dialog initially
signindialog.showModal();

// Get participant data
async function getParticipant(id)
{
    const participantId = id || currentParticipantId;
    if (!participantId) return null;

    localStorage.setItem("participant", participantId);
    try
    {
        return await pocketBase.collection("participants").getOne(participantId);
    } catch (e)
    {
        console.error("Error fetching participant:", e);
        return null;
    }
}

// Refresh participant data and UI
async function refreshParticipant(id)
{
    sid_progress.style.display = "block";
    sid_words.style.display = "none";

    const participant = await getParticipant(id);
    if (!participant) return;

    welcomeText.innerText = `Hello ${participant.name}`;
    await updateCharts();
    logweightbutton.style.display = window.location.hash === "#admin" ? "" : "none";
    signindialog.close();

    setTimeout(() =>
    {
        sid_words.style.display = "";
        sid_progress.style.display = "";
    }, 500);
}

// Load weights data
async function loadWeights()
{
    try
    {
        return await pocketBase.collection("weights").getFullList({
            sort: "-created",
            expand: "participant"
        });
    } catch (e)
    {
        console.error("Error loading weights:", e);
        return [];
    }
}

// Group weights by participant name
function groupWeights(weights)
{
    const groups = {};
    weights.forEach(element =>
    {
        const name = element.expand.participant.name;
        if (!groups[name]) groups[name] = [];
        groups[name].push(element);
    });
    return groups;
}

// Create chart datasets
function createDatasets(groupedWeights, mode)
{
    const colors = ["#5297ff", "#52ff5a", "green", "orange", "purple"];
    return Object.entries(groupedWeights).map(([name, elements], i) =>
    {
        const startWeight = elements[elements.length - 1].weight;

        return {
            label: name,
            data: elements
                .sort((a, b) => Date.parse(a.updated) - Date.parse(b.updated))
                .map(x =>
                {
                    let y;
                    if (mode === "Relative")
                    {
                        y = x.weight - startWeight;
                    } else if (mode === "Progress")
                    {
                        y = ((x.weight - startWeight) / (elements[0].expand.participant.goal - startWeight)) * 100;
                    } else
                    { // Absolute
                        y = x.weight;
                    }
                    return { x: new Date(x.updated), y };
                }),
            borderColor: colors[i % colors.length],
            fill: false
        };
    });
}

// Render weight records list
function renderRecordList(groupedWeights)
{
    let html = '';

    Object.entries(groupedWeights).forEach(([name, elements]) =>
    {
        const weightLost = (elements[0].weight - elements[elements.length - 1].weight).toFixed(1);

        html += `<h3 style="margin:0em 1rem; border-bottom: 1px solid black;">${name}</h3>
    <ul class="list border">
      <li class="ripple">Total weight lost: ${weightLost}kg</li>`;

        elements.forEach((x, i) =>
        {
            const date = new Date(x.updated).toLocaleDateString("en-GB", {
                day: "2-digit",
                month: "long"
            });

            html += `<li class="ripple" style="${i ? "" : "background-color: var(--inverse-primary);"}">
        <div>${date}</div>
        ${x.weight}kg
      </li>`;
        });

        html += '</ul>';
    });

    recordList.innerHTML = html;
}

// Calculate goal line values
function calculateGoalLineValues(participantWeights, mode)
{
    const lastWeight = participantWeights.length > 0 ?
        participantWeights[participantWeights.length - 1].weight : 0;

    let goalLineValue = 0;
    let lineStartValue = lastWeight;

    if (participantWeights.length > 0)
    {
        const goal = participantWeights[0].expand.participant.goal;

        if (mode === "Absolute")
        {
            goalLineValue = goal;
            lineStartValue = lastWeight;
        } else if (mode === "Relative")
        {
            goalLineValue = -(lastWeight - goal);
            lineStartValue = 0;
        } else if (mode === "Progress")
        {
            goalLineValue = 100;
            lineStartValue = 0;
        }
    }

    return { goalLineValue, lineStartValue };
}

// Update charts
async function updateCharts()
{
    try
    {
        const weights = await loadWeights();
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

        if (yAxisReverse)
        {
            highestValue = Math.min(...datasets.flatMap(ds => ds.data.map(pt => pt.y)));
        } else
        {
            highestValue = Math.max(...datasets.flatMap(ds => ds.data.map(pt => pt.y)));
        }

        if (chartInstance)
        {
            // Update existing chart
            chartInstance.data.datasets = datasets;

            if (chartInstance.options.plugins?.annotation?.annotations)
            {
                const ann = chartInstance.options.plugins.annotation.annotations;
                ann.lineStart.yMin = lineStartValue;
                ann.lineStart.yMax = lineStartValue;
                ann.goalLine.yMin = goalLineValue;
                ann.goalLine.yMax = goalLineValue;
                ann.box1.yMax = goalLineValue;
                ann.box1.yMin = goalLineValue + (yAxisReverse ? margin : -margin);
            }

            chartInstance.options.scales.y.reverse = yAxisReverse;

            if (yAxisReverse)
            {
                chartInstance.options.scales.y.max = (goalLineValue + margin);
                chartInstance.options.scales.y.min = (highestValue - margin);
            } else
            {
                chartInstance.options.scales.y.max = (highestValue + margin);
                chartInstance.options.scales.y.min = (goalLineValue - margin);
            }

            chartInstance.update();
        } else
        {
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
    } catch (error)
    {
        console.error("Error in updateCharts:", error);
    }
}

// Log new weight
async function logWeight()
{
    if (window.location.hash !== "#admin")
    {
        console.error("Unauthorized: Only admin can log weights.");
        return;
    }

    weightFormDialog.close();
    const weight = +document.getElementById("weightInput").value;

    if (!currentParticipantId || isNaN(weight)) return;

    try
    {
        await pocketBase.collection("weights").create({
            weight: weight,
            participant: currentParticipantId
        });

        document.getElementById("weightInput").value = "";
        await updateCharts();
    } catch (e)
    {
        console.error("Error logging weight:", e);
    }
}

// Load all participants
async function loadParticipants()
{
    try
    {
        return await pocketBase.collection("participants").getFullList();
    } catch (e)
    {
        console.error("Error loading participants:", e);
        return [];
    }
}

// Render signin buttons
async function renderSignInButtons()
{
    const participants = await loadParticipants();
    const container = document.getElementById("participantButtons");

    if (container)
    {
        let html = '';
        participants.forEach(participant =>
        {
            html += `<button onclick="refreshParticipant('${participant.id}')">${participant.name}</button>`;
        });
        container.innerHTML = html;
    }
    sid_words.style.display = "block"
}

// Initialize application
async function init()
{
    //EVENT LISTENERS//////////////
    const tabs = GraphTabs.querySelectorAll("a");
    tabs.forEach(tab =>
    {
        tab.addEventListener("click", async () =>
        {
            GLOBALmode = tab.innerText;
            await updateCharts();
        });
    });
    submitButton.addEventListener("click", logWeight);
    ///////////////////////////////

    if (currentParticipantId)
    {
        logweightbutton.style.display = window.location.hash === "#admin" ? "" : "none";
        await refreshParticipant();
    } else
    {
        signindialog.showModal();
        await renderSignInButtons();
        sid_progress.style.display = "none"
        await updateCharts();
    }
}

init();