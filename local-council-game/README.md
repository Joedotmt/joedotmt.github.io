# Malta Local Council Guesser

A static, map-based guessing game for Malta's local councils. The application
uses local copies of Leaflet and `shp.js`, so it has no runtime package or CDN
dependencies.

## Run locally

The shapefile and JavaScript modules must be served over HTTP rather than opened
directly from the filesystem:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000/`.

## Checks

```sh
npm test
npm run build:pwa
```

`builder.py` scans only `index.html`, `app/`, and `coas/`. It generates a
deterministic, content-versioned `service-worker.js`; rerun it whenever a
published asset changes. Old caches belonging to this game are removed during
service-worker activation. Caches and service workers belonging to other apps
on the same origin are never touched.

## Structure

- `index.html` contains the application shell.
- `app/app.js` coordinates the existing game modes and map interactions.
- `app/game-config.js` contains game modes and map styles.
- `app/game-storage.js` owns persisted save and stopwatch data.
- `app/game-utils.js` contains behavior-sensitive name and time formatting.
- `app/locality-data.js` loads accepted locality names.
- `app/pwa.js` registers the service worker.
- `app/styles.css` contains the custom interface styles.
- `coas/` contains the coat-of-arms directory and images.
