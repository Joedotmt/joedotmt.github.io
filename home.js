function randomPixelInset(min = 1, max = 32) {
    return `${Math.floor(Math.random() * (max - min + 1)) + min}px`;
}

function randomClipPath(min = 1, max = 10) {
    const topLeft = `${randomPixelInset(min, max)} ${randomPixelInset(min, max)}`;
    const topRight = `calc(100% - ${randomPixelInset(min, max)}) ${randomPixelInset(min, max)}`;
    const bottomRight = `calc(100% - ${randomPixelInset(min, max)}) calc(100% - ${randomPixelInset(min, max)})`;
    const bottomLeft = `${randomPixelInset(min, max)} calc(100% - ${randomPixelInset(min, max)})`;

    return `polygon(${topLeft}, ${topRight}, ${bottomRight}, ${bottomLeft})`;
}

document.querySelectorAll('.right-column .banner, .right-column .footer')
    .forEach(element => element.style.setProperty('--random-clip-path', randomClipPath()));

document.querySelectorAll('.right-column .social-link')
    .forEach(element => element.style.setProperty('--random-clip-path', randomClipPath(1, 5)));

const menu = document.querySelector('.main-menu');
const selectionBg = document.querySelector('.selection-background');
selectionBg.style.display = "block"
let activeItem = null;

function selectItem(item) {
    activeItem = item;

    // Clear selections and hide banners
    document.querySelectorAll('main-menu > a').forEach(i => i.classList.remove('selected'));
    item.classList.add('selected');
    document.querySelectorAll(".banner").forEach(b => b.style.display = "none");

    // Update selection position
    updateSelectionPosition();

    // Determine which banner to show
    const text = item.textContent.trim();
    const banners = {
        Selfie: {
            element: document.getElementById("selfie"), action: () =>
                document.getElementById("achievements")
                    ?.querySelector("iframe")
                    ?.contentWindow?.postMessage({
                        type: "registerAchievement",
                        achievement: "saw_face"
                    }, "*")
        },
        Achievement: document.getElementById("achievements"),
        'Curriculum Vitae': document.getElementById("CV"),
        'All Pages': document.getElementById("sitemap")
    };

    const match = Object.entries(banners).find(([key]) => text.includes(key));

    if (match) {
        const [key, config] = match;
        if (config.action) config.action();
        (config.element || config).style.display = config.element ? 'flex' : 'block';
    } else {
        document.getElementById("home").style.display = 'block';
    }
}

function updateSelectionPosition() {
    if (!activeItem) return;
    selectionBg.style.top = `${activeItem.offsetTop - 10}px`;
    selectionBg.style.left = `${activeItem.offsetLeft}px`;
}

// Initial setup
const initialItem = document.querySelector(`a[href="${location.hash || "#home"}"]`)
    || document.querySelector(".menu-item");
if (initialItem) {
    selectItem(initialItem);
}


// Event listeners
window.addEventListener("hashchange", () => {
    const targetItem = document.querySelector(`a[href="${location.hash || "#home"}"]`);
    targetItem && selectItem(targetItem);
});

setInterval(updateSelectionPosition, 500);
