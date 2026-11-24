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
const competitionSelect = document.getElementById("competitionSelect");
const competitionNotice = document.getElementById("competitionNotice");
const competitionDialog = document.getElementById("competitionDialog");
const competitionForm = document.getElementById("competitionForm");
const competitionFriends = document.getElementById("competitionFriends");
const competitionName = document.getElementById("competitionName");
const competitionStartDate = document.getElementById("competitionStartDate");
const competitionFormNotice = document.getElementById("competitionFormNotice");
const createCompetitionButton = document.getElementById("createCompetitionButton");
const cancelCompetitionButton = document.getElementById("cancelCompetitionButton");
const newCompetitionButton = document.getElementById("newCompetitionButton");

// Global state
let GLOBALmode = "Absolute";
const pocketBase = new PocketBase("https://joemt-weight.fly.dev/");
const guestId = "soavzbhd6bu6y5r";
const competitionTimeZone = "Europe/Berlin";
const berlinCalendar = new Intl.DateTimeFormat("en-GB", {
    timeZone: competitionTimeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
});
const competitionDateLabel = new Intl.DateTimeFormat("en-GB", {
    timeZone: competitionTimeZone,
    year: "numeric",
    month: "short",
    day: "numeric"
});
const competitionTickLabel = new Intl.DateTimeFormat("en-GB", {
    timeZone: competitionTimeZone,
    month: "short",
    day: "2-digit"
});
const participantNames = new Intl.ListFormat("en-GB");
let chartInstance = null;
let currentUser = {};
let GLOBALWeightData = [];
let showHiddenWeights = true;
let competitions = [];
let competitionsRequest = 0;
let weightsRequest = 0;
let competitionListFailed = false;
let weightsNotice = "";

// NEW: remember which participants are hidden on the graph (persisted)
let GLOBALHiddenSeries = new Set();

function toggleHiddenParticipant(id) {
    if (GLOBALHiddenSeries.has(id)) GLOBALHiddenSeries.delete(id);
    else GLOBALHiddenSeries.add(id);
}

function toggleHiddenWeights() {
    showHiddenWeights = !showHiddenWeights;
    updateCharts();
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

            await loadTracker();

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
    await loadTracker();
    setSigninDialogMode("closed");
    updateWelcomeTextAndWords();
}

