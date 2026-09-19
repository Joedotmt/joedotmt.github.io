"""Generate the service worker's deterministic precache manifest."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parent
TARGET_DIRS = ("app", "coas")
EXTRA_FILES = ("index.html",)
TEMPLATE_FILE = PROJECT_ROOT / "service-worker-template.js"
OUTPUT_FILE = PROJECT_ROOT / "service-worker.js"


def gather_files() -> list[Path]:
    files = [PROJECT_ROOT / relative_path for relative_path in EXTRA_FILES]

    for directory in TARGET_DIRS:
        files.extend(
            path
            for path in (PROJECT_ROOT / directory).rglob("*")
            if path.is_file()
        )

    missing_files = [path for path in files if not path.exists()]
    if missing_files:
        missing = ", ".join(str(path) for path in missing_files)
        raise FileNotFoundError(f"Cannot precache missing files: {missing}")

    return sorted(
        set(files),
        key=lambda path: path.relative_to(PROJECT_ROOT).as_posix(),
    )


def relative_url(path: Path) -> str:
    return f"./{path.relative_to(PROJECT_ROOT).as_posix()}"


def calculate_version(files: list[Path]) -> str:
    digest = hashlib.sha256()

    for path in files:
        digest.update(relative_url(path).encode("utf-8"))
        digest.update(b"\0")
        digest.update(path.read_bytes())
        digest.update(b"\0")

    return digest.hexdigest()[:16]


def build_service_worker() -> None:
    template = TEMPLATE_FILE.read_text(encoding="utf-8")
    files = gather_files()
    urls = [relative_url(path) for path in files]
    version = calculate_version(files)

    output = template.replace("__CACHE_VERSION__", version).replace(
        "__PRECACHE_URLS__",
        json.dumps(urls, ensure_ascii=False, indent=2),
    )

    if output == template:
        raise ValueError("Service worker template placeholders were not found.")

    OUTPUT_FILE.write_text(output, encoding="utf-8")
    print(
        f"Generated {OUTPUT_FILE.name} with {len(urls)} files "
        f"(cache version {version})."
    )


if __name__ == "__main__":
    build_service_worker()
