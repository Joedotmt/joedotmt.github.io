// DOM Elements
const logweightbutton = document.getElementById("logweightbutton");
const signoutButton = document.getElementById("signinbutton");
const settingsButton = document.getElementById("settingsButton");
const settingsDialog = document.getElementById("settingsDialog");
const closeSettingsButton = document.getElementById("closeSettingsButton");
const sid_progress = document.getElementById("sid_progress");
const sid_words = document.getElementById("sid_words");
const welcomeText = document.getElementById("welcomeText");
const recordList = document.getElementById("recordList");
const submitButton = document.getElementById("submitButton");
const cancelWeightButton = document.getElementById("cancelWeightButton");
const weightForm = document.getElementById("weightForm");
const weightFormDialog = document.getElementById("weightFormDialog");
const weightInput = document.getElementById("weightInput");
const weightFormNotice = document.getElementById("weightFormNotice");
const weightSaveToast = document.getElementById("weightSaveToast");
const signindialog = document.getElementById("signindialog");
const signinNotice = document.getElementById("signinNotice");
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
const chartModeKey = "weight.chartMode";
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
const berlinTime = new Intl.DateTimeFormat("en-GB", {
    timeZone: competitionTimeZone,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
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
let chartReady = false;
let currentUser = {};
let GLOBALWeightData = [];
let showHiddenWeights = true;
let competitions = [];
let preferredCompetitionId = "";
let competitionsRequest = 0;
let weightsRequest = 0;
let competitionListFailed = false;
let competitionScopeReady = false;
let weightsNotice = "";
let weightSaveToastTimeout;

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

async function tryRestoreAuth() {
    let user;
    try {
        if (pocketBase.authStore.token) {
            const session = await pocketBase.collection("fat_users").authRefresh();
            user = session.record;
            if (!user?.id) throw new Error("PocketBase did not return an authenticated account.");
        }
    } catch (error) {
        if (error.status === 401 || error.status === 403) {
            pocketBase.authStore.clear();
            setSigninDialogMode("signin", "Please sign in again.");
        } else {
            setSigninDialogMode("signin", "Couldn’t reconnect. Reload the page to retry your saved session.");
        }
        return;
    }
    if (user?.id) startTracker(user);
    else setSigninDialogMode("signin");
}

async function signIn(username, password) {
    if (!username || !password || sid_progress.style.display === "block") return;
    setSigninDialogMode("loading");
    const started = performance.now();
    let user;
    try {
        const session = await pocketBase.collection("fat_users").authWithPassword(username, password);
        user = session.record;
        if (!user?.id) throw new Error("PocketBase did not return an authenticated account.");
    } catch (error) {
        console.error("Error during sign in:", error);
        const credentialError = username !== "guest" && [400, 401, 403].includes(error.status);
        setSigninDialogMode("signin", credentialError
            ? "Couldn’t sign in. Check your username or password and try again."
            : "Couldn’t sign in. Try again.");
        return;
    }
    const remaining = 600 - (performance.now() - started);
    if (remaining > 0) await new Promise(resolve => setTimeout(resolve, remaining));
    startTracker(user);
}

function startTracker(user) {
    currentUser = user;
    updateWelcomeTextAndWords();
    setSigninDialogMode("closed");
    logweightbutton.disabled = false;
    signoutButton.disabled = false;
    void loadTracker();
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

function competitionStart(competition) {
    const midnightUtc = new Date(`${startDay(competition)}T00:00:00Z`);
    // Berlin still uses the local midnight offset at 00:00 UTC on clock-change days.
    const [hours, minutes, seconds] = berlinTime.format(midnightUtc).split(":").map(Number);
    return new Date(midnightUtc.getTime() - (hours * 3600 + minutes * 60 + seconds) * 1000);
}

function isParticipantAccount() {
    return Boolean(currentUser.id && currentUser.id !== guestId);
}

function selectedCompetition() {
    return competitions.find(competition => competition.id === preferredCompetitionId);
}

function competitionSelectionKey() {
    return `weight.selectedCompetition.${currentUser.id}`;
}

function rememberCompetition(id) {
    preferredCompetitionId = id;
    if (isParticipantAccount()) localStorage.setItem(competitionSelectionKey(), id);
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

function saveResultIsUncertain(error) {
    return !error.status || error.status === 408 || error.status >= 500;
}

function displayStartDate(competition) {
    return competitionDateLabel.format(new Date(`${startDay(competition)}T00:00:00Z`));
}

function renderCompetitionOptions() {
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
    competitionSelect.value = selectedCompetition()?.id ?? "";
}

async function loadCompetitions() {
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
        competitions = records;
        renderCompetitionOptions();
        const current = selectedCompetition();
        const scopeChanged = previous?.id !== current?.id ||
            previous?.participants.join() !== current?.participants.join() ||
            previous?.start_date !== current?.start_date;
        if (competitionScopeReady && scopeChanged) await refreshCompetitionWeights();
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
        if (!record?.id || !Array.isArray(record.participants) || !record.start_date) {
            throw new Error("PocketBase did not return a saved competition.");
        }
    } catch (error) {
        showNotice(competitionFormNotice, saveResultIsUncertain(error)
            ? "Couldn’t confirm the competition was created. Check the competition list before trying again."
            : "Couldn’t create the competition. Check the start date and participants, then try again.");
        console.error("Error creating competition:", error);
        return;
    } finally {
        createCompetitionButton.disabled = !selectedFriends().length;
        cancelCompetitionButton.disabled = false;
    }
    competitions = [record, ...competitions.filter(competition => competition.id !== record.id)];
    rememberCompetition(record.id);
    renderCompetitionOptions();
    competitionDialog.close();
    await Promise.all([refreshCompetitionWeights(), loadCompetitions()]);
}

async function refreshCompetitionWeights() {
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
    if (!competition && record.date) {
        const date = new Date(record.date.replace(" ", "T"));
        if (Number.isFinite(date.getTime())) return date;
    }
    return new Date(record.created?.replace(" ", "T"));
}

async function loadWeights() {
    if (!competitionScopeReady) return;
    const request = ++weightsRequest;
    const competition = selectedCompetition();
    const participants = competition
        ? competition.participants
        : [...new Set([...(currentUser.friends ?? []), currentUser.id])];
    try {
        const participantFilter = matchAnyId("user", participants);
        const filter = competition
            ? pocketBase.filter(`(${participantFilter}) && created >= {:start}`, { start: competitionStart(competition) })
            : participantFilter;
        const weights = participants.length ? await pocketBase.collection("weights").getFullList({
            sort: "-created,-id",
            expand: "user",
            filter,
            requestKey: null
        }) : [];
        if (request !== weightsRequest) return;
        weightsNotice = "";
        GLOBALWeightData = weights
            .filter(weight => weight.expand?.user)
            .map(weight => ({ ...weight, recordedAt: weighInDate(weight, competition) }))
            .filter(weight => Number.isFinite(weight.recordedAt.getTime()))
            .sort((a, b) => b.recordedAt - a.recordedAt);
        updateCharts();
    } catch (error) {
        if (request !== weightsRequest) return;
        weightsNotice = "Couldn’t load weigh-ins. Reload the page to try again.";
        renderCompetitionNotice();
        console.error("Error loading weights:", error);
    }
}

async function loadTracker() {
    void loadChartScripts();
    newCompetitionButton.hidden = !isParticipantAccount();
    if (isParticipantAccount()) {
        preferredCompetitionId = localStorage.getItem(competitionSelectionKey()) ?? "";
        await loadCompetitions();
        if (preferredCompetitionId && competitionListFailed) return;
        pocketBase.collection("competitions").subscribe("*", () => loadCompetitions()).catch(error => {
            console.error("Error subscribing to competitions:", error);
        });
    }
    competitionScopeReady = true;
    document.getElementById("competitionControls").hidden = false;
    pocketBase.collection("weights").subscribe("*", loadWeights).catch(error => {
        console.error("Error subscribing to weights:", error);
    });
    weightsNotice = "Loading weigh-ins…";
    renderCompetitionNotice();
    await loadWeights();
}

async function loadChartScripts() {
    try {
        const urls = [
            "https://cdn.jsdelivr.net/npm/chart.js@4.6.2",
            "https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3.0.0",
            "https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation@3.1.0"
        ];
        await Promise.all(urls.map(src => new Promise((resolve, reject) => {
            const script = document.createElement("script");
            // Download together, then execute in dependency order.
            script.async = false;
            script.crossOrigin = "anonymous";
            script.src = src;
            script.onload = resolve;
            script.onerror = () => reject(new Error(`Couldn’t load ${src}`));
            document.head.append(script);
        })));
        chartReady = true;
        updateCharts();
    } catch (error) {
        chartReady = false;
        showNotice(document.getElementById("chartNotice"), "Couldn’t load the graph. Reload the page to try again.");
        console.error("Error loading the graph:", error);
    }
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
    const timeZone = competition ? competitionTimeZone : undefined;
    const dateOptions = {
        day: "2-digit",
        month: "long",
        timeZone
    };
    const dateFormat = new Intl.DateTimeFormat("en-GB", dateOptions);
    const dateWithYearFormat = new Intl.DateTimeFormat("en-GB", { ...dateOptions, year: "numeric" });
    const yearFormat = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric" });
    const currentYear = yearFormat.format(new Date());
    recordList.innerHTML = groups.map(({ user, records }) => {
        const startingWeight = records[records.length - 1].weight;
        const currentWeight = records[0].weight;
        const weightLost = (startingWeight - currentWeight).toFixed(1);
        const progress = goalProgress(currentWeight, startingWeight, user.goal).toFixed(1);
        const height = user.height_cm;
        const bmi = height ? (currentWeight / (height / 100) ** 2).toFixed(1) : "—";
        const entries = records.map((record, index) => {
            const date = record.recordedAt;
            const format = yearFormat.format(date) === currentYear ? dateFormat : dateWithYearFormat;
            return `
          <li class="weigh-in-row${index === 0 ? " latest-weigh-in" : ""}">
            <span>${format.format(date)}</span>
            <span>${record.weight}kg</span>
          </li>`;
        }).join("");

        return `<article class="record-group">
  <h3>
    <progress class="max" value="${progress}" max="100" aria-hidden="true"></progress>
    <span class="record-title-name"></span>
    <span class="record-title-weight">${currentWeight} kg</span>
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

function createDatasets(groups, mode) {
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
                return { x: record.recordedAt, y };
            });

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
    const beyondGoal = mode === "Progress" ? { yMin: target } : { yMax: target };
    return {
        lineStart: { type: "line", yMin: start, yMax: start, borderColor: "rgba(0,0,0,0.2)", borderWidth: 2 },
        goalLine: { type: "line", yMin: target, yMax: target, borderColor: "rgba(0,0,0,0.8)", borderWidth: 2, borderDash: [5, 5] },
        goalArea: {
            type: "box",
            ...beyondGoal,
            adjustScaleRange: false,
            drawTime: "beforeDatasetsDraw",
            borderWidth: 0,
            backgroundColor: "rgba(0,0,0,0.25)"
        }
    };
}

function updateCharts() {
    const competition = selectedCompetition();
    const groups = groupWeights(GLOBALWeightData);
    renderRecordList(groups, competition);
    renderCompetitionNotice();
    if (!chartReady) return;

    const mode = GLOBALmode;
    const datasets = createDatasets(groups, mode);
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

function openWeightForm() {
    clearTimeout(weightSaveToastTimeout);
    weightSaveToast.textContent = "";
    weightFormNotice.textContent = "";
    weightFormDialog.showModal();
    weightInput.focus();
}

async function logWeight(event) {
    event.preventDefault();
    if (submitButton.disabled) return;
    if (!isParticipantAccount()) {
        weightFormNotice.textContent = "Sign in with a participant account to log a weigh-in.";
        return;
    }

    const weight = weightInput.valueAsNumber;
    if (!Number.isFinite(weight) || weight <= 0) {
        weightFormNotice.textContent = "Enter a weight greater than 0 kg.";
        weightInput.focus();
        return;
    }
    submitButton.disabled = true;
    cancelWeightButton.disabled = true;
    weightInput.readOnly = true;
    weightFormNotice.textContent = "Saving…";

    let savedWeight;
    try {
        savedWeight = await pocketBase.collection("weights").create({
            weight,
            user: currentUser.id
        });
        if (!savedWeight?.id) throw new Error("PocketBase did not return a saved weigh-in.");
    } catch (error) {
        weightFormNotice.textContent = saveResultIsUncertain(error)
            ? "Couldn’t confirm the save. Check your weigh-ins before trying again."
            : "Couldn’t save the weigh-in. Check the value and try again.";
        console.error("Error logging weight:", error);
        return;
    } finally {
        submitButton.disabled = false;
        cancelWeightButton.disabled = false;
        weightInput.readOnly = false;
    }

    weightForm.reset();
    weightFormDialog.close();
    weightSaveToast.textContent = "Weigh-in saved.";
    weightSaveToastTimeout = setTimeout(() => {
        weightSaveToast.textContent = "";
    }, 4000);
    void loadWeights();
}

function setSigninDialogMode(mode, message = "") {
    showNotice(signinNotice, message);
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
        sid_progress.style.display = "none";
        sid_words.style.display = "block";
        signindialog.showModal();
    } else if (mode === "closed") {
        sid_progress.style.display = "none";
        sid_words.style.display = "none";
        signindialog.close();
    }
}

async function setupAppCache() {
    if (!("serviceWorker" in navigator) || location.protocol === "file:") return;

    const updateButton = document.getElementById("appUpdateButton");
    let currentRelease = document.documentElement.dataset.appRelease;
    navigator.serviceWorker.addEventListener("message", ({ data }) => {
        if (data?.type !== "WEIGHT_APP_RELEASE" || !data.release) return;
        currentRelease ??= data.release;
        updateButton.hidden = data.release === currentRelease;
    });
    updateButton.addEventListener("click", () => {
        if (!document.querySelector("dialog[open]")) location.reload();
    });

    try {
        await navigator.serviceWorker.register("./sw.js");
        const registration = await navigator.serviceWorker.ready;
        const checkForUpdate = (refresh = true) => {
            registration.active?.postMessage({ type: "CHECK_WEIGHT_APP_RELEASE", refresh });
        };
        checkForUpdate(Boolean(currentRelease));
        document.addEventListener("visibilitychange", () => {
            if (document.visibilityState === "visible") checkForUpdate();
        });
        window.addEventListener("online", () => checkForUpdate());
    } catch (error) {
        console.warn("Couldn’t set up the app cache:", error);
    }
}

function init() {
    const tabs = [...GraphTabs.querySelectorAll("button")];
    try {
        const savedMode = localStorage.getItem(chartModeKey);
        if (tabs.some(tab => tab.value === savedMode)) GLOBALmode = savedMode;
    } catch {
        // The default view is available when browser storage is blocked.
    }
    tabs.forEach(tab => {
        tab.setAttribute("aria-pressed", String(tab.value === GLOBALmode));
        tab.addEventListener("click", () => {
            if (GLOBALmode === tab.value) return;
            GraphTabs.querySelector('[aria-pressed="true"]').setAttribute("aria-pressed", "false");
            tab.setAttribute("aria-pressed", "true");
            GLOBALmode = tab.value;
            try {
                localStorage.setItem(chartModeKey, GLOBALmode);
            } catch {
                // The view can still be changed for this visit.
            }
            updateCharts();
        });
    });
    logweightbutton.addEventListener("click", openWeightForm);
    weightForm.addEventListener("submit", logWeight);
    cancelWeightButton.addEventListener("click", () => weightFormDialog.close());
    weightFormDialog.addEventListener("cancel", event => {
        if (submitButton.disabled) event.preventDefault();
    });
    competitionSelect.addEventListener("change", () => {
        rememberCompetition(competitionSelect.value);
        void refreshCompetitionWeights();
    });
    settingsButton.addEventListener("click", () => settingsDialog.showModal());
    closeSettingsButton.addEventListener("click", () => settingsDialog.close());
    newCompetitionButton.addEventListener("click", openCompetitionForm);
    competitionFriends.addEventListener("change", () => {
        if (!cancelCompetitionButton.disabled) createCompetitionButton.disabled = !selectedFriends().length;
    });
    competitionForm.addEventListener("submit", createCompetition);
    cancelCompetitionButton.addEventListener("click", () => competitionDialog.close());
    competitionDialog.addEventListener("cancel", event => {
        if (cancelCompetitionButton.disabled) event.preventDefault();
    });
    signindialog.addEventListener("cancel", event => event.preventDefault());
    renderSignInForm();
    void tryRestoreAuth();
    void setupAppCache();
}
init();
