var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var _a;
var _this = this;
var logweightbutton = document.getElementById("logweightbutton");
var sid_progress = document.getElementById("sid_progress");
var sid_words = document.getElementById("sid_words");
var welcomeText = document.getElementById("welcomeText");
var recordList = document.getElementById("recordList");
var submitButton = document.getElementById("weightFormDialog");
var weightFormDialog = document.getElementById("weightFormDialog");
var signindialog = document.getElementById("signindialog");
var GraphTabs = document.getElementById("GraphTabs");
var GLOBALmode = "Absolute";
GraphTabs.querySelectorAll("a").forEach(function (e) {
    e.addEventListener("click", function () { return __awaiter(_this, void 0, void 0, function () {
        return __generator(this, function (_a) {
            switch (_a.label) {
                case 0:
                    GLOBALmode = e.innerText;
                    return [4 /*yield*/, updateCharts()];
                case 1:
                    _a.sent();
                    return [2 /*return*/];
            }
        });
    }); });
});
var pocketBase = new PocketBase("https://petition.pockethost.io/");
var currentParticipantId = (_a = localStorage.getItem("participant")) !== null && _a !== void 0 ? _a : "";
var chartInstance = null;
var getParticipant = function (id) { return __awaiter(_this, void 0, void 0, function () {
    var participantId;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                participantId = id || currentParticipantId;
                if (!participantId)
                    return [2 /*return*/, null];
                localStorage.setItem("participant", participantId);
                return [4 /*yield*/, pocketBase.collection("participants").getOne(participantId)
                        .catch(function (e) { return (console.error("Error fetching participant:", e), null); })];
            case 1: return [2 /*return*/, _a.sent()];
        }
    });
}); };
var refreshParticipant = function (id) { return __awaiter(_this, void 0, void 0, function () {
    var participant;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                sid_progress.style.display = "block";
                sid_words.style.display = "none";
                return [4 /*yield*/, getParticipant(id)];
            case 1:
                participant = _a.sent();
                if (!participant)
                    return [2 /*return*/];
                welcomeText.innerText = "Hello ".concat(participant.name);
                return [4 /*yield*/, updateCharts()];
            case 2:
                _a.sent();
                logweightbutton.style.display = window.location.hash === "#admin"
                    ? ""
                    : "none";
                signindialog.close();
                setTimeout(function () {
                    sid_words.style.display = "";
                    sid_progress.style.display = "";
                }, 500);
                return [2 /*return*/];
        }
    });
}); };
var loadWeights = function () { return __awaiter(_this, void 0, void 0, function () {
    return __generator(this, function (_a) {
        return [2 /*return*/, pocketBase.collection("weights").getFullList({
                sort: "-created",
                expand: "participant",
            })
                .catch(function (e) { return (console.error("Error loading weights:", e), []); })];
    });
}); };
var groupWeights = function (weights) {
    return weights.reduce(function (accumulator, element) {
        var _a;
        var _b;
        ((_a = accumulator[_b = element.expand.participant.name]) !== null && _a !== void 0 ? _a : (accumulator[_b] = [])).push(element);
        return accumulator;
    }, {});
};
var createDatasets = function (groupedWeights, mode) {
    return Object.entries(groupedWeights).map(function (_a, i) {
        var name = _a[0], elements = _a[1];
        var startWeight = elements[elements.length - 1].weight;
        return {
            label: name,
            data: elements.sort(function (a, b) {
                return Date.parse(a.updated) - Date.parse(b.updated);
            })
                .map(function (x) { return ({
                x: new Date(x.updated),
                y: mode === "Relative"
                    ? x.weight - startWeight
                    : mode === "Progress"
                        ? ((x.weight - startWeight) /
                            (elements[0].expand.participant.goal -
                                startWeight)) * 100
                        : x.weight,
            }); }),
            borderColor: ["#5297ff", "#52ff5a", "green", "orange", "purple"][i % 5],
            fill: false,
        };
    });
};
var renderRecordList = function (groupedWeights) {
    recordList.innerHTML = Object.entries(groupedWeights).map(function (_a) {
        var name = _a[0], elements = _a[1];
        var weightLost = (elements[0].weight - elements[elements.length - 1].weight)
            .toFixed(1);
        return "<h3 style=\"margin:0em 1rem; border-bottom: 1px solid black;\">".concat(name, "</h3>\n        <ul class=\"list border\">\n            <li class=\"ripple\">Total weight lost: ").concat(weightLost, "kg</li>\n            ").concat(elements.map(function (x, i) {
            return "<li class=\"ripple\" style=\"".concat(i ? "" : "background-color: var(--inverse-primary);", "\">\n                    <div>").concat(new Date(x.updated).toLocaleDateString("en-GB", {
                day: "2-digit",
                month: "long",
            }), "</div>\n                    ").concat(x.weight, "kg\n                </li>");
        }).join(""), "\n        </ul>");
    }).join("");
};
var updateCharts = function () { return __awaiter(_this, void 0, void 0, function () {
    var weights, grouped, participantWeights, start, goalLineValue, lineStartValue, participantGoal, startWeight, ctx, datasets, highestValue, yAxisReverse, margin;
    var _a;
    return __generator(this, function (_b) {
        switch (_b.label) {
            case 0: return [4 /*yield*/, loadWeights()];
            case 1:
                weights = _b.sent();
                grouped = groupWeights(weights);
                renderRecordList(grouped);
                participantWeights = currentParticipantId
                    ? weights.filter(function (w) {
                        return w.expand.participant.id === currentParticipantId;
                    })
                    : [];
                start = ((_a = participantWeights[participantWeights.length - 1]) === null || _a === void 0 ? void 0 : _a.weight) ||
                    0;
                goalLineValue = 0;
                lineStartValue = start;
                if (currentParticipantId && participantWeights.length > 0) {
                    participantGoal = participantWeights[0].expand.participant.goal;
                    startWeight = participantWeights[participantWeights.length - 1].weight;
                    if (GLOBALmode === "Absolute") {
                        goalLineValue = participantGoal;
                        lineStartValue = startWeight;
                    }
                    else if (GLOBALmode === "Relative") {
                        goalLineValue = -(startWeight - participantGoal);
                        lineStartValue = 0;
                    }
                    else if (GLOBALmode === "Progress") {
                        goalLineValue = 100;
                        lineStartValue = 0;
                    }
                }
                ctx = document.getElementById("ProgressGraph")
                    .getContext("2d");
                datasets = createDatasets(grouped, GLOBALmode);
                yAxisReverse = GLOBALmode === "Progress";
                if (yAxisReverse) {
                    highestValue = Math.min.apply(Math, datasets.flatMap(function (dataset) {
                        return dataset.data.map(function (point) { return point.y; });
                    }));
                }
                else {
                    highestValue = Math.max.apply(Math, datasets.flatMap(function (dataset) {
                        return dataset.data.map(function (point) { return point.y; });
                    }));
                }
                margin = 5;
                if (chartInstance) {
                    chartInstance.data.datasets = datasets;
                    if (chartInstance.options.plugins &&
                        chartInstance.options.plugins.annotation &&
                        chartInstance.options.plugins.annotation.annotations) {
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
                    }
                    else {
                        chartInstance.options.scales.y.max = highestValue + margin;
                        chartInstance.options.scales.y.min = goalLineValue - margin;
                    }
                    chartInstance.options.scales.y.reverse = yAxisReverse;
                    chartInstance.update();
                }
                else {
                    chartInstance = new Chart(ctx, {
                        type: "line",
                        data: { datasets: datasets },
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
                return [2 /*return*/];
        }
    });
}); };
var logWeight = function () { return __awaiter(_this, void 0, void 0, function () {
    var weight;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                if (window.location.hash !== "#admin") {
                    console.error("Unauthorized: Only admin can log weights.");
                    return [2 /*return*/];
                }
                weightFormDialog.close();
                weight = +document.getElementById("weightInput")
                    .value;
                if (!currentParticipantId || isNaN(weight))
                    return [2 /*return*/];
                return [4 /*yield*/, pocketBase.collection("weights").create({
                        weight: weight,
                        participant: currentParticipantId,
                    })
                        .catch(function (e) { return console.error("Error logging weight:", e); })];
            case 1:
                _a.sent();
                document.getElementById("weightInput").value = "";
                return [4 /*yield*/, updateCharts()];
            case 2:
                _a.sent();
                return [2 /*return*/];
        }
    });
}); };
// New function: Load all participants from the collection
var loadParticipants = function () { return __awaiter(_this, void 0, void 0, function () {
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, pocketBase.collection("participants").getFullList()
                    .catch(function (e) {
                    console.error("Error loading participants:", e);
                    return [];
                })];
            case 1: return [2 /*return*/, _a.sent()];
        }
    });
}); };
// New function: Render sign‑in buttons dynamically
var renderSignInButtons = function () { return __awaiter(_this, void 0, void 0, function () {
    var participants, container;
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0: return [4 /*yield*/, loadParticipants()];
            case 1:
                participants = _a.sent();
                container = document.getElementById("participantButtons");
                if (container) {
                    container.innerHTML = participants.map(function (participant) {
                        return "<button onclick=\"refreshParticipant('".concat(participant.id, "')\">").concat(participant.name, "</button>");
                    }).join("");
                }
                return [2 /*return*/];
        }
    });
}); };
var init = function () { return __awaiter(_this, void 0, void 0, function () {
    return __generator(this, function (_a) {
        switch (_a.label) {
            case 0:
                if (!currentParticipantId) return [3 /*break*/, 2];
                logweightbutton.style.display = window.location.hash === "#admin"
                    ? ""
                    : "none";
                return [4 /*yield*/, refreshParticipant()];
            case 1:
                _a.sent();
                return [3 /*break*/, 5];
            case 2:
                signindialog.showModal();
                return [4 /*yield*/, renderSignInButtons()];
            case 3:
                _a.sent();
                return [4 /*yield*/, updateCharts()];
            case 4:
                _a.sent();
                _a.label = 5;
            case 5:
                pocketBase.collection("weights").subscribe("*", function () { return updateCharts(); });
                submitButton.addEventListener("pointerup", logWeight);
                return [2 /*return*/];
        }
    });
}); };
init();
