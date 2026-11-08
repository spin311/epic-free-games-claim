// Lays out one store image: builds the browser window, sizes the popup captures at
// UI_SCALE, places the popup under the toolbar button, and draws callouts to the
// elements recorded in ../raw-ui/rects.js. Sets body[data-ready] to "1" when done,
// or to an error message (tools/render.mjs fails on that).
(() => {
    const UI_SCALE = 1.05;        // popup CSS px -> image px
    const CAPTURE_SCALE = 2;      // captures are taken at 2x
    const LABEL_GAP = 64;         // popup edge to the callout labels
    const LABEL_SPACING = 16;     // minimum gap between two labels
    const POPUP_INSET = 12;       // popup right edge past the toolbar button's right edge
    const ANCHOR_X = 6;           // leaders end in the popup's left margin (popup CSS px), crossing no text
    const UI_DIR = "../raw-ui/";

    const ICONS = {
        back: '<path d="M15 5l-7 7 7 7"/>',
        forward: '<path d="M9 5l7 7-7 7"/>',
        reload: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4.5H15"/>',
        lock: '<rect x="5.5" y="10.5" width="13" height="9.5" rx="2"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
        globe: '<circle cx="12" cy="12" r="8.5"/><path d="M3.5 12h17M12 3.5c2.5 2.6 2.5 14.4 0 17M12 3.5c-2.5 2.6-2.5 14.4 0 17"/>',
        menu: '<circle cx="12" cy="5.5" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="12" cy="18.5" r="1.3"/>',
    };
    const icon = (name) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
    const fail = (message) => { document.body.dataset.ready = `error: ${message}`; };

    function buildBrowser(el) {
        const isOpen = document.querySelector(".popup") ? " is-open" : "";
        el.insertAdjacentHTML("afterbegin", `
            <div class="tabstrip"><span class="lights"><i></i><i></i><i></i></span>
                <span class="tab">${icon("globe")}<span>${el.dataset.tab}</span></span></div>
            <div class="toolbar">${icon("back")}${icon("forward")}${icon("reload")}
                <span class="url">${icon("lock")}<span>${el.dataset.url}</span></span>
                <span class="ext-button${isOpen}"><img src="icon.png" alt=""></span>${icon("menu")}</div>
            <div class="page"><div class="page-head"></div>${'<div class="page-tile"></div>'.repeat(9)}</div>`);
    }

    function placePopup() {
        const popup = document.querySelector(".popup");
        const toolbar = document.querySelector(".toolbar");
        if (!popup || !toolbar) return;
        const button = document.querySelector(".ext-button").getBoundingClientRect();
        popup.style.left = `${button.right + POPUP_INSET - popup.offsetWidth}px`;
        popup.style.top = `${toolbar.getBoundingClientRect().bottom + 3}px`;
    }

    function sizeCaptures(images) {
        images.forEach((img) => {
            img.style.width = `${(img.naturalWidth / CAPTURE_SCALE) * UI_SCALE}px`;
        });
    }

    function leaderPath(labelRight, labelY, anchorX, anchorY) {
        if (Math.abs(labelY - anchorY) < 1) return `M${labelRight},${labelY} H${anchorX}`;
        const bendX = labelRight + 22;
        return `M${labelRight},${labelY} H${bendX} V${anchorY} H${anchorX}`;
    }

    // Labels sit left of the popup, each level with its element unless that would
    // overlap the label above; the leader then bends down to the element's row, and
    // ends in the popup's margin rather than running across its text.
    function drawCallouts() {
        const popup = document.querySelector(".popup");
        const callouts = [...document.querySelectorAll(".callout")];
        if (!popup || !callouts.length) return;
        const rects = (window.RECTS || {})[popup.dataset.ui];
        if (!rects) throw new Error(`no rects for ${popup.dataset.ui}`);
        const box = popup.getBoundingClientRect();
        const svg = document.querySelector(".leaders");
        const items = callouts.map((el) => {
            const r = rects[el.dataset.target];
            if (!r) throw new Error(`no rect for ${el.dataset.target}`);
            return { el, x: box.left + ANCHOR_X * UI_SCALE, y: box.top + (r.y + r.h / 2) * UI_SCALE };
        }).sort((a, b) => a.y - b.y);

        let previousBottom = -Infinity;
        const labelRight = box.left - LABEL_GAP;
        for (const item of items) {
            const height = item.el.offsetHeight;
            const labelY = Math.max(item.y, previousBottom + LABEL_SPACING + height / 2);
            previousBottom = labelY + height / 2;
            item.el.style.left = `${labelRight - item.el.offsetWidth}px`;
            item.el.style.top = `${labelY - height / 2}px`;
            const d = leaderPath(labelRight, labelY, item.x, item.y);
            svg.insertAdjacentHTML("beforeend",
                `<path class="halo" d="${d}"/><path class="line" d="${d}"/><circle cx="${item.x}" cy="${item.y}" r="5"/>`);
        }
    }

    function start() {
        document.querySelectorAll(".browser").forEach(buildBrowser);
        const images = [...document.querySelectorAll("img[data-ui]")];
        images.forEach((img) => { img.src = UI_DIR + img.dataset.ui; });
        const script = document.createElement("script");
        script.src = `${UI_DIR}rects.js`;
        script.onerror = () => fail("rects.js missing: run tools/capture.mjs first");
        script.onload = () => Promise.all([...[...document.images].map((img) => img.decode()), document.fonts.ready])
            .then(() => {
                if (!document.fonts.check('700 46px "Mona Sans"')) throw new Error("Mona Sans not loaded");
                sizeCaptures(images);
                placePopup();
                drawCallouts();
                document.body.dataset.ready = "1";
            })
            .catch((e) => fail(e.message));
        document.head.append(script);
    }

    document.addEventListener("DOMContentLoaded", start);
})();
