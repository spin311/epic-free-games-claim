import { describe, it, expect, vi } from 'vitest';
import {
    appendRedeemParams,
    extractRedeemCodeParam,
    extractRedeemTitleParam,
    findButtonByAnyText,
    findInputByHint,
    REDEEM_CODE_PARAM,
    REDEEM_TITLE_PARAM,
    setControlledInputValue,
    submitRedeemCode,
} from '@/entrypoints/utils/redeemCode.ts';

describe('setControlledInputValue', () => {
    it('sets the value and fires a real input event so framework listeners see the change', () => {
        const input = document.createElement('input');
        const handler = vi.fn();
        input.addEventListener('input', handler);

        setControlledInputValue(input, 'ABC123');

        expect(input.value).toBe('ABC123');
        expect(handler).toHaveBeenCalledTimes(1);
    });
});

describe('findInputByHint', () => {
    it('matches by id', () => {
        document.body.innerHTML = '<input id="codeInput" />';
        expect(findInputByHint(document, /code/i)).toBe(document.getElementById('codeInput'));
    });

    it('matches by aria-label when id/name give no hint', () => {
        document.body.innerHTML = '<input aria-label="Enter your code" />';
        expect(findInputByHint(document, /code/i)).not.toBeNull();
    });

    it('matches by placeholder', () => {
        document.body.innerHTML = '<input placeholder="25-character code" />';
        expect(findInputByHint(document, /code/i)).not.toBeNull();
    });

    it('returns null when nothing matches', () => {
        document.body.innerHTML = '<input id="email" placeholder="Email address" />';
        expect(findInputByHint(document, /code/i)).toBeNull();
    });
});

describe('findButtonByAnyText', () => {
    it('returns the first candidate label found', () => {
        document.body.innerHTML = '<button>Redeem</button>';
        const button = findButtonByAnyText(document, ['Next', 'Redeem', 'Continue']);
        expect(button?.textContent).toBe('Redeem');
    });

    it('returns null when none of the candidates match', () => {
        document.body.innerHTML = '<button>Cancel</button>';
        expect(findButtonByAnyText(document, ['Next', 'Redeem', 'Continue'])).toBeNull();
    });
});

describe('extractRedeemCodeParam', () => {
    it('reads the extCode param', () => {
        expect(extractRedeemCodeParam(`?${REDEEM_CODE_PARAM}=ABC123`)).toBe('ABC123');
    });

    it('returns null when absent', () => {
        expect(extractRedeemCodeParam('?other=1')).toBeNull();
    });
});

describe('extractRedeemTitleParam', () => {
    it('reads the extTitle param', () => {
        expect(extractRedeemTitleParam(`?${REDEEM_TITLE_PARAM}=DOOM+Eternal`)).toBe('DOOM Eternal');
    });

    it('returns null when absent', () => {
        expect(extractRedeemTitleParam('?other=1')).toBeNull();
    });
});

describe('appendRedeemParams', () => {
    it('sets only the code param when no title is given', () => {
        const url = new URL(appendRedeemParams('https://example.com/redeem', 'ABC123'));
        expect(url.searchParams.get(REDEEM_CODE_PARAM)).toBe('ABC123');
        expect(url.searchParams.has(REDEEM_TITLE_PARAM)).toBe(false);
    });

    it('sets both params, round-tripping special characters in the title', () => {
        const url = appendRedeemParams('https://example.com/redeem', 'ABC123', "Baldur's Gate 3");
        const parsed = new URL(url);
        expect(parsed.searchParams.get(REDEEM_CODE_PARAM)).toBe('ABC123');
        expect(parsed.searchParams.get(REDEEM_TITLE_PARAM)).toBe("Baldur's Gate 3");
    });
});