function signOut() {
    pocketBase.authStore.clear();
    window.location.reload();
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

function berlinDay(date) {
    const parts = Object.fromEntries(berlinCalendar.formatToParts(date).map(({ type, value }) => [type, value]));
    return `${parts.year}-${parts.month}-${parts.day}`;
}

function startDay(competition) {
    return competition.start_date.slice(0, 10);
}

function isParticipantAccount() {
    return Boolean(currentUser.id && currentUser.id !== guestId);
}

function selectedCompetition() {
    return competitions.find(competition => competition.id === competitionSelect.value);
}

function competitionSelectionKey() {
    return `weight.selectedCompetition.${currentUser.id}`;
}

function participantName(competition, id) {
    return competition.expand?.participants?.find(user => user.id === id)?.username ??
        (id === currentUser.id ? currentUser.username : "Friend");
}

function matchAnyId(field, ids) {
    return ids.map(id => pocketBase.filter(`${field} = {:id}`, { id })).join(" || ");
}

function showNotice(element, message) {
    element.textContent = message;
    element.hidden = !message;
}

function displayStartDate(competition) {
    return competitionDateLabel.format(new Date(`${startDay(competition)}T00:00:00Z`));
}

function renderCompetitionOptions(selection = competitionSelect.value) {
    const options = [new Option("All Friends", "")];
    const duplicates = new Map();
    for (const competition of competitions) {
        const friends = competition.participants.filter(id => id !== currentUser.id);
        const title = competition.name || participantNames.format(friends.map(id => participantName(competition, id))) || "Competition";
        const label = `${title} · ${displayStartDate(competition)}`;
        const count = (duplicates.get(label) ?? 0) + 1;
        duplicates.set(label, count);
        options.push(new Option(count > 1 ? `${label} (${count})` : label, competition.id));
    }
    competitionSelect.replaceChildren(...options);
    if (competitions.some(competition => competition.id === selection)) competitionSelect.value = selection;
}

async function loadCompetitions(restoreSelection = false) {
    if (!isParticipantAccount()) return;
    const request = ++competitionsRequest;
    try {
        const records = await pocketBase.collection("competitions").getFullList({
            sort: "-start_date,created,id",
            expand: "participants",
            requestKey: null
        });
        if (request !== competitionsRequest) return;
        competitionListFailed = false;
        const previous = selectedCompetition();
        const selection = restoreSelection ? localStorage.getItem(competitionSelectionKey()) : competitionSelect.value;
        competitions = records;
        renderCompetitionOptions(selection);
        const current = selectedCompetition();
        if (selection && !current) localStorage.removeItem(competitionSelectionKey());
        const scopeChanged = previous?.id !== current?.id ||
            previous?.participants.join() !== current?.participants.join() ||
            previous?.start_date !== current?.start_date;
        if (!restoreSelection && scopeChanged) await changeCompetition();
        else renderCompetitionNotice();
    } catch (error) {
        if (request !== competitionsRequest) return;
        competitionListFailed = true;
        renderCompetitionNotice();
        console.error("Error loading competitions:", error);
    }
}

function selectedFriends() {
    return [...competitionFriends.querySelectorAll("input:checked")].map(input => input.value);
}

async function openCompetitionForm() {
    const friends = [...new Set(currentUser.friends ?? [])].filter(id => id !== currentUser.id && id !== guestId);
    competitionFriends.replaceChildren();
    competitionName.value = "";
    competitionStartDate.value = berlinDay(new Date());
    createCompetitionButton.disabled = true;
    showNotice(competitionFormNotice, friends.length ? "Loading friends…" : "No friends are available to compete with.");
    competitionDialog.showModal();
    if (!friends.length) return;

    try {
        const records = await pocketBase.collection("fat_users").getFullList({
            filter: matchAnyId("id", friends),
            sort: "username",
            fields: "id,username"
        });
        competitionFriends.replaceChildren(...records.map(friend => {
            const label = document.createElement("label");
            label.className = "competition-friend";
            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.value = friend.id;
            const name = document.createElement("span");
            name.textContent = friend.username;
            label.append(checkbox, name);
            return label;
        }));
        showNotice(competitionFormNotice, records.length ? "" : "No friends are available to compete with.");
    } catch (error) {
        if (error.isAbort) return;
        showNotice(competitionFormNotice, "Couldn’t load your friends. Reopen the form to try again.");
        console.error("Error loading friends:", error);
    }
}

async function createCompetition(event) {
    event.preventDefault();
    if (createCompetitionButton.disabled || !isParticipantAccount()) return;
    const friends = selectedFriends();
    if (!friends.length) return;
    createCompetitionButton.disabled = true;
    cancelCompetitionButton.disabled = true;
    showNotice(competitionFormNotice, "Creating competition…");
    let record;
    try {
        record = await pocketBase.collection("competitions").create({
            participants: [currentUser.id, ...friends],
            name: competitionName.value.trim(),
            start_date: `${competitionStartDate.value} 00:00:00.000Z`
        }, { expand: "participants" });
    } catch (error) {
        showNotice(competitionFormNotice, "Couldn’t create the competition. Check the start date and participants, then try again.");
        console.error("Error creating competition:", error);
        return;
    } finally {
        createCompetitionButton.disabled = !selectedFriends().length;
        cancelCompetitionButton.disabled = false;
    }
    competitions = [record, ...competitions.filter(competition => competition.id !== record.id)];
    renderCompetitionOptions(record.id);
    competitionDialog.close();
    await Promise.all([changeCompetition(), loadCompetitions()]);
}

async function changeCompetition() {
    if (isParticipantAccount()) localStorage.setItem(competitionSelectionKey(), competitionSelect.value);
    GLOBALWeightData = [];
    weightsNotice = "Loading weigh-ins…";
    updateCharts();
    await loadWeights();
}

function renderCompetitionNotice() {
    const competition = selectedCompetition();
    let message = weightsNotice;
    if (!message && !competition && competitionListFailed) {
        message = "Couldn’t load competitions. Reload the page to try again.";
    }
    if (!message && competition) {
        if (startDay(competition) > berlinDay(new Date())) {
            message = `This competition starts on ${displayStartDate(competition)}.`;
        } else {
            const logged = new Set(GLOBALWeightData.map(weight => weight.user));
            const waiting = competition.participants.filter(id => !logged.has(id));
            if (waiting.length) {
                const names = waiting.map(id => participantName(competition, id));
                message = `Waiting for ${participantNames.format(names)} to log a first weigh-in.`;
            }
        }
    }
    showNotice(competitionNotice, message);
}

function weighInDate(record, competition) {
    const timestamp = competition ? record.created : record.date || record.created;
    return new Date(timestamp.replace(" ", "T"));
}

async function loadWeights() {
    if (!currentUser.id) return;
    const request = ++weightsRequest;
    const competition = selectedCompetition();
    const participants = competition
        ? competition.participants
        : [...new Set([...(currentUser.friends ?? []), currentUser.id])];
    try {
        const weights = await pocketBase.collection("weights").getFullList({
            sort: "-created,-id",
            expand: "user",
            filter: matchAnyId("user", participants),
            requestKey: null
        });
        if (request !== weightsRequest) return;
        weightsNotice = "";
        GLOBALWeightData = weights.filter(weight => weight.expand?.user &&
            (!competition || berlinDay(weighInDate(weight, competition)) >= startDay(competition)));
        updateCharts();
    } catch (error) {
        if (request !== weightsRequest) return;
        weightsNotice = "Couldn’t load weigh-ins. Reload the page to try again.";
        renderCompetitionNotice();
        console.error("Error loading weights:", error);
    }
}

async function loadTracker() {
    newCompetitionButton.hidden = !isParticipantAccount();
    if (isParticipantAccount()) {
        await loadCompetitions(true);
        pocketBase.collection("competitions").subscribe("*", () => loadCompetitions()).catch(error => {
            console.error("Error subscribing to competitions:", error);
        });
    }
    await loadWeights();
    document.getElementById("competitionControls").hidden = false;
}

function groupWeights(weights) {
    const groups = new Map();
    for (const weight of weights) {
        const user = weight.expand.user;
        if (!groups.has(user.id)) groups.set(user.id, { user, records: [] });
        groups.get(user.id).records.push(weight);
    }
    return [...groups.values()].sort((a, b) =>
        Number(b.user.id === currentUser.id) - Number(a.user.id === currentUser.id));
}

function goalProgress(weight, baseline, goal) {
    return goal === baseline ? 0 : ((weight - baseline) / (goal - baseline)) * 100;
}

function renderRecordList(groups, competition) {
    const dateFormat = new Intl.DateTimeFormat("en-GB", {
        day: "2-digit",
        month: "long",
        timeZone: competition ? competitionTimeZone : undefined
    });
    recordList.innerHTML = groups.map(({ user, records }) => {
        const startingWeight = records[records.length - 1].weight;
        const currentWeight = records[0].weight;
        const weightLost = (startingWeight - currentWeight).toFixed(1);
        const progress = goalProgress(currentWeight, startingWeight, user.goal).toFixed(1);
        const height = user.height_cm;
        const bmi = height ? (currentWeight / (height / 100) ** 2).toFixed(1) : "—";
        const entries = records.map((record, index) => `
          <li class="weigh-in-row${index === 0 ? " latest-weigh-in" : ""}">
            <span>${dateFormat.format(weighInDate(record, competition))}</span>
            <span>${record.weight}kg</span>
          </li>`).join("");

        return `<article class="record-group">
  <h3>
    <progress class="max" value="${progress}" max="100" aria-hidden="true"></progress>
    <span class="record-title-name"></span>
  </h3>
  <div class="record-summary">
    <div>Goal: ${startingWeight} to ${user.goal}kg (Lose ${(startingWeight - user.goal).toFixed(1)}kg)</div>
    <div>Lost: ${weightLost}kg</div>
    <div>Left: ${(currentWeight - user.goal).toFixed(1)}kg</div>
    <div>BMI: ${bmi}kg/m² <a target="_blank" rel="noopener" style="text-decoration: underline;" href="https://www.calculator.net/bmi-calculator.html?cheightmeter=${height}&ckg=${currentWeight}&printit=0&ctype=metric&x=Calculate">More Info</a></div>
    <div>Height: ${height}cm</div>
    <div class="record-progress">${progress}%<progress value="${progress}" max="100" class="large"></progress></div>
  </div>
  <ul class="record-entries">
    ${entries}
  </ul>
</article>`;
    }).join("");
    recordList.querySelectorAll(".record-title-name").forEach((name, index) => {
        name.textContent = groups[index].user.username;
    });
}

function createDatasets(groups, mode, competition) {
    const colors = ["#0000ff", "#0964ed", "#ff0000", "#00ff00", "#00b350"];
    return groups.map(({ user, records }) => {
        const baseline = records[records.length - 1].weight;
        let hash = 0;
        for (const char of user.username) hash = (hash * 31 + char.charCodeAt(0)) | 0;

        const data = records.slice().reverse()
            .filter(record => showHiddenWeights || !record.hidden)
            .map(record => {
                let y = record.weight;
                if (mode === "Relative") y = record.weight - baseline;
                if (mode === "Progress") y = goalProgress(record.weight, baseline, user.goal);
                return { x: weighInDate(record, competition), y };
            })
            .sort((a, b) => a.x - b.x);

        return {
            participantId: user.id,
            label: user.username,
            data,
            borderColor: colors[Math.abs(hash) % colors.length],
            fill: false,
            hidden: GLOBALHiddenSeries.has(user.id)
        };
    });
}

function goalLines(groups, competition, mode) {
    const ownRecords = groups.find(group => group.user.id === currentUser.id)?.records;
    const records = ownRecords ?? (competition ? [] : GLOBALWeightData);
    if (!records.length) return {};

    const baseline = records[records.length - 1].weight;
    const goal = currentUser.goal || Math.min(...groups.map(({ user }) => user.goal || 0));
    const start = mode === "Absolute" ? baseline : 0;
    const target = mode === "Progress" ? 100 : mode === "Relative" ? goal - baseline : goal;
    return {
        lineStart: { type: "line", yMin: start, yMax: start, borderColor: "rgba(0,0,0,0.2)", borderWidth: 2, borderDash: [5, 5] },
        goalLine: { type: "line", yMin: target, yMax: target, borderColor: "rgba(0,0,0,0.8)", borderWidth: 2, borderDash: [5, 5] },
        box1: { type: "box", yMin: target - 5, yMax: target, backgroundColor: "rgba(0,0,0,0.25)" }
    };
}

function updateCharts() {
    const competition = selectedCompetition();
    const groups = groupWeights(GLOBALWeightData);
    renderRecordList(groups, competition);
    renderCompetitionNotice();

    const mode = GLOBALmode;
    const datasets = createDatasets(groups, mode, competition);
    const annotations = goalLines(groups, competition, mode);
    const xAxis = {
        type: "time",
        time: { unit: "day", displayFormats: { day: "dd MMM" }, tooltipFormat: "dd MMM yyyy" },
        ticks: { autoSkip: true, maxRotation: 0, minRotation: 0 }
    };
    const tooltip = { callbacks: {} };
    if (competition) {
        xAxis.ticks.callback = value => competitionTickLabel.format(value);
        tooltip.callbacks.title = items => competitionDateLabel.format(items[0].parsed.x);
    }
    const yAxis = {
        title: {
            display: true,
            text: mode === "Absolute" ? "Weight (kg)" : mode === "Relative" ? "Weight Change (kg)" : "Progress (%)"
        },
        reverse: mode === "Progress",
        grace: 5
    };

    if (chartInstance) {
        chartInstance.data.datasets = datasets;
        chartInstance.options.scales.x = xAxis;
        chartInstance.options.scales.y = yAxis;
        chartInstance.options.plugins.annotation.annotations = annotations;
        chartInstance.options.plugins.tooltip = tooltip;
        chartInstance.update();
        return;
    }

    chartInstance = new Chart(document.getElementById("ProgressGraph"), {
        type: "line",
        data: { datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 0 },
            scales: { x: xAxis, y: yAxis },
            plugins: {
                tooltip,
                legend: {
                    position: "top",
                    onClick(event, item, legend) {
                        const chart = legend.chart;
                        const { participantId } = chart.data.datasets[item.datasetIndex];
                        toggleHiddenParticipant(participantId);
                        chart.setDatasetVisibility(item.datasetIndex, !GLOBALHiddenSeries.has(participantId));
                        chart.update();
                    }
                },
                annotation: { annotations }
            }
        }
    });
}

// Update logWeight to use the authenticated user relationship
async function logWeight() {
    if (currentUser.id === guestId) {
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
        await loadWeights();
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
    pocketBase.collection("weights").subscribe("*", loadWeights).catch(error => {
        console.error("Error subscribing to weights:", error);
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
    competitionSelect.addEventListener("change", changeCompetition);
    newCompetitionButton.addEventListener("click", openCompetitionForm);
    competitionFriends.addEventListener("change", () => {
        if (!cancelCompetitionButton.disabled) createCompetitionButton.disabled = !selectedFriends().length;
    });
    competitionForm.addEventListener("submit", createCompetition);
    cancelCompetitionButton.addEventListener("click", () => competitionDialog.close());
    competitionDialog.addEventListener("cancel", event => {
        if (cancelCompetitionButton.disabled) event.preventDefault();
    });
    renderSignInForm();
    ///////////////////////////////

    setSigninDialogMode("loading");
    // Try to restore session, otherwise show sign-in dialog
    await tryRestoreAuth();


}
init();
