import assert from 'node:assert/strict';

import { act, render } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, beforeEach, test, vi } from 'vitest';

/**
 * Issue #582: when the chat socket dropped, nothing in the UI changed, so a
 * message typed during the outage was lost without the user noticing. The
 * provider now reports `connectionStatus`, which tells a lost connection
 * (`disconnected`) apart from the first handshake (`connecting`, which must not
 * flash a warning on every page load) and from the socket it swaps on purpose
 * when the auth token is refreshed (which must not read as lost either).
 *
 * A backgrounded page (an iOS app in the background, a frozen tab) comes back to
 * a socket the server heartbeat has already terminated, so the provider also
 * reconnects on resume and on `online` rather than serving the retry delay; the
 * cases below pin that down along with the backoff used while it keeps failing.
 */

type FakeAuth = { user: { id: number } | null; token: string | null; isLoading: boolean };

// Mutable so a test can hand the provider a refreshed token or sign the user
// out. `user` keeps one identity throughout; a fresh object would rebuild
// `connect` on every render.
const AUTH = vi.hoisted(() => {
  const user = { id: 1 };
  return { user, current: { user, token: 'token-1', isLoading: false } as FakeAuth };
});

vi.mock('@/modules/auth', () => ({
  useAuth: () => AUTH.current,
}));

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  readyState = FakeWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: ((error: unknown) => void) | null = null;

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
  }

  send() {}

  // A real socket closed by the page still fires `close`; firing it here means
  // a swap that forgot to detach its handler would be caught.
  close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }

  serverOpens() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  /** The network or the server ends the socket (or refuses the handshake). */
  serverDrops() {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }
}

const { WebSocketProvider, useWebSocket } = await import('@/shared/context/WebSocketContext');

/** Every status the provider rendered, in order, so a one-render flash is caught too. */
let seen: string[] = [];
let isConnected: boolean | null = null;

function RecordStatus() {
  const value = useWebSocket();
  seen.push(String(value.connectionStatus));
  useEffect(() => {
    isConnected = value.isConnected;
  });
  return null;
}

const renderProvider = () => render(<WebSocketProvider><RecordStatus /></WebSocketProvider>);
const socket = (index: number) => FakeWebSocket.instances[index] as FakeWebSocket;
const lastStatus = () => seen[seen.length - 1];

/** Drives the provider the way the OS does: a hidden page, then a visible one. */
const setVisibility = (state: 'visible' | 'hidden') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
};

