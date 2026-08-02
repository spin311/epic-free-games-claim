import {mergeIntoStorageItem} from "@/entrypoints/hooks/useStorage.ts";

export function getRndInteger(min: number, max: number) {
    return Math.floor(Math.random() * (max - min + 1) ) + min;
}

export function isVisible(el: HTMLElement) {
    return el && el.style && el.style.visibility !== 'hidden' && el.style.display !== 'none';
}

export async function waitForElement(document: Document | HTMLElement, selector: string, timeout = 500, maxRetry = 10): Promise<HTMLElement | null> {
    let retry = 0;
    let el;
    let visible = false;
    while (retry < maxRetry) {
            el = document.querySelector(selector) as HTMLElement;
            visible = isVisible(el);
        if (el && visible) {
            return el;
        }
        await wait(timeout);
        retry++;
    }
    return null;
}

export async function waitForAllElements(document: Document, selector: string, timeout = 500, maxRetry = 10): Promise<NodeListOf<HTMLElement> | null> {
    let retry = 0;
    let el;
    let visible = false;
    while (retry < maxRetry) {
            el = document.querySelectorAll(selector) as NodeListOf<HTMLElement>;
            visible = Array.from(el).every((e: HTMLElement) => isVisible(e));
        if (el && visible) {
            return el;
        }
        await wait(timeout);
        retry++;
    }
    return null;
}


export function wait(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
}

export async function clickWhenVisible(selector: string, doc: Document | HTMLElement = document) {
    const el = await waitForElement(doc, selector);
    await wait(getRndInteger(100, 500));
    realClick(el);
}

export function realClick(el: HTMLElement | null) {
    if (el === null) return;
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

// Find a <button> by its visible text (case-insensitive, trimmed). More robust
// than positional or hashed-class selectors on Epic's frequently-churning DOM.
export function findButtonByText(root: Document | HTMLElement, text: string): HTMLButtonElement | null {
    const target = text.trim().toLowerCase();
    const buttons = Array.from(root.querySelectorAll<HTMLButtonElement>('button'));
    return buttons.find((btn) => (btn.textContent ?? '').trim().toLowerCase() === target) ?? null;
}

// Epic's page can have MULTIPLE role="dialog" elements at once, so we must scan
// them all (not just the first) to find the "Device not supported" modal — matched
// by its text — and return its "Continue" button.
export function findDeviceNotSupportedContinue(root: Document | HTMLElement): HTMLButtonElement | null {
    const dialogs = Array.from(root.querySelectorAll<HTMLElement>('[role="dialog"]'));
    for (const dialog of dialogs) {
        if (/not\s+(supported|compatible)/i.test(dialog.textContent ?? '')) {
            const button = findButtonByText(dialog, 'Continue');
            if (button) return button;
        }
    }
    return null;
}

// Mature-content games open with an age-gate modal exposing a stable
// #btn_age_continue "Continue" button. Return it only when present AND enabled
// — logged-in, age-verified accounts get a plain acknowledgment (enabled),
// while anonymous/unverified users get a date-of-birth variant that keeps the
// button disabled until a birthday is entered (which we can't auto-fill).
export function findAgeGateContinue(root: Document | HTMLElement): HTMLButtonElement | null {
    const button = root.querySelector<HTMLButtonElement>('#btn_age_continue');
    return button && !button.disabled ? button : null;
}

export async function waitForPageLoad() {
    if (!isDocumentReady()) {
        await new Promise<void>(resolve => {
            document.addEventListener('DOMContentLoaded', () => resolve(), {once: true});
        });
    }
}

function isDocumentReady() {
    const state = document.readyState;
    return state === 'complete' || state === 'interactive';
}

export async function incrementCounter(value: number = 1) {
    await mergeIntoStorageItem("counter", value);
}
