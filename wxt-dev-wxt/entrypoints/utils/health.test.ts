// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { fakeBrowser } from 'wxt/testing';
import { Platforms } from '@/entrypoints/enums/platforms';
import { getStorageItem } from '@/entrypoints/hooks/useStorage';
import { NetworkError, SignedOutError, StoreChangedError } from './network';
import {
  activeProblem,
  classifyFailure,
  HEALTH_KEYS,
  healthKey,
  PlatformHealth,
  recordHealthError,
  recordHealthOk,
} from './health';

describe('classifyFailure', () => {
  it('reads an unreachable store as a network problem', () => {
    expect(classifyFailure(new NetworkError('Failed to fetch'))).toBe('network');
  });

  // A body read that dies mid-way, or a caller's timeout, after fetchWithRetry returned.
  it('reads a dropped or timed-out response as a network problem too', () => {
    expect(classifyFailure(new TypeError('network error'))).toBe('network');
    expect(classifyFailure(new DOMException('signal timed out', 'TimeoutError'))).toBe('network');
  });

  it('reads anything else as the store having changed', () => {
    expect(classifyFailure(new StoreChangedError('no result list'))).toBe('changed');
    expect(classifyFailure(new Error('responded 500'))).toBe('changed');
  });

  // The popup's login status already says so.
  it('is not a health problem when the store says signed out', () => {
    expect(classifyFailure(new SignedOutError('401'))).toBeNull();
  });
});

describe('activeProblem', () => {
  const error = { problem: 'changed' as const, detail: 'x', at: '2026-10-29T10:00:00.000Z' };

  it('is the last error while nothing has worked since', () => {
    expect(activeProblem({ lastOkAt: '2026-10-29T09:00:00.000Z', lastError: error })).toEqual(error);
    expect(activeProblem({ lastOkAt: null, lastError: error })).toEqual(error);
  });

  it('is null once a later check worked', () => {
    expect(activeProblem({ lastOkAt: '2026-10-29T11:00:00.000Z', lastError: error })).toBeNull();
  });

  it('is null with nothing recorded', () => {
    expect(activeProblem(null)).toBeNull();
    expect(activeProblem({ lastOkAt: null, lastError: null })).toBeNull();
  });
});

describe('recording health', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  it('keeps the last error when a check works, so its time can be compared', async () => {
    await recordHealthError(Platforms.Epic, 'changed', 'no Get button', new Date('2026-10-29T10:00:00Z'));
    await recordHealthOk(Platforms.Epic, new Date('2026-10-29T11:00:00Z'));

    const health = await getStorageItem<PlatformHealth>(HEALTH_KEYS[Platforms.Epic]);
    expect(health).toEqual({
      lastOkAt: '2026-10-29T11:00:00.000Z',
      lastError: { problem: 'changed', detail: 'no Get button', at: '2026-10-29T10:00:00.000Z' },
    });
    expect(activeProblem(health)).toBeNull();
  });

  it('keeps each store apart', async () => {
    await recordHealthError(Platforms.Steam, 'network', 'Failed to fetch');

    expect(await getStorageItem(HEALTH_KEYS[Platforms.Epic])).toBeNull();
  });
});

describe('claim-stage health', () => {
  beforeEach(() => {
    fakeBrowser.reset();
  });

  // A working list check says nothing about the claim flow (Epic's redesign
  // broke only the latter), so it must not clear a claim tab's report.
  it('is kept apart from the store check, so a working check does not clear it', async () => {
    await recordHealthError(Platforms.Epic, 'changed', 'no Get button', new Date('2026-10-29T10:00:00Z'), 'claim');
    await recordHealthOk(Platforms.Epic, new Date('2026-10-29T11:00:00Z'));

    expect(activeProblem(await getStorageItem<PlatformHealth>(healthKey(Platforms.Epic, 'claim')))?.detail).toBe('no Get button');
  });
});
