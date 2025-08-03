import {mergeIntoStorageItem} from "@/entrypoints/hooks/useStorage.ts";

export function getRndInteger(min, max) {
    return Math.floor(Math.random() * (max - min + 1) ) + min;
}

export function isVisible(el: HTMLElement | NodeListOf<HTMLElement>) {
    if (el instanceof NodeList) {
        el = el[0];
    }
    return el && el.style && el.style.visibility !== 'hidden' && el.style.display !== 'none';
}

export async function waitForElement(element, selector: string, all: boolean = false, timeout = 500, maxRetry = 10) {
    let retry = 0;
    let el;
    let visible = false;
    while (retry < maxRetry) {
        if (all) {
            el = element.querySelectorAll(selector) as HTMLElement[] | null;
            visible = Array.from(el).every(e => isVisible(e));
        } else {
            el = element.querySelector(selector) as HTMLElement | null;
            visible = isVisible(el);
        }
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

export async function clickWhenVisible(selector: string, element = document) {
    const el = await waitForElement(element, selector);
    console.log(el);
    await wait(getRndInteger(100, 500));
    realClick(el);
}

export function realClick(el) {
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

export async function clickWhenVisibleIframe(iframeSelector: string, buttonSelector: string) {
    const iframe = await waitForElement(document, iframeSelector);
    await new Promise<void>((resolve) => {
        if (iframe.contentDocument?.readyState === 'complete') {
            resolve();
        } else {
            iframe.addEventListener('load', () => resolve(), { once: true });
        }
    });
    await wait(2000);
    const iframeDoc = iframe?.contentDocument || iframe?.contentWindow?.document;
    await clickWhenVisible(buttonSelector, iframeDoc);
}

export async function waitForPageLoad() {
    if (!isDocumentReady) {
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
