// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ToastProvider, useToast } from '../Toast';
import { useEffect } from 'react';

// Composant de test pour consommer le contexte
function TestComponent() {
  const { toast, success, error, warning, info } = useToast();

  return (
    <div>
      <button onClick={() => toast({ type: 'success', message: 'Custom Toast', duration: 4000 })}>Push Custom</button>
      <button onClick={() => success('Success Toast')}>Push Success</button>
      <button onClick={() => error('Error Toast')}>Push Error</button>
      <button onClick={() => warning('Warning Toast')}>Push Warning</button>
      <button onClick={() => info('Info Toast')}>Push Info</button>
      
      <button onClick={() => toast({ 
        type: 'info', 
        message: 'Action Toast', 
        action: { label: 'Undo', onClick: () => console.log('Undo clicked') } 
      })}>Push Action</button>
    </div>
  );
}

describe('Toast Context - Phase B', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    cleanup();
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('renders and pushes toast correctly', async () => {
    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    );

    // Initial state: no toast
    expect(screen.queryByText('Success Toast')).toBeNull();

    // Push success toast
    await act(async () => {
      screen.getByText('Push Success').click();
    });

    expect(screen.getByText('Success Toast')).not.toBeNull();
  });

  it('auto-dismisses toast after duration', async () => {
    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    );

    await act(async () => {
      screen.getByText('Push Success').click();
    });

    expect(screen.getByText('Success Toast')).not.toBeNull();

    // Advance timers by 4000ms
    await act(async () => {
      vi.advanceTimersByTime(4000);
    });

    expect(screen.queryByText('Success Toast')).toBeNull();
  });

  it('supports all 4 types', async () => {
    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    );

    await act(async () => {
      screen.getByText('Push Success').click();
      screen.getByText('Push Error').click();
      screen.getByText('Push Warning').click();
      screen.getByText('Push Info').click();
    });

    expect(screen.getByText('Success Toast')).not.toBeNull();
    expect(screen.getByText('Error Toast')).not.toBeNull();
    expect(screen.getByText('Warning Toast')).not.toBeNull();
    expect(screen.getByText('Info Toast')).not.toBeNull();
  });

  it('supports action button and removes toast on click', async () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    
    render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    );

    await act(async () => {
      screen.getByText('Push Action').click();
    });

    expect(screen.getByText('Action Toast')).not.toBeNull();
    
    // Click on action
    await act(async () => {
      screen.getByText('Undo').click();
    });

    expect(consoleSpy).toHaveBeenCalledWith('Undo clicked');
    // Toast should be removed after clicking action
    expect(screen.queryByText('Action Toast')).toBeNull();
    
    consoleSpy.mockRestore();
  });

  it('unmounts safely without memory leaks', async () => {
    const { unmount } = render(
      <ToastProvider>
        <TestComponent />
      </ToastProvider>
    );

    await act(async () => {
      screen.getByText('Push Success').click();
    });

    // Unmount while toast is visible and timer is running
    unmount();
    
    // Fast-forward timers to check if it throws or errors
    await act(async () => {
      vi.advanceTimersByTime(4000);
    });
    
    // If it doesn't throw, we're good
    expect(true).toBe(true);
  });
});
