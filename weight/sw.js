const scope = new URL(self.registration.scope);
const cacheName = `weight-app:${scope.pathname}`;
const appFiles = ["index.html", "app.js", "styles.css", "favicon.ico"];
const shellURL = new URL(appFiles[0], scope);
const appFileURLs = new Set(appFiles.slice(1).map(file => new URL(file, scope).href));
const coreDependencies = [
    "https://cdnjs.cloudflare.com/ajax/libs/pocketbase/0.25.0/pocketbase.umd.js",
    "https://cdn.jsdelivr.net/npm/beercss@3.9.7/dist/cdn/beer.min.css",
    "https://cdn.jsdelivr.net/npm/beercss@3.9.7/dist/cdn/beer.min.js",
    "https://cdn.jsdelivr.net/npm/material-dynamic-colors@1.1.2/dist/cdn/material-dynamic-colors.min.js"
];
const dependencies = new Set([
    ...coreDependencies,
    "https://cdn.jsdelivr.net/npm/chart.js@4.6.2",
    "https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3.0.0",
    "https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation@3.1.0"
]);
let updateCheck;

function cachedResponse(request) {
    return caches.match(request, { cacheName }).catch(() => undefined);
}

async function cacheDependency(request) {
    const cached = await cachedResponse(request);
    if (cached) return cached;

    const response = await fetch(request);
    if (response.ok) {
        await caches.open(cacheName)
            .then(cache => cache.put(request, response.clone()))
            .catch(() => {});
    }
    return response;
}

function releaseAssetURL(file, release) {
    return `${file}?app-release=${release}`;
}

async function digest(data) {
    const hash = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("");
}

async function revalidate(file, cached) {
    const headers = new Headers();
    const etag = cached?.headers.get("ETag");
    const modified = cached?.headers.get("Last-Modified");
    if (etag) headers.set("If-None-Match", etag);
    else if (modified) headers.set("If-Modified-Since", modified);

    const response = await fetch(new URL(file, scope), { headers, cache: "no-store" });
    if (response.status === 304 && cached) return cached;
    if (!response.ok) throw new Error(`Couldn’t load ${file}`);
    return response;
}

async function cacheAppRelease() {
    const cache = await caches.open(cacheName);
    const previous = (await cache.match(shellURL.href))?.headers.get("X-Weight-Release");
    const previousFiles = previous ? await Promise.all(appFiles.map(file =>
        cache.match(new URL(releaseAssetURL(file, previous), scope).href))) : [];
    const responses = await Promise.all(appFiles.map((file, index) => revalidate(file, previousFiles[index])));
    if (responses.every((response, index) => response === previousFiles[index])) return;

    const [page, script, stylesheet] = responses;
    if ([script, stylesheet].some(asset => asset.headers.get("Content-Type")?.startsWith("text/html"))) {
        throw new Error("An app file was replaced by an HTML response.");
    }
    const hashes = await Promise.all(responses.map(async response => digest(await response.clone().arrayBuffer())));
    const release = await digest(new TextEncoder().encode(hashes.join("")));
    const newPage = release !== previous ? page.clone() : null;
    const html = newPage && (await newPage.text())
        .replace(/<html\b/i, `<html data-app-release="${release}"`)
        .replace(/\b(src|href)=(['"])(?:\.\/)?(app\.js|styles\.css|favicon\.ico)(?:\?[^'"]*)?\2/g,
            (_, attribute, quote, file) => `${attribute}=${quote}${releaseAssetURL(file, release)}${quote}`);
    if (newPage && !["app.js", "styles.css"].every(file => html.includes(releaseAssetURL(file, release)))) {
        throw new Error("The entry page is missing its app files.");
    }
    await Promise.all(appFiles.map((file, index) => {
        if (newPage || responses[index] !== previousFiles[index]) {
            return cache.put(new URL(releaseAssetURL(file, release), scope).href, responses[index]);
        }
    }));
    if (!newPage) return;

    // Publish the entry page only after every file it points to is cached.
    const headers = new Headers(newPage.headers);
    headers.delete("Content-Encoding");
    headers.delete("Content-Length");
    headers.set("X-Weight-Release", release);
    await cache.put(shellURL.href, new Response(html, { headers }));

    const entries = await cache.keys();
    await Promise.all(entries.map(entry => {
        const url = new URL(entry.url);
        const assetRelease = url.searchParams.get("app-release");
        if (assetRelease && assetRelease !== release && assetRelease !== previous) return cache.delete(entry);
    }));
}

function checkForUpdate() {
    updateCheck ??= cacheAppRelease().finally(() => { updateCheck = undefined; });
    return updateCheck;
}

self.addEventListener("install", event => {
    event.waitUntil((async () => {
        if (await cachedResponse(shellURL.href)) return;
        await Promise.all([
            checkForUpdate(),
            Promise.allSettled(coreDependencies.map(url =>
                cacheDependency(new Request(url, { mode: "cors", cache: "force-cache" }))))
        ]);
    })());
});

self.addEventListener("activate", event => {
    event.waitUntil(clients.claim());
});

self.addEventListener("fetch", event => {
    const { request } = event;
    if (request.method !== "GET") return;
    const url = new URL(request.url);
    if (dependencies.has(url.href)) {
        event.respondWith(cacheDependency(request));
        return;
    }
    const isShell = request.mode === "navigate" && url.origin === scope.origin &&
        (url.pathname === scope.pathname || url.pathname === shellURL.pathname);
    const isReleaseAsset = url.searchParams.has("app-release") &&
        appFileURLs.has(new URL(url.pathname, url.origin).href);
    if (isShell || isReleaseAsset) {
        const key = isShell ? shellURL.href : request;
        event.respondWith(cachedResponse(key).then(response => response ?? fetch(request)));
    }
});

self.addEventListener("message", event => {
    if (event.data?.type !== "CHECK_WEIGHT_APP_RELEASE") return;
    event.waitUntil((async () => {
        if (event.data.refresh) await checkForUpdate().catch(() => {});
        const release = (await cachedResponse(shellURL.href))?.headers.get("X-Weight-Release");
        if (release) event.source?.postMessage({ type: "WEIGHT_APP_RELEASE", release });
    })());
});
