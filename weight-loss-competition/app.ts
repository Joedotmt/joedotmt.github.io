interface Participant {
    id: string;
    name: string;
    goal: number;
}

interface Weight {
    weight: number;
    updated: string;
    expand: {
        participant: Participant;
    };
}

const logweightbutton = document.getElementById(
    "logweightbutton",
) as HTMLElement;
const sid_progress = document.getElementById("sid_progress") as HTMLElement;
const sid_words = document.getElementById("sid_words") as HTMLElement;
const welcomeText = document.getElementById("welcomeText") as HTMLElement;
const recordList = document.getElementById("recordList") as HTMLElement;
const submitButton = document.getElementById("submitButton") as HTMLElement;
const weightFormDialog = document.getElementById(
    "weightFormDialog",
) as HTMLDialogElement;
const signindialog = document.getElementById(
    "signindialog",
) as HTMLDialogElement;
const GraphTabs = document.getElementById("GraphTabs") as HTMLElement;

let GLOBALmode = "Absolute";

signindialog.showModal();

const pocketBase = new PocketBase("https://petition.pockethost.io/");

const currentParticipantId: string = localStorage.getItem("participant") ?? "";
let chartInstance: typeof Chart | null = null;

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

const calculateGoalLineValues = (
    participantWeights: Weight[],
    mode: string,
) => {
    const lastWeight =
        participantWeights[participantWeights.length - 1]?.weight || 0;
    let goalLineValue = 0,
        lineStartValue = lastWeight;
    if (participantWeights.length > 0) {
        const { goal } = participantWeights[0].expand.participant;
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
};

// Refactored updateCharts with error handling and computed values
const updateCharts = async (): Promise<void> => {
    try {
        const weights = await loadWeights();
        const grouped = groupWeights(weights);
        renderRecordList(grouped);
        const participantWeights = currentParticipantId
            ? weights.filter((w) =>
                w.expand.participant.id === currentParticipantId
            )
            : [];
        const { goalLineValue, lineStartValue } = calculateGoalLineValues(
            participantWeights,
            GLOBALmode,
        );

        // ...existing code to initialize Chart context and datasets...
        const ctx =
            (document.getElementById("ProgressGraph") as HTMLCanvasElement)
                .getContext("2d");
        const datasets = createDatasets(grouped, GLOBALmode);
        const margin = 5;
        let highestValue: number;
        const yAxisReverse = GLOBALmode === "Progress";
        if (yAxisReverse) {
            highestValue = Math.min(
                ...datasets.flatMap((ds) => ds.data.map((pt: any) => pt.y)),
            );
        } else {
            highestValue = Math.max(
                ...datasets.flatMap((ds) => ds.data.map((pt: any) => pt.y)),
            );
        }

        if (chartInstance) {
            chartInstance.data.datasets = datasets;
            if (chartInstance.options.plugins?.annotation?.annotations) {
                const ann =
                    chartInstance.options.plugins.annotation.annotations;
                ann.lineStart.yMin = lineStartValue;
                ann.lineStart.yMax = lineStartValue;
                ann.goalLine.yMin = goalLineValue;
                ann.goalLine.yMax = goalLineValue;
                ann.box1.yMax = goalLineValue;
                ann.box1.yMin = goalLineValue +
                    (yAxisReverse ? margin : -margin);
            }
            chartInstance.options.scales!.y.reverse = yAxisReverse;
            if (yAxisReverse) {
                chartInstance.options.scales!.y.max = goalLineValue + margin;
                chartInstance.options.scales!.y.min = highestValue - margin;
            } else {
                chartInstance.options.scales!.y.max = highestValue + margin;
                chartInstance.options.scales!.y.min = goalLineValue - margin;
            }
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
                                displayFormats: { day: "dd MMM" },
                                tooltipFormat: "dd MMM yyyy",
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
    } catch (error) {
        console.error("Error in updateCharts:", error);
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

// New function: Centralize DOM event listener assignments
const attachEventListeners = (): void => {
    GraphTabs.querySelectorAll("a").forEach((e) => {
        e.addEventListener("click", async () => {
            GLOBALmode = e.innerText;
            await updateCharts();
        });
    });
    submitButton.addEventListener("click", logWeight);
    //pocketBase.collection("weights").subscribe("*", updateCharts);
};

// Refactored init function to use centralized event listener setup
const init = async (): Promise<void> => {
    attachEventListeners();
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
};

init();
