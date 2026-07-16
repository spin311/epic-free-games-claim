import { describe, it, expect, afterEach } from 'vitest';
import { getRndInteger, isVisible, waitForPageLoad, findButtonByText, findDeviceNotSupportedContinue } from './helpers';

describe('getRndInteger', () => {
  it('returns a value within [min, max] inclusive', () => {
    for (let i = 0; i < 200; i++) {
      const n = getRndInteger(5, 10);
      expect(n).toBeGreaterThanOrEqual(5);
      expect(n).toBeLessThanOrEqual(10);
    }
  });

  it('returns exactly the value when min === max', () => {
    expect(getRndInteger(7, 7)).toBe(7);
  });
});

describe('isVisible', () => {
  it('is false when display is none', () => {
    const el = document.createElement('div');
    el.style.display = 'none';
    expect(isVisible(el)).toBe(false);
  });

  it('is true for a plain visible element', () => {
    const el = document.createElement('div');
    expect(isVisible(el)).toBe(true);
  });
});

describe('findButtonByText', () => {
  // Trimmed-down copy of the real Epic "Device not supported" modal CTA row.
  const CTA_HTML = `
    <div class="css-15w5v2y-CTA">
      <button type="button"><span><span>Cancel</span></span></button>
      <button type="button"><span><span>Continue</span></span></button>
    </div>`;

  it('returns the Continue button, not Cancel, from the modal CTA row', () => {
    const root = document.createElement('div');
    root.innerHTML = CTA_HTML;
    const btn = findButtonByText(root, 'Continue');
    expect(btn).not.toBeNull();
    expect(btn?.textContent?.trim()).toBe('Continue');
  });

  it('is case-insensitive and trims whitespace', () => {
    const root = document.createElement('div');
    root.innerHTML = '<button>  CONTINUE  </button>';
    expect(findButtonByText(root, 'continue')).not.toBeNull();
  });

  it('returns null when no button matches', () => {
    const root = document.createElement('div');
    root.innerHTML = '<button>Close</button>';
    expect(findButtonByText(root, 'Continue')).toBeNull();
  });

  // The free-game claim confirmation is an "Add to library" button (nested spans).
  it('matches the "Add to library" confirmation button by text', () => {
    const root = document.createElement('div');
    root.innerHTML = '<button type="button"><span class="eds-button__label">Add to library</span></button>';
    expect(findButtonByText(root, 'add to library')).not.toBeNull();
  });

  // EU accounts get a "Right of Withdrawal" modal after confirmation; its
  // "I accept" button must be matched to finish the claim. It must NOT collide
  // with a plain "Accept" (e.g. an EULA button) since matching is exact.
  it('matches "I accept" exactly without matching "Accept"', () => {
    const root = document.createElement('div');
    root.innerHTML =
      '<button type="button"><span class="eds-button__label">Cancel</span></button>' +
      '<button type="button"><span class="eds-button__label">I accept</span></button>';
    expect(findButtonByText(root, 'i accept')?.textContent?.trim()).toBe('I accept');

    const eula = document.createElement('div');
    eula.innerHTML = '<button><span>Accept</span></button>';
    expect(findButtonByText(eula, 'i accept')).toBeNull();
  });
});

describe('findDeviceNotSupportedContinue', () => {
  // Reproduces the real page state: TWO role="dialog" elements present, and the
  // device-not-supported one is NOT first. Earlier code used querySelector (first
  // match only) and missed it — this guards against that regression.
  const TWO_DIALOGS_HTML = `
    <div role="dialog" aria-modal="true">
      <h4><span>Cookie preferences</span></h4>
      <div class="cta"><button type="button"><span>Accept</span></button></div>
    </div>
    <div role="dialog" aria-modal="true">
      <h4><span>Device not supported</span></h4>
      <span>This product is not compatible with your current device</span>
      <div class="cta">
        <button type="button"><span><span>Cancel</span></span></button>
        <button type="button"><span><span>Continue</span></span></button>
      </div>
    </div>`;

  it('finds Continue in the device-not-supported dialog even when it is not the first dialog', () => {
    const root = document.createElement('div');
    root.innerHTML = TWO_DIALOGS_HTML;
    const btn = findDeviceNotSupportedContinue(root);
    expect(btn).not.toBeNull();
    expect(btn?.textContent?.trim()).toBe('Continue');
  });

  it('returns null when no device-not-supported dialog is present', () => {
    const root = document.createElement('div');
    root.innerHTML = '<div role="dialog"><button>Continue</button></div>';
    expect(findDeviceNotSupportedContinue(root)).toBeNull();
  });
});

describe('waitForPageLoad', () => {
  const original = Object.getOwnPropertyDescriptor(Document.prototype, 'readyState');

  afterEach(() => {
    if (original) Object.defineProperty(document, 'readyState', original);
  });

  const stubReadyState = (value: DocumentReadyState) =>
    Object.defineProperty(document, 'readyState', { configurable: true, get: () => value });

  it('resolves immediately when the document is already ready', async () => {
    stubReadyState('complete');
    await expect(waitForPageLoad()).resolves.toBeUndefined();
  });

  // Regression guard for the `!isDocumentReady` bug: before the fix the guard
  // tested a function reference (always truthy), so it never waited and resolved
  // immediately even while the document was still loading.
  it('waits for DOMContentLoaded when the document is still loading', async () => {
    stubReadyState('loading');
    let resolved = false;
    const pending = waitForPageLoad().then(() => {
      resolved = true;
    });

    await Promise.resolve();
    expect(resolved).toBe(false);

    document.dispatchEvent(new Event('DOMContentLoaded'));
    await pending;
    expect(resolved).toBe(true);
  });
});
