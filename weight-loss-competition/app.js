"use strict";
const pocketBase = new PocketBase('https://petition.pockethost.io/');
const currentParticipantId = localStorage.getItem("participant") ?? "";
let chartInstance = null;

const getParticipant = async id =>
{
    const participantId = id || currentParticipantId;
    if (!participantId) return null;
    localStorage.setItem("participant", participantId);
    return await pocketBase.collection('participants').getOne(participantId)
        .catch(e => (console.error("Error fetching participant:", e), null));
};

const refreshParticipant = async id =>
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
};

const loadWeights = async () =>
    pocketBase.collection("weights").getFullList({ sort: "-created", expand: "participant" })
        .catch(e => (console.error("Error loading weights:", e), []));

const groupWeights = weights => weights.reduce((accumulator, element) =>
    ((accumulator[element.expand.participant.name] ??= []).push(element), accumulator), {});

const createDatasets = groupedWeights => Object.entries(groupedWeights).map(([name, elements], i) => ({
    label: name,
    data: elements.sort((a, b) => Date.parse(a.updated) - Date.parse(b.updated))
        .map(x => ({ x: new Date(x.updated), y: x.weight })),
    borderColor: ['#5297ff', '#52ff5a', 'green', 'orange', 'purple'][i % 5],
    fill: false
}));

const renderRecordList = groupedWeights =>
{
    recordList.innerHTML = Object.entries(groupedWeights).map(([name, elements]) =>
    {
        const weightLost = (elements[0].weight - elements[elements.length - 1].weight).toFixed(1);
        return `<h3 style="margin:0em 1rem; border-bottom: 1px solid black;">${name}</h3>
        <ul class="list border">
            <li class="ripple">Total weight lost: ${weightLost}kg</li>
            ${elements.map((x, i) =>
            `<li class="ripple" style="${i ? '' : 'background-color: var(--inverse-primary);'}">
                    <div>${new Date(x.updated).toLocaleDateString('en-GB', { day: '2-digit', month: 'long' })}</div>
                    ${x.weight}kg
                </li>`).join('')
            }
        </ul>`;
    }).join('');
};

const updateCharts = async () =>
{
    const weights = await loadWeights();
    const grouped = groupWeights(weights);
    renderRecordList(grouped);
    const participantWeights = currentParticipantId ? weights.filter(w => w.expand.participant.id === currentParticipantId) : [];
    const start = participantWeights[participantWeights.length - 1]?.weight || 0;
    const ctx = document.getElementById("ProgressGraph").getContext('2d');
    const datasets = createDatasets(grouped);

    if (chartInstance)
    {
        chartInstance.data.datasets = datasets;
        const l = chartInstance.options.plugins.annotation.annotations.lineStart;
        l.yMin = l.yMax = start;
        chartInstance.update();
    } else chartInstance = new Chart(ctx, {
        type: 'line',
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    type: 'time',
                    time: { unit: 'day', displayFormats: { day: 'dd MMM' }, tooltipFormat: 'dd MMM yyyy' },
                    title: { display: false },
                    ticks: { autoSkip: true, maxRotation: 0, minRotation: 0 }
                },
                y: {
                    min: 75,
                    max: 126,
                    title: { display: true, text: 'Weight (kg)' }
                }
            },
            plugins: {
                legend: { display: true, position: 'top' },
                annotation: {
                    annotations: {
                        lineStart: {
                            type: 'line',
                            yMin: start,
                            yMax: start,
                            borderColor: 'rgba(0,0,0,0.2)',
                            borderWidth: 2,
                            borderDash: [5, 5]
                        },
                        line80kg: {
                            type: 'line',
                            yMin: 80,
                            yMax: 80,
                            borderColor: 'rgba(0,0,0,0.8)',
                            borderWidth: 2,
                            borderDash: [5, 5]
                        },
                        box1: {
                            type: 'box',
                            yMin: 0,
                            yMax: 80,
                            backgroundColor: 'rgba(0,0,0,0.25)'
                        }
                    }
                }
            }
        }
    });
};

const logWeight = async () =>
{
    if (window.location.hash !== "#admin")
    {
        console.error("Unauthorized: Only admin can log weights.");
        return;
    }
    weightFormDialog.close();
    const weight = +document.getElementById("weightInput").value;
    if (!currentParticipantId || isNaN(weight)) return;
    await pocketBase.collection("weights").create({ weight: weight, participant: currentParticipantId })
        .catch(e => console.error("Error logging weight:", e));
    document.getElementById("weightInput").value = '';
    await updateCharts();
};

// New function: Load all participants from the collection
const loadParticipants = async () =>
{
    return await pocketBase.collection('participants').getFullList()
        .catch(e => { console.error("Error loading participants:", e); return []; });
};

// New function: Render sign‑in buttons dynamically
const renderSignInButtons = async () =>
{
    const participants = await loadParticipants();
    const container = document.getElementById("participantButtons");
    if (container)
    {
        container.innerHTML = participants.map(participant =>
            `<button onclick="refreshParticipant('${participant.id}')">${participant.name}</button>`
        ).join('');
    }
};

const init = async () =>
{
    if (currentParticipantId)
    {
        logweightbutton.style.display = window.location.hash === "#admin" ? "" : "none";
        await refreshParticipant();
    } else
    {
        signindialog.showModal();
        await renderSignInButtons();
        await updateCharts();
    }
    pocketBase.collection("weights").subscribe('*', () => updateCharts());
    submitButton.addEventListener("pointerup", logWeight);
};

init();