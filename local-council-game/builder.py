import os

# 🗂️ Directories to scan for files
TARGET_DIRS = ['coas', 'app']

# 📄 Template and output files
TEMPLATE_FILE = 'service-worker-template.js'
OUTPUT_FILE = 'service-worker.js'

# ➕ Extra top-level files to include if they exist
EXTRA_FILES = ['index.html', 'service-worker.js']

# 📝 Manually include these URLs in the cache list (regardless of whether they exist)
MANUAL_ENTRIES = [
]

BASE_PATH = '.'  # adjust if deployed elsewhere

def gather_files(dirs, extra_files, manual_entries):
    all_files = []

    # Add extra files like index.html if they exist
    for file in extra_files:
        if os.path.exists(file) and file != OUTPUT_FILE:
            all_files.append(BASE_PATH+'/' + file.replace("\\", "/"))

    # Walk through each target directory
    for dir in dirs:
        for root, _, files in os.walk(dir):
            for file in files:
                full_path = os.path.join(root, file)
                # Don't include the service worker output file itself
                if os.path.abspath(full_path) == os.path.abspath(OUTPUT_FILE):
                    continue
                all_files.append(BASE_PATH+'/' + full_path.replace("\\", "/"))

    # Add manual entries (included even if they don't exist on disk)
    all_files.extend(manual_entries)

    return all_files

def generate_urls_to_cache(file_list):
    lines = ['const urlsToCache = [']
    for path in file_list:
        lines.append(f"  '{path}',")
    lines.append('];\n')
    return '\n'.join(lines)

def build_service_worker():
    if not os.path.exists(TEMPLATE_FILE):
        print(f"❌ Error: {TEMPLATE_FILE} not found.")
        return

    files = gather_files(TARGET_DIRS, EXTRA_FILES, MANUAL_ENTRIES)
    cache_block = generate_urls_to_cache(files)

    # Read template content
    with open(TEMPLATE_FILE, 'r', encoding='utf-8') as template:
        template_content = template.read()

    # Write final service worker file
    with open(OUTPUT_FILE, 'w', encoding='utf-8') as out:
        out.write(cache_block)
        out.write(template_content)

    print(f"✅ Generated {OUTPUT_FILE} with {len(files)} files cached.")

if __name__ == '__main__':
    build_service_worker()
