interface Participant {
    id: string;
    name: string;
    goal: number; // Added goal property
}

interface Weight {
    weight: number;
    updated: string;
    expand: {
        participant: Participant;
    };
}

const logweightbutton = document.getElementById("logweightbutton");
const sid_progress = document.getElementById("sid_progress");
const sid_words = document.getElementById("sid_words");
const welcomeText = document.getElementById("welcomeText");
const recordList = document.getElementById("recordList");
const submitButton = document.getElementById("weightFormDialog");
const weightFormDialog: HTMLDialogElement = document.getElementById(
    "weightFormDialog",
);
const signindialog: HTMLDialogElement = document.getElementById("signindialog");
const GraphTabs = document.getElementById("GraphTabs");

let GLOBALmode = "Absolute";
GraphTabs.querySelectorAll("a").forEach((e) => {
    e.addEventListener("click", async () => {
        GLOBALmode = e.innerText;
        await updateCharts();
    });
});

const pocketBase = new PocketBase("https://petition.pockethost.io/");
const currentParticipantId: string = localStorage.getItem("participant") ?? "";
let chartInstance: Chart | null = null;

const getParticipant = async (id?: string): Promise<Participant | null> => {
    const participantId = id || currentParticipantId;
    if (!participantId) return null;
    localStorage.setItem("participant", participantId);
    return await pocketBase.collection("participants").getOne(participantId)
        .catch((e) => (console.error("Error fetching participant:", e), null));
};

const refreshParticipant = async (id?: string): Promise<void> => {
    sid_progress.style.display = "block";
    sid_words.style.display = "none";
    const participant = await getParticipant(id);
    if (!participant) return;
    welcomeText.innerText = `Hello ${participant.name}`;
    await updateCharts();
    logweightbutton.style.display = window.location.hash === "#admin"
        ? ""
        : "none";
    signindialog.close();
    setTimeout(() => {
        sid_words.style.display = "";
        sid_progress.style.display = "";
    }, 500);
};

const loadWeights = async (): Promise<Weight[]> =>
    pocketBase.collection("weights").getFullList({
        sort: "-created",
        expand: "participant",
    })
        .catch((e) => (console.error("Error loading weights:", e), []));

const groupWeights = (weights: Weight[]): Record<string, Weight[]> =>
    weights.reduce((accumulator, element) => {
        (accumulator[element.expand.participant.name] ??= []).push(element);
        return accumulator;
    }, {} as Record<string, Weight[]>);

const createDatasets = (
    groupedWeights: Record<string, Weight[]>,
    mode: string,
): ChartDataset[] =>
    Object.entries(groupedWeights).map(([name, elements], i) => {
        const startWeight = elements[elements.length - 1].weight;
        return {
            label: name,
            data: elements.sort((a, b) =>
                Date.parse(a.updated) - Date.parse(b.updated)
            )
                .map((x) => ({
                    x: new Date(x.updated),
                    y: mode === "Relative"
                        ? x.weight - startWeight
                        : mode === "Progress"
                        ? ((x.weight - startWeight) /
                            (elements[0].expand.participant.goal -
                                startWeight)) * 100
                        : x.weight,
                })),
            borderColor:
                ["#5297ff", "#52ff5a", "green", "orange", "purple"][i % 5],
            fill: false,
        };
    });

const renderRecordList = (groupedWeights: Record<string, Weight[]>): void => {
    recordList.innerHTML = Object.entries(groupedWeights).map(
        ([name, elements]) => {
            const weightLost =
                (elements[0].weight - elements[elements.length - 1].weight)
                    .toFixed(1);
            return `<h3 style="margin:0em 1rem; border-bottom: 1px solid black;">${name}</h3>
        <ul class="list border">
            <li class="ripple">Total weight lost: ${weightLost}kg</li>
            ${
                elements.map((x, i) =>
                    `<li class="ripple" style="${
                        i ? "" : "background-color: var(--inverse-primary);"
                    }">
                    <div>${
                        new Date(x.updated).toLocaleDateString("en-GB", {
                            day: "2-digit",
                            month: "long",
                        })
                    }</div>
                    ${x.weight}kg
                </li>`
                ).join("")
            }
        </ul>`;
        },
    ).join("");
};

