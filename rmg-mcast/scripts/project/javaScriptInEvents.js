

const scriptsInEvents = {

	async Main_Event1_Act24(runtime, localVars)
	{
		fetchGoldenBallData(runtime)
	},

	async Main_Event41_Act1(runtime, localVars)
	{
		collectCoin(runtime.objects.Coin.getFirstPickedInstance());
		updateCoinUI(runtime);
	},

	async Main_Event41_Act2(runtime, localVars)
	{
		updateCoinUI(runtime);
	},

	async Main_Event42_Act1(runtime, localVars)
	{
		initCoins(runtime);
		
	},

	async Main_Event42_Act2(runtime, localVars)
	{
		updateCoinUI(runtime);
	},

	async Victory_Event8_Act2(runtime, localVars)
	{
		setGoldenBall("true")
	},

	async Instruct_Event5_Act2(runtime, localVars)
	{
		resetCoinSave()
	},

	async Instruct_Event5_Act3(runtime, localVars)
	{
		setGoldenBall("false")
	}
};

globalThis.C3.JavaScriptInEvents = scriptsInEvents;
