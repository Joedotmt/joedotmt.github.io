// Initialize the PocketBase client.
// Change the URL to your PocketBase instance.
// const pb = new PocketBase('http://127.0.0.1:8090');
const pb = new PocketBase('https://petition.pockethost.io/');

let participants = {};
let chartInstance = null; // Added global Chart.js instance variable

GLOBALParticipant = localStorage.getItem("participant") || "";

function updateParticipant(id)
{
    GLOBALParticipant = id;
    logweightbutton.style.display = "";
    localStorage.setItem("participant", GLOBALParticipant);
    welcomeText.innerText = "Hello " + GLOBALParticipant.name;
    signindialog.close();
}

// Load all weight entries from the "Weights" collection.
async function loadWeights()
{
    try
    {
        // Retrieves all records sorted by created time.
        const records = await pb.collection("Weights").getFullList({ sort: "-created", expand: "participant" });
        return records;
    } catch (error)
    {
        console.error("Error loading weights:", error);
        return [];
    }
}

async function updateCharts()
{
    // Load the weights data
    const weightsData = await loadWeights();
    if (!weightsData || !Array.isArray(weightsData)) return;

    // Group data by participant name
    let groupedData = {};
    weightsData.forEach(e =>
    {
        const name = e.expand.participant.name;
        if (!groupedData[name])
        {
            groupedData[name] = [];
        }
        groupedData[name].push(e);
    });

    // New: Update record list with separate lists per participant
    let htmlContent = '';
    Object.keys(groupedData).forEach(name =>
    {
        const records = groupedData[name];
        // Changed: add emoji to the top weight record
        const listItems = records.map((e, index) =>
        {
            const formattedDate = new Date(e.updated).toLocaleDateString('en-GB', {
                day: '2-digit',
                month: 'long',
            });
            return `<li class="ripple" style="${index === 0 ? 'background-color: var(--inverse-primary);' : ''}"><div>${formattedDate}</div>${e.weight}kg</li>`;
        }).join('');
        htmlContent += `<h3>${name}</h3><ul class="list border">${listItems}</ul>`;
    });
    recordList.innerHTML = htmlContent;

    // Create datasets for Chart.js, one per participant
    const datasets = [];
    const colorPalette = ['#5297ff', '#52ff5a', 'green', 'orange', 'purple'];
    Object.keys(groupedData).forEach((name, index) =>
    {
        // Sort each participant's data by the update date and format for Chart.js
        const data = groupedData[name]
            .sort((a, b) => new Date(a.updated) - new Date(b.updated))
            .map(e => ({ x: new Date(e.updated), y: e.weight }));
        datasets.push({
            label: name,
            data: data,
            borderColor: colorPalette[index % colorPalette.length],
            fill: false,
        });
    });

    // Render or update the Chart.js line chart
    const ctx = document.getElementById("ProgressGraph").getContext('2d');
    if (chartInstance)
    {
        chartInstance.data.datasets = datasets;
        chartInstance.update();
    } else
    {
        chartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    x: {
                        type: 'time',
                        time: {
                            unit: 'day', // Show data day-by-day
                            displayFormats: {
                                day: 'dd MMM' // Example: 01 Jan, 02 Jan, etc.
                            },
                            tooltipFormat: 'dd MMM yyyy'
                        },
                        title: {
                            display: false
                        },
                        ticks: {
                            autoSkip: true,
                            maxRotation: 0,
                            minRotation: 0
                        }
                    },
                    y: {
                        min: 75,
                        max: 126,
                        title: {
                            display: true,
                            text: 'Weight (kg)'
                        }
                    }
                },
                plugins: {
                    legend: {
                        display: true,
                        position: 'top'
                    },
                    annotation: {
                        annotations: {
                            line80kg: {
                                type: 'line',
                                yMin: 80,
                                yMax: 80,
                                borderColor: 'rgba(0, 0, 0, 0.8)',
                                borderWidth: 2,
                                borderDash: [5, 5],
                            },
                            box1: {
                                type: 'box',
                                yMin: 0,
                                yMax: 80,
                                backgroundColor: 'rgba(0, 0, 0, 0.25)'
                            }
                        }
                    }
                }
            }
        });
    }
}


submitButton.addEventListener("pointerup", async (e) =>
{
    weightFormDialog.close();
    const participantId = GLOBALParticipant;
    const weightValue = document.getElementById("weightInput").value;
    if (!participantId || !weightValue) return;
    try
    {
        // Create a new record in the "Weights" collection.
        await pb.collection("Weights").create({
            weight: parseFloat(weightValue),
            participant: participantId
        });
        document.getElementById("weightInput").value = '';
        // Update the charts after adding a new record.
        await updateCharts();
    } catch (error)
    {
        console.error("Error logging weight:", error);
    }
});

// Initialize the app by loading participants, charts, and setting up realtime updates.
async function init()
{
    if (GLOBALParticipant != "")
    {
        logweightbutton.style.display = "";
        let participant = await pb.collection('participants').getOne(GLOBALParticipant);
        welcomeText.innerText = "Hello " + participant.name;
    } else
    {
        signindialog.showModal();
    }
    await updateCharts();
    // Setup realtime subscription for the "Weights" collection.
    pb.collection("Weights").subscribe('*', async function (e)
    {
        console.log("Realtime event:", e);
        await updateCharts();
    });
}

init();
