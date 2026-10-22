import { describe, it, expect } from 'vitest';
import { findSpinButton, parseWheelPrize, INDIEGALA_WHEEL_URL } from './indieGalaWheel';

function docFrom(html: string): Document {
  return new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
}

describe('INDIEGALA_WHEEL_URL', () => {
  it('points at the IndieGala homepage, where the wheel widget lives', () => {
    expect(INDIEGALA_WHEEL_URL).toBe('https://www.indiegala.com/');
  });
});

describe('findSpinButton', () => {
  it('finds the "Spin" button once the wheel widget has rendered', () => {
    const doc = docFrom('<div class="fortune-wheel-outer relative"><span></span><button>Spin</button></div>');
    const button = findSpinButton(doc);
    expect(button?.textContent).toBe('Spin');
  });

  it('is case-insensitive and trims surrounding whitespace, like other button lookups', () => {
    const doc = docFrom('<button>  spin  </button>');
    expect(findSpinButton(doc)).not.toBeNull();
  });

  it('returns null when the widget has not rendered (no spin available today)', () => {
    const doc = docFrom('<div>nothing here</div>');
    expect(findSpinButton(doc)).toBeNull();
  });

  it('does not match unrelated buttons on the page', () => {
    const doc = docFrom('<button>Close</button><button>Spin now!</button>');
    expect(findSpinButton(doc)).toBeNull();
  });
});

describe('parseWheelPrize', () => {
  const RESULTS_HTML = (label: string, text: string) => `
    <div class="fortune-wheel-results">
      <div class="flex">
        <h5><span>🎉</span> Congrats! <span>🎊</span></h5>
        <h4><span>You win:</span><br class="display-none"/><span>${label}</span></h4>
        <p>${text}</p>
        <button>Close</button>
      </div>
    </div>`;

  it('reads the prize label and description once the reveal has populated them', () => {
    const doc = docFrom(RESULTS_HTML('500 Gala Silver', 'Spend it in the IndieGala store.'));
    expect(parseWheelPrize(doc)).toEqual({
      label: '500 Gala Silver',
      text: 'Spend it in the IndieGala store.',
    });
  });

  it('returns null before the results panel exists', () => {
    const doc = docFrom('<div>spinning…</div>');
    expect(parseWheelPrize(doc)).toBeNull();
  });

  it('returns null while the results panel exists but has not been populated yet', () => {
    const doc = docFrom(RESULTS_HTML('', ''));
    expect(parseWheelPrize(doc)).toBeNull();
  });
});
