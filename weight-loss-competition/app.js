"use strict";
const pb = new PocketBase('https://petition.pockethost.io/');
const currentParticipantId = localStorage.getItem("participant") ?? "";
let chartInstance = null;

const getParticipant = async id =>
{
    const pid = id || currentParticipantId;
    if (!pid) return null;
    localStorage.setItem("participant", pid);
    return await pb.collection('participants').getOne(pid)
        .catch(e => (console.error("Error fetching participant:", e), null));
};

const refreshParticipant = async id =>
{
    sid_progress.style.display = "block";
    sid_words.style.display = "none";
    const p = await getParticipant(id);
    if (!p) return;
    welcomeText.innerText = `Hello ${p.name}`;
    await updateCharts();
    logweightbutton.style.display = "";
    signindialog.close();
    setTimeout(() =>
    {
        sid_words.style.display = "";
        sid_progress.style.display = "";
    }, 500);
};

const loadWeights = async () =>
    pb.collection("weights").getFullList({ sort: "-created", expand: "participant" })
        .catch(e => (console.error("Error loading weights:", e), []));

const groupWeights = w => w.reduce((a, e) =>
    ((a[e.expand.participant.name] ??= []).push(e), a), {});

const createDatasets = g => Object.entries(g).map(([n, e], i) => ({
    label: n,
    data: e.sort((a, b) => Date.parse(a.updated) - Date.parse(b.updated))
        .map(x => ({ x: new Date(x.updated), y: x.weight })),
    borderColor: ['#5297ff', '#52ff5a', 'green', 'orange', 'purple'][i % 5],
    fill: false
}));

const renderRecordList = g =>
{
    recordList.innerHTML = Object.entries(g).map(([n, e]) =>
    {
        // Sort records by date to determine initial and latest weight
        const sorted = e.slice().sort((a, b) => Date.parse(a.updated) - Date.parse(b.updated));
        const weightLost = (sorted[0].weight - sorted[sorted.length - 1].weight).toFixed(1);
        return `<h3 style="margin:0em 1rem; border-bottom: 1px solid black;">${n}</h3>
        <ul class="list border">
            <li class="ripple">Total weight lost: ${weightLost}kg</li>
            ${sorted.map((x, i) =>
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
    const pw = currentParticipantId ? weights.filter(w => w.expand.participant.id === currentParticipantId) : [];
    const start = pw[pw.length - 1]?.weight || 0;
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
    weightFormDialog.close();
    const w = +document.getElementById("weightInput").value;
    if (!currentParticipantId || isNaN(w)) return;
    await pb.collection("weights").create({ weight: w, participant: currentParticipantId })
        .catch(e => console.error("Error logging weight:", e));
    document.getElementById("weightInput").value = '';
    await updateCharts();
};

const init = async () =>
{
    if (currentParticipantId)
    {
        logweightbutton.style.display = "";
        await refreshParticipant();
    } else
    {
        signindialog.showModal();
        await updateCharts();
    }
    pb.collection("weights").subscribe('*', () => updateCharts());
    submitButton.addEventListener("pointerup", logWeight);
};

init();