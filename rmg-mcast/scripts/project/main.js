
// Import any other script files here, e.g.:
// import * as myModule from "./mymodule.js";

runOnStartup(async runtime => {
	// Code to run on the loading screen.
	// Note layouts, objects etc. are not yet available.

	runtime.addEventListener("beforeprojectstart", () => OnBeforeProjectStart(runtime));
});

async function OnBeforeProjectStart(runtime) {
	// Code to run just before 'On start of layout' on
	// the first layout. Loading has finished and initial
	// instances are created and available to use here.

	runtime.addEventListener("tick", () => Tick(runtime));
}

function Tick(runtime) {
	// Code to run every tick
}

// joe code
// I HATE CONSTRUCT!!!!!!!
// UGH FINALLY SOME REAL CODE
const KEYNAME = "collected_coins";

globalThis.initCoins = function (runtime) {
	const savedData = localStorage.getItem(KEYNAME);
	const collectedIDs = savedData ? JSON.parse(savedData) : [];

	const coins = runtime.objects.Coin.getAllInstances();

	for (const coin of coins) {
		// if coin's id is in list, destroy it
		if (collectedIDs.includes(coin.instVars.id)) {
			coin.destroy();
		}
	}
}

globalThis.collectCoin = function (coinInstance) {
	const coinID = coinInstance.instVars.id;
	const savedData = localStorage.getItem(KEYNAME);
	let collectedIDs = savedData ? JSON.parse(savedData) : [];

	// add if not alr there
	if (!collectedIDs.includes(coinID)) {
		collectedIDs.push(coinID);
		localStorage.setItem(KEYNAME, JSON.stringify(collectedIDs));
	}
}

globalThis.resetCoinSave = function () {
	localStorage.removeItem(KEYNAME);
}

globalThis.updateCoinUI = function (runtime) {
	const savedData = localStorage.getItem(KEYNAME);
	const collectedIDs = savedData ? JSON.parse(savedData) : [];

	const textObjs = runtime.objects.CoinText.getAllInstances();

	for (const text of textObjs) {
		text.text = collectedIDs.length + "/5";
	}

}

globalThis.fetchGoldenBallData = function (runtime) {
	const isGoldenBall = localStorage.getItem("golden_ball");
	runtime.globalVars.is_golden_ball = (isGoldenBall == "true");
}

globalThis.setGoldenBall = function (val) {
	localStorage.setItem("golden_ball", val);
}