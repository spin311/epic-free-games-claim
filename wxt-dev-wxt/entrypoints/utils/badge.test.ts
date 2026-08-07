import { describe, it, expect, vi } from 'vitest';
import { resolveActionApi } from './badge';

function apiStub() {
  return {
    setBadgeText: vi.fn(),
    setBadgeBackgroundColor: vi.fn(),
  };
}

describe('resolveActionApi', () => {
  it('uses browser.action under Manifest V3', () => {
    const action = apiStub();

    expect(resolveActionApi({ action })).toBe(action);
  });

  it('falls back to browser.browserAction under Firefox Manifest V2', () => {
    const browserAction = apiStub();

    expect(resolveActionApi({ browserAction })).toBe(browserAction);
  });

  it('prefers browser.action when both namespaces exist', () => {
    const action = apiStub();
    const browserAction = apiStub();

    expect(resolveActionApi({ action, browserAction })).toBe(action);
  });

  it('is undefined when neither namespace exists', () => {
    expect(resolveActionApi({})).toBeUndefined();
  });
});
