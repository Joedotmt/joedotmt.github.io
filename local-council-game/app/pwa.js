export async function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;

  try {
    await navigator.serviceWorker.register("./service-worker.js", {
      scope: "./",
      updateViaCache: "none",
    });
  } catch (error) {
    // The game remains fully usable online when registration is unavailable.
    console.warn("Service worker registration failed:", error);
  }
}
