// @vitest-environment node
// Storage helpers need no DOM. Running under node avoids the esbuild/jsdom
// TextEncoder invariant clash that WXT's `#imports` transform triggers in jsdom.
import { describe, it, expect, beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import {
  getStorageItem,
  setStorageItem,
  getStorageItems,
  setStorageItems,
  mergeIntoStorageItem,
} from './useStorage';

describe('useStorage helpers', () => {
  beforeEach(() => {
    // Reset the in-memory extension storage between tests.
    fakeBrowser.reset();
  });

  describe('getStorageItem', () => {
    // Regression anchor for the background.ts bug: a missing key returns null,
    // so callers MUST guard (`... || []`) before calling array methods on it.
    it('returns null for a key that was never set', async () => {
      expect(await getStorageItem('epicGames')).toBeNull();
    });

    it('round-trips a value through setStorageItem', async () => {
      await setStorageItem('counter', 3);
      expect(await getStorageItem<number>('counter')).toBe(3);
    });

    it('stores and returns arrays intact', async () => {
      const games = [{ title: 'A' }, { title: 'B' }];
      await setStorageItem('steamGames', games);
      expect(await getStorageItem('steamGames')).toEqual(games);
    });
  });

  describe('getStorageItems / setStorageItems', () => {
    it('writes and reads multiple keys by short name', async () => {
      await setStorageItems({ active: true, epicCheck: false });
      const result = await getStorageItems(['active', 'epicCheck']);
      expect(result).toEqual({ active: true, epicCheck: false });
    });

    it('returns null for keys that are unset', async () => {
      const result = await getStorageItems(['active']);
      expect(result.active).toBeNull();
    });
  });

  describe('mergeIntoStorageItem', () => {
    it('creates an array from a single value when nothing is stored', async () => {
      await mergeIntoStorageItem('list', 'a');
      expect(await getStorageItem('list')).toEqual(['a']);
    });

    it('appends to an existing array', async () => {
      await setStorageItem('list', ['a']);
      await mergeIntoStorageItem('list', ['b', 'c']);
      expect(await getStorageItem('list')).toEqual(['a', 'b', 'c']);
    });

    it('increments an existing number (counter behaviour)', async () => {
      await setStorageItem('counter', 5);
      await mergeIntoStorageItem('counter', 2);
      expect(await getStorageItem<number>('counter')).toBe(7);
    });

    it('concatenates onto an existing string', async () => {
      await setStorageItem('note', 'ab');
      await mergeIntoStorageItem('note', 'c');
      expect(await getStorageItem('note')).toBe('abc');
    });
  });
});
