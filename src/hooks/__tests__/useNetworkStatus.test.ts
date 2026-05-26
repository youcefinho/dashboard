// @vitest-environment jsdom
// ── Sprint 27 Mobile / PWA — tests useNetworkStatus + useOnlineStatus alias ──
//
// Couvre :
//   1. Initial mount : isOnline=true quand navigator.onLine === true.
//   2. Flip online → offline via dispatchEvent('offline').
//   3. Flip offline → online via dispatchEvent('online').
//   4. useOnlineStatus alias est byte-identique à useNetworkStatus (Phase A).

import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useNetworkStatus, useOnlineStatus } from '../useNetworkStatus';

describe('useNetworkStatus — Sprint 27 Phase C', () => {
  beforeEach(() => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      writable: true,
      value: true,
    });
  });

  it('1. returns isOnline=true on mount when navigator.onLine is true', () => {
    const { result } = renderHook(() => useNetworkStatus());
    expect(result.current.isOnline).toBe(true);
    expect(result.current.lastChange).toBeInstanceOf(Date);
  });

  it('2. flips to offline when offline event is dispatched', () => {
    const { result } = renderHook(() => useNetworkStatus());
    expect(result.current.isOnline).toBe(true);
    act(() => {
      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        writable: true,
        value: false,
      });
      window.dispatchEvent(new Event('offline'));
    });
    expect(result.current.isOnline).toBe(false);
  });

  it('3. flips back to online when online event is dispatched', () => {
    Object.defineProperty(navigator, 'onLine', {
      configurable: true,
      writable: true,
      value: false,
    });
    const { result } = renderHook(() => useNetworkStatus());
    expect(result.current.isOnline).toBe(false);
    act(() => {
      Object.defineProperty(navigator, 'onLine', {
        configurable: true,
        writable: true,
        value: true,
      });
      window.dispatchEvent(new Event('online'));
    });
    expect(result.current.isOnline).toBe(true);
  });

  it('4. useOnlineStatus alias is byte-identical to useNetworkStatus', () => {
    expect(useOnlineStatus).toBe(useNetworkStatus);
  });
});
