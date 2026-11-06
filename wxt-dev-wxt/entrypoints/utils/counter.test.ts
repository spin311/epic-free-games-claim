// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { getStorageItem, setStorageItem } from '@/entrypoints/hooks/useStorage';
import { incrementCounter } from './helpers';

beforeEach(() => {
  fakeBrowser.reset();
});

describe('incrementCounter', () => {
  // Regression: with no counter stored yet (the popup writes 0 only once it
  // has been opened), the first claim stored [1], and later ones [1, 1, ...].
  it('starts from zero when no counter is stored yet', async () => {
    await incrementCounter();

    expect(await getStorageItem('counter')).toBe(1);
  });

  it('adds to a stored count', async () => {
    await setStorageItem('counter', 3);

    await incrementCounter();

    expect(await getStorageItem('counter')).toBe(4);
  });

  it('repairs a count already stored as a list', async () => {
    await setStorageItem('counter', [1, 1]);

    await incrementCounter();

    expect(await getStorageItem('counter')).toBe(3);
  });
});