describe('submitRedeemCode', () => {
    function makeInput(): HTMLInputElement {
        return document.createElement('input');
    }

    it('fills the code and returns "redeemed" once the button disappears and stays gone', async () => {
        const input = makeInput();
        const button = document.createElement('button');
        const setInputValue = vi.fn();
        const clickFn = vi.fn();
        let buttonGone = false;
        const waitFn = vi.fn(async () => {
            buttonGone = true;
        });

        const outcome = await submitRedeemCode(
            'ABC123',
            input,
            () => (buttonGone ? null : button),
            setInputValue,
            clickFn,
            waitFn,
            1000,
            5,
            20,
        );

        expect(outcome).toBe('redeemed');
        expect(setInputValue).toHaveBeenCalledWith(input, 'ABC123');
        expect(clickFn).toHaveBeenCalledWith(button);
    });

    // Confirmed live against Microsoft's real redeem flow: Next -> a
    // *different* Confirm button on a re-rendered page -> success. Neither
    // intermediate button disappearing briefly (a re-render gap) nor the
    // first click alone may count as done.
    // Confirmed live on GOG: Vue patches the step-1 "Continue" <button> in
    // place into step 2's "Redeem" — same element instance, new label.
    it('clicks the same element again once its label changes to the next step', async () => {
        const input = makeInput();
        const button = document.createElement('button');
        button.textContent = 'Continue';
        let isGone = false;
        const clickFn = vi.fn(() => {
            if (button.textContent === 'Continue') button.textContent = 'Redeem';
            else isGone = true;
        });

        const outcome = await submitRedeemCode(
            'ABC123',
            input,
            () => (isGone ? null : button),
            vi.fn(),
            clickFn,
            vi.fn(async () => {}),
            1000,
            5,
            20,
        );

        expect(outcome).toBe('redeemed');
        expect(clickFn).toHaveBeenCalledTimes(2);
    });

    // Re-clicking on a label change must stay bounded: a button that keeps
    // flipping labels (e.g. Redeem -> Continue -> Redeem after errors) must not
    // be submitted over and over for the whole timeout window.
    it('caps how many times it clicks a button that keeps changing label', async () => {
        const button = document.createElement('button');
        button.textContent = 'Continue';
        const clickFn = vi.fn(() => {
            button.textContent = button.textContent === 'Continue' ? 'Redeem' : 'Continue';
        });

        const outcome = await submitRedeemCode(
            'ABC123',
            makeInput(),
            () => button,
            vi.fn(),
            clickFn,
            vi.fn(async () => {}),
            200,
            5,
            20,
        );

        expect(outcome).toBe('not-redeemed');
        expect(clickFn).toHaveBeenCalledTimes(4);
    });

    it('clicks a freshly rendered second button (multi-step confirm flow) before reporting redeemed', async () => {
        const input = makeInput();
        const nextButton = document.createElement('button');
        const confirmButton = document.createElement('button');
        let currentButton: HTMLButtonElement | null = nextButton;
        let clicks = 0;

        const clickFn = vi.fn((el: HTMLElement) => {
            clicks++;
            if (el === nextButton) {
                // Simulate the SPA swapping in a confirm step after "Next".
                currentButton = confirmButton;
            } else if (el === confirmButton) {
                currentButton = null;
            }
        });

        const outcome = await submitRedeemCode(
            'ABC123',
            input,
            () => currentButton,
            vi.fn(),
            clickFn,
            vi.fn(async () => {}),
            1000,
            5,
            20,
        );

        expect(outcome).toBe('redeemed');
        expect(clicks).toBe(2);
    });

    it('does not report "redeemed" during a brief gap where no button is found yet (before any click)', async () => {
        const input = makeInput();
        const button = document.createElement('button');
        let ticks = 0;

        // No button for the first two polls (page still rendering), then it
        // shows up — since nothing has been clicked yet, this must not be
        // mistaken for "the button disappeared after succeeding".
        const outcome = await submitRedeemCode(
            'ABC123',
            input,
            () => (ticks < 2 ? null : button),
            vi.fn(),
            vi.fn(),
            vi.fn(async () => { ticks++; }),
            60,
            5,
            20,
        );

        expect(outcome).toBe('not-redeemed');
    });

    it('never clicks the same button instance twice', async () => {
        const input = makeInput();
        const button = document.createElement('button');
        const clickFn = vi.fn();
        let calls = 0;

        const outcome = await submitRedeemCode(
            'ABC123',
            input,
            () => button,
            vi.fn(),
            clickFn,
            vi.fn(async () => { calls++; }),
            30,
            5,
        );

        expect(outcome).toBe('not-redeemed');
        expect(clickFn).toHaveBeenCalledTimes(1);
        expect(calls).toBeGreaterThan(1);
    });

    it('returns "not-redeemed" without clicking when the button never becomes enabled', async () => {
        const input = makeInput();
        const button = document.createElement('button');
        button.disabled = true;
        const clickFn = vi.fn();

        const outcome = await submitRedeemCode(
            'ABC123',
            input,
            () => button,
            vi.fn(),
            clickFn,
            vi.fn(async () => {}),
            20,
            5,
        );

        expect(outcome).toBe('not-redeemed');
        expect(clickFn).not.toHaveBeenCalled();
    });

    it('returns "not-redeemed" when no submit button is ever found', async () => {
        const input = makeInput();
        const outcome = await submitRedeemCode(
            'ABC123',
            input,
            () => null,
            vi.fn(),
            vi.fn(),
            vi.fn(async () => {}),
            20,
            5,
        );

        expect(outcome).toBe('not-redeemed');
    });
});
