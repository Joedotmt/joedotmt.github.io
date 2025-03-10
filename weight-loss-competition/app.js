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

    // Update record list
    const records = weightsData.map(e =>
    {
        const formattedDate = new Date(e.updated).toLocaleDateString('en-GB', {
            weekday: 'short',
            day: '2-digit',
            month: 'short',
            year: 'numeric'
        });
        return `<li>${e.weight}kg ${e.expand.participant.name} - ${formattedDate}</li>`;
    }).join('');
    recordList.innerHTML = records;

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
                            display: true,
                            text: 'Date'
                        },
                        ticks: {
                            autoSkip: true,
                            maxRotation: 0,
                            minRotation: 0
                        }
                    },
                    y: {
                        min: 70, // Set the minimum Y value to 70
                        max: 120, // Set the maximum Y value to 120
                        title: {
                            display: true,
                            text: 'Weight (kg)'
                        }
                    }
                },
                plugins: {
                    zoom: {
                        pan: {
                            enabled: true,
                            mode: 'x', // Allow horizontal panning only
                            drag: { enabled: true } // Enable mouse drag panning
                        },
                        zoom: {
                            wheel: {
                                enabled: true
                            },
                            pinch: {
                                enabled: true
                            },
                            mode: 'x' // Allow horizontal zooming only
                        },
                        mode: 'x'
                    },
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
                                borderColor: 'rgba(0, 0, 0, 0.8)', // Red dashed line
                                borderWidth: 2,
                                borderDash: [5, 5], // Dashed style
                                label: {
                                    content: '80kg Target',
                                    enabled: true,
                                    position: 'end',
                                    backgroundColor: 'rgba(255, 99, 132, 0.8)',
                                    color: 'white',
                                    padding: 4
                                }
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