const updateCharts = async (): Promise<void> => {
    const weights = await loadWeights();
    const grouped = groupWeights(weights);
    renderRecordList(grouped);
    const participantWeights = currentParticipantId
        ? weights.filter((w) =>
            w.expand.participant.id === currentParticipantId
        )
        : [];
    const start = participantWeights[participantWeights.length - 1]?.weight ||
        0;

    // Compute goalLineValue based on GLOBALmode and current participant's data
    let goalLineValue = 0;
    let lineStartValue = start;
    if (currentParticipantId && participantWeights.length > 0) {
        const participantGoal = participantWeights[0].expand.participant.goal;
        const startWeight =
            participantWeights[participantWeights.length - 1].weight;
        if (GLOBALmode === "Absolute") {
            goalLineValue = participantGoal;
            lineStartValue = startWeight;
        } else if (GLOBALmode === "Relative") {
            goalLineValue = -(startWeight - participantGoal);
            lineStartValue = 0;
        } else if (GLOBALmode === "Progress") {
            goalLineValue = 100;
            lineStartValue = 0;
        }
    }

    const ctx = (document.getElementById("ProgressGraph") as HTMLCanvasElement)
        .getContext("2d");
    const datasets = createDatasets(grouped, GLOBALmode);

    // Calculate the highest value in the datasets
    let highestValue;
    const yAxisReverse = GLOBALmode === "Progress";

    if (yAxisReverse) {
        highestValue = Math.min(
            ...datasets.flatMap((dataset) =>
                dataset.data.map((point) => point.y)
            ),
        );
    } else {
        highestValue = Math.max(
            ...datasets.flatMap((dataset) =>
                dataset.data.map((point) => point.y)
            ),
        );
    }
    const margin = 5;

    if (chartInstance) {
        chartInstance.data.datasets = datasets;
        if (
            chartInstance.options.plugins &&
            chartInstance.options.plugins.annotation &&
            chartInstance.options.plugins.annotation.annotations
        ) {
            chartInstance.options.plugins.annotation.annotations.lineStart
                .yMin = lineStartValue;
            chartInstance.options.plugins.annotation.annotations.lineStart
                .yMax = lineStartValue;
            chartInstance.options.plugins.annotation.annotations.goalLine.yMin =
                goalLineValue;
            chartInstance.options.plugins.annotation.annotations.goalLine.yMax =
                goalLineValue;
            chartInstance.options.plugins.annotation.annotations.box1.yMax =
                goalLineValue;
            chartInstance.options.plugins.annotation.annotations.box1.yMin =
                goalLineValue + (yAxisReverse ? margin : -margin);
        }

        if (yAxisReverse) {
            chartInstance.options.scales.y.max = goalLineValue + margin;
            chartInstance.options.scales.y.min = highestValue - margin;
        } else {
            chartInstance.options.scales.y.max = highestValue + margin;
            chartInstance.options.scales.y.min = goalLineValue - margin;
        }

        chartInstance.options.scales.y.reverse = yAxisReverse;
        chartInstance.update();
    } else {
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
                            tooltipFormat: "dd MMM yyyy",
                        },
                        title: { display: false },
                        ticks: {
                            autoSkip: true,
                            maxRotation: 0,
                            minRotation: 0,
                        },
                    },
                    y: {
                        title: { display: true, text: "Weight Lost (kg)" },
                        reverse: yAxisReverse,
                        min: goalLineValue - 5,
                        max: highestValue + 5,
                    },
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
                                borderDash: [5, 5],
                            },
                            goalLine: {
                                type: "line",
                                yMin: goalLineValue,
                                yMax: goalLineValue,
                                borderColor: "rgba(0,0,0,0.8)",
                                borderWidth: 2,
                                borderDash: [5, 5],
                            },
                            box1: {
                                type: "box",
                                yMin: goalLineValue - 5,
                                yMax: goalLineValue,
                                backgroundColor: "rgba(0,0,0,0.25)",
                            },
                        },
                    },
                },
            },
        });
    }
};

const logWeight = async (): Promise<void> => {
    if (window.location.hash !== "#admin") {
        console.error("Unauthorized: Only admin can log weights.");
        return;
    }
    weightFormDialog.close();
    const weight = +(<HTMLInputElement> document.getElementById("weightInput"))
        .value;
    if (!currentParticipantId || isNaN(weight)) return;
    await pocketBase.collection("weights").create({
        weight: weight,
        participant: currentParticipantId,
    })
        .catch((e) => console.error("Error logging weight:", e));
    (<HTMLInputElement> document.getElementById("weightInput")).value = "";
    await updateCharts();
};

// New function: Load all participants from the collection
const loadParticipants = async (): Promise<Participant[]> => {
    return await pocketBase.collection("participants").getFullList()
        .catch((e) => {
            console.error("Error loading participants:", e);
            return [];
        });
};

// New function: Render sign‑in buttons dynamically
const renderSignInButtons = async (): Promise<void> => {
    const participants = await loadParticipants();
    const container = document.getElementById("participantButtons");
    if (container) {
        container.innerHTML = participants.map((participant) =>
            `<button onclick="refreshParticipant('${participant.id}')">${participant.name}</button>`
        ).join("");
    }
};

const init = async (): Promise<void> => {
    if (currentParticipantId) {
        logweightbutton.style.display = window.location.hash === "#admin"
            ? ""
            : "none";
        await refreshParticipant();
    } else {
        signindialog.showModal();
        await renderSignInButtons();
        await updateCharts();
    }
    pocketBase.collection("weights").subscribe("*", () => updateCharts());
    submitButton.addEventListener("pointerup", logWeight);
};

init();
