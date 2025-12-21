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
            visible = Array.from(el).every(e => isVisible(e));
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

export async function clickWhenVisibleIframe(iframeSelector: string, buttonSelector: string) {
    const iframe = await waitForElement(document, iframeSelector) as HTMLIFrameElement;
    if (!iframe) return;
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
