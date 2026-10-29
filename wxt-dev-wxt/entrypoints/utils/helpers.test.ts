import { describe, it, expect, afterEach } from 'vitest';
import { getRndInteger, isVisible, waitForPageLoad, findButtonByText, findDeviceNotSupportedContinue, findAgeGateContinue, findAdultCheckConfirm, findEpicGetButton, isEpicGameOwned, isCaptchaShown, sameOriginFrameDocuments } from './helpers';

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

describe('findEpicGetButton', () => {
  // Trimmed-down copy of the live product page sidebar (Oct 2026 redesign):
  // no data-testid any more, only a hashed CSS-module class and the label.
  const sidebar = (label: string) => `
    <section class="_sidebar_96vuv_7">
      <button type="button" class="eds_370_3ezmi30 _sidebarBuyButton_96vuv_33"><span class="eds_370_3ezmi3f">${label}</span></button>
      <button type="button"><span>Wishlist</span></button>
    </section>`;

  function rootFrom(html: string): HTMLElement {
    const root = document.createElement('div');
    root.innerHTML = html;
    return root;
  }

  it('finds the redesigned sidebar buy button labelled "Get"', () => {
    const root = rootFrom(sidebar('Get'));
    expect(findEpicGetButton(root)?.className).toContain('_sidebarBuyButton_');
  });

  it('still finds the pre-redesign purchase-cta-button', () => {
    const root = rootFrom('<button data-testid="purchase-cta-button"><span>Get</span></button>');
    expect(findEpicGetButton(root)?.dataset.testid).toBe('purchase-cta-button');
  });

  // An owned game's CTA reads "In Library": clicking it hands off to the
  // launcher, so it must never be mistaken for a claim button.
  it('returns null when the buy button is not a free "Get"', () => {
    expect(findEpicGetButton(rootFrom(sidebar('In Library')))).toBeNull();
  });

  it('ignores "Get" buttons outside the buy button, e.g. a free add-on above the sidebar', () => {
    const root = rootFrom(`<div class="addons"><button type="button"><span>Get</span></button></div>${sidebar('In Library')}`);
    expect(findEpicGetButton(root)).toBeNull();
  });

  describe('isEpicGameOwned', () => {
    it('is true when the buy button reads "In Library"', () => {
      expect(isEpicGameOwned(rootFrom(sidebar('In Library')))).toBe(true);
    });

    it('is false for a claimable game', () => {
      expect(isEpicGameOwned(rootFrom(sidebar('Get')))).toBe(false);
    });

    // No buy button at all means the page changed (or never rendered), which
    // must stay a failure to retry, not read as "nothing left to claim".
    it('is false when there is no buy button at all', () => {
      expect(isEpicGameOwned(rootFrom('<button><span>In Library</span></button>'))).toBe(false);
    });
  });
});

describe('isCaptchaShown', () => {
  // Seen live after "Get" → "Continue": an always-present 0x0 hCaptcha frame,
  // plus a 520x570 one only while a challenge is up.
  function withFrame(width: number, height: number, visibility = 'visible'): HTMLElement {
    const root = document.createElement('div');
    const frame = document.createElement('iframe');
    frame.src = 'https://newassets.hcaptcha.com/captcha/v1/abc/static/hcaptcha.html';
    frame.style.visibility = visibility;
    frame.getBoundingClientRect = () => ({ width, height } as DOMRect);
    root.appendChild(frame);
    document.body.appendChild(root);
    return root;
  }

  afterEach(() => {
    document.body.innerHTML = '';
  });

  // Confirmed live: once solved, the challenge frame keeps its size and is
  // only hidden.
  it('is false for a solved challenge, which keeps its size but is hidden', () => {
    expect(isCaptchaShown(withFrame(520, 570, 'hidden'))).toBe(false);
  });

  it('is true while an hCaptcha challenge is on screen', () => {
    expect(isCaptchaShown(withFrame(520, 570))).toBe(true);
  });

  it('is false for the invisible hCaptcha frame that is always there', () => {
    expect(isCaptchaShown(withFrame(0, 0))).toBe(false);
  });

  it('is false without any hCaptcha frame', () => {
    expect(isCaptchaShown(document.createElement('div'))).toBe(false);
  });
});

describe('sameOriginFrameDocuments', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  // Epic's checkout now lives in an iframe inside a dialog, with no
  // #webPurchaseContainer around it, so every reachable frame is searched.
  it('returns the documents of iframes the page can reach, wherever they sit', () => {
    document.body.innerHTML = '<section role="dialog"><div><iframe></iframe></div></section>';
    const frame = document.querySelector('iframe')!;
    frame.contentDocument!.body.innerHTML = '<button>Add to library</button>';

    const docs = sameOriginFrameDocuments(document);

    expect(docs).toHaveLength(1);
    expect(findButtonByText(docs[0], 'Add to library')).not.toBeNull();
  });

  it('skips frames it cannot reach (cross-origin, e.g. hCaptcha)', () => {
    document.body.innerHTML = '<iframe></iframe>';
    Object.defineProperty(document.querySelector('iframe')!, 'contentDocument', { get: () => null });

    expect(sameOriginFrameDocuments(document)).toEqual([]);
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

describe('findAgeGateContinue', () => {
  // Real markup: the age-gate Continue button carries a stable id.
  const AGE_GATE = (disabled = false) =>
    `<div role="dialog"><button type="button" id="btn_age_continue"${disabled ? ' disabled' : ''}>` +
    '<span><span>Continue</span></span></button></div>';

  it('returns the enabled #btn_age_continue button (logged-in acknowledgment)', () => {
    const root = document.createElement('div');
    root.innerHTML = AGE_GATE(false);
    expect(findAgeGateContinue(root)?.id).toBe('btn_age_continue');
  });

  it('returns null for the disabled date-of-birth variant', () => {
    const root = document.createElement('div');
    root.innerHTML = AGE_GATE(true);
    expect(findAgeGateContinue(root)).toBeNull();
  });

  it('returns null when there is no age gate', () => {
    const root = document.createElement('div');
    root.innerHTML = '<button id="something-else">Continue</button>';
    expect(findAgeGateContinue(root)).toBeNull();
  });
});

describe('findAdultCheckConfirm', () => {
  // Real markup: initAdultCheckDialog() (freebies.indiegala.com's own inline
  // script) prepends this dialog to <body> for mature-content products.
  const ADULT_CHECK_DIALOG =
    '<div id="adult-cover" class="adult-check-cover"><div class="adult-check-inner">' +
    '<div class="adult-check-header">Adult age check</div>' +
    '<div class="adult-check-footer"><div class="adult-check-action">' +
    '<a class="adult-check-leave" href="https://www.indiegala.com">Leave this page</a></div>' +
    '<div class="adult-check-action"><a class="adult-check-confirm" href="#">Confirm</a></div>' +
    '</div></div></div>';

  it('returns the Confirm link, not Leave this page', () => {
    const root = document.createElement('div');
    root.innerHTML = ADULT_CHECK_DIALOG;
    const link = findAdultCheckConfirm(root);
    expect(link?.textContent?.trim()).toBe('Confirm');
    expect(link?.className).toBe('adult-check-confirm');
  });

  it('returns null when no gate is present (non-mature freebie)', () => {
    const root = document.createElement('div');
    root.innerHTML = '<div>ordinary product page</div>';
    expect(findAdultCheckConfirm(root)).toBeNull();
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