beforeEach(() => {
  vi.useFakeTimers();
  FakeWebSocket.instances = [];
  seen = [];
  isConnected = null;
  AUTH.current = { user: AUTH.user, token: 'token-1', isLoading: false };
  vi.stubGlobal('WebSocket', FakeWebSocket);
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test('the first handshake reads as connecting, never as a lost connection', () => {
  renderProvider();
  assert.equal(FakeWebSocket.instances.length, 1);
  assert.equal(lastStatus(), 'connecting');
  assert.equal(isConnected, false);

  act(() => socket(0).serverOpens());
  assert.equal(lastStatus(), 'connected');
  assert.equal(isConnected, true);
  assert.ok(!seen.includes('disconnected'), `statuses seen: ${seen.join(', ')}`);
});

test('a dropped socket reads as disconnected through every failed retry, until one opens', () => {
  renderProvider();
  act(() => socket(0).serverOpens());

  act(() => socket(0).serverDrops());
  assert.equal(lastStatus(), 'disconnected');
  assert.equal(isConnected, false);

  // The retry is still handshaking: the connection is not back yet.
  act(() => { vi.advanceTimersByTime(3000); });
  assert.equal(FakeWebSocket.instances.length, 2);
  assert.equal(lastStatus(), 'disconnected');

  // The server is still unreachable.
  act(() => socket(1).serverDrops());
  assert.equal(lastStatus(), 'disconnected');

  // The second failure doubles the wait.
  act(() => { vi.advanceTimersByTime(6000); });
  assert.equal(FakeWebSocket.instances.length, 3);
  act(() => socket(2).serverOpens());
  assert.equal(lastStatus(), 'connected');
  assert.equal(isConnected, true);
});

test('a first attempt that fails reads as disconnected', () => {
  renderProvider();
  act(() => socket(0).serverDrops());
  assert.equal(lastStatus(), 'disconnected');

  act(() => { vi.advanceTimersByTime(3000); });
  act(() => socket(1).serverOpens());
  assert.equal(lastStatus(), 'connected');
});

test('a token refresh swaps the socket without ever reading as a lost connection', () => {
  const view = renderProvider();
  act(() => socket(0).serverOpens());

  AUTH.current = { ...AUTH.current, token: 'token-2' };
  view.rerender(<WebSocketProvider><RecordStatus /></WebSocketProvider>);

  assert.equal(FakeWebSocket.instances.length, 2, 'the refreshed token opened a new socket');
  assert.equal(socket(0).readyState, FakeWebSocket.CLOSED, 'the old-token socket was closed');
  assert.match(socket(1).url, /token=token-2/);
  // The new socket is still handshaking: not live yet, but not lost either.
  assert.equal(lastStatus(), 'connecting');
  assert.equal(isConnected, false);

  // No reconnect was scheduled for the socket closed on purpose.
  act(() => { vi.advanceTimersByTime(3000); });
  assert.equal(FakeWebSocket.instances.length, 2);

  act(() => socket(1).serverOpens());
  assert.equal(lastStatus(), 'connected');
  assert.ok(!seen.includes('disconnected'), `statuses seen: ${seen.join(', ')}`);
});

test('signing out while the socket is down does not carry the drop into the next sign-in', () => {
  const view = renderProvider();
  act(() => socket(0).serverOpens());
  act(() => socket(0).serverDrops());
  assert.equal(lastStatus(), 'disconnected');

  // The session expires (or the user signs out) during the outage.
  AUTH.current = { user: null, token: null, isLoading: false };
  view.rerender(<WebSocketProvider><RecordStatus /></WebSocketProvider>);
  assert.equal(lastStatus(), 'connecting', 'no connection is lost while nobody is signed in');
  act(() => { vi.advanceTimersByTime(3000); });
  assert.equal(FakeWebSocket.instances.length, 1, 'no reconnect while signed out');

  // Signing in again starts a fresh handshake, which must not read as lost.
  seen = [];
  AUTH.current = { user: AUTH.user, token: 'token-2', isLoading: false };
  view.rerender(<WebSocketProvider><RecordStatus /></WebSocketProvider>);
  assert.equal(FakeWebSocket.instances.length, 2);
  assert.ok(!seen.includes('disconnected'), `statuses seen after sign-in: ${seen.join(', ')}`);
  assert.equal(lastStatus(), 'connecting');

  act(() => socket(1).serverOpens());
  assert.equal(lastStatus(), 'connected');
});

test('signing out while connected stops reporting a live connection', () => {
  const view = renderProvider();
  act(() => socket(0).serverOpens());
  assert.equal(isConnected, true);

  AUTH.current = { user: null, token: null, isLoading: false };
  view.rerender(<WebSocketProvider><RecordStatus /></WebSocketProvider>);
  assert.equal(socket(0).readyState, FakeWebSocket.CLOSED, 'the socket was closed on sign-out');
  assert.equal(lastStatus(), 'connecting');
  assert.equal(isConnected, false, 'isConnected no longer reports the closed socket as live');
});

test('retries back off while the server stays unreachable and cap at 30s', () => {
  renderProvider();
  act(() => socket(0).serverOpens());
  act(() => socket(0).serverDrops());

  const delays = [3000, 6000, 12_000, 24_000, 30_000, 30_000];
  delays.forEach((delay, index) => {
    act(() => { vi.advanceTimersByTime(delay - 1); });
    assert.equal(FakeWebSocket.instances.length, index + 1, `retried early, before ${delay}ms`);
    act(() => { vi.advanceTimersByTime(1); });
    assert.equal(FakeWebSocket.instances.length, index + 2, `did not retry after ${delay}ms`);
    act(() => socket(index + 1).serverDrops());
  });
});

test('a short switch away and back leaves a healthy socket alone', () => {
  renderProvider();
  act(() => socket(0).serverOpens());

  act(() => setVisibility('hidden'));
  act(() => { vi.advanceTimersByTime(1000); });
  act(() => setVisibility('visible'));

  assert.equal(FakeWebSocket.instances.length, 1, 'a live socket is reused');
  assert.equal(socket(0).readyState, FakeWebSocket.OPEN);
  assert.equal(lastStatus(), 'connected');
});

test('returning after a long background replaces the socket the heartbeat killed', () => {
  renderProvider();
  act(() => socket(0).serverOpens());

  act(() => setVisibility('hidden'));
  // Long enough for the server's two unanswered 30s pings to terminate it.
  act(() => { vi.advanceTimersByTime(70_000); });
  // WebKit still reports the frozen socket as open; the server has killed it.
  act(() => setVisibility('visible'));

  assert.equal(FakeWebSocket.instances.length, 2, 'resume started its own handshake');
  assert.equal(socket(0).readyState, FakeWebSocket.CLOSED, 'the dead socket was discarded');
  assert.equal(lastStatus(), 'connecting', 'the resume is handling the drop, not abandoning it');

  act(() => socket(1).serverOpens());
  assert.equal(lastStatus(), 'connected');
});

test('a close that only surfaces on resume retries at once instead of after the delay', () => {
  renderProvider();
  act(() => socket(0).serverOpens());

  act(() => setVisibility('hidden'));
  act(() => { vi.advanceTimersByTime(5000); });
  act(() => setVisibility('visible'));
  assert.equal(FakeWebSocket.instances.length, 1, 'the socket still looked open on resume');

  // The suspended socket's close is delivered right after the resume handler.
  act(() => socket(0).serverDrops());
  assert.equal(lastStatus(), 'disconnected');
  act(() => { vi.advanceTimersByTime(0); });
  assert.equal(FakeWebSocket.instances.length, 2, 'retried without serving the retry delay');
});

test('a socket that is down reconnects as soon as the network is back', () => {
  renderProvider();
  act(() => socket(0).serverOpens());
  act(() => socket(0).serverDrops());
  assert.equal(lastStatus(), 'disconnected');

  act(() => { window.dispatchEvent(new Event('online')); });

  assert.equal(FakeWebSocket.instances.length, 2, 'reconnected without waiting for the retry timer');
  act(() => socket(1).serverOpens());
  assert.equal(lastStatus(), 'connected');
});

test('a constructor that throws keeps retrying instead of freezing on disconnected', () => {
  let attempts = 0;
  vi.stubGlobal('WebSocket', class {
    constructor() {
      attempts += 1;
      throw new Error('unusable url');
    }
  });

  renderProvider();
  assert.equal(attempts, 1);

  act(() => { vi.advanceTimersByTime(3000); });
  assert.equal(attempts, 2, 'the failed constructor scheduled another attempt');
});
