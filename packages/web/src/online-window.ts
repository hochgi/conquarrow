/**
 * Browser facades for the P19/P25 host: `location`, the token cache, `fetch`,
 * and `WebSocket`. Tests inject fakes instead.
 *
 * @see docs/spec/online-shell/online-shell.md
 */

import type {
  OnlinePagesEnv,
  OnlinePagesFetch,
  OnlinePagesLocation,
  OnlinePagesOpenSocket,
  OnlinePagesSession,
} from '@conquarrow/contracts';

export const envFromVite = (): OnlinePagesEnv => ({
  VITE_API_BASE: import.meta.env.VITE_API_BASE ?? '',
  VITE_WS_URL: import.meta.env.VITE_WS_URL ?? '',
  VITE_GOOGLE_CLIENT_ID: import.meta.env.VITE_GOOGLE_CLIENT_ID ?? '',
});

/** P95 D12: the token is a cache in localStorage; the server stays the truth. */
export const browserSession = (): OnlinePagesSession => localStorage;

export const browserLocation = (): OnlinePagesLocation => ({
  get origin() {
    return window.location.origin;
  },
  get pathname() {
    return window.location.pathname;
  },
  get hash() {
    return window.location.hash;
  },
  set hash(value: string) {
    window.location.hash = value;
  },
});

export const browserFetch: OnlinePagesFetch = async (request) => {
  const init: RequestInit = { method: request.method, headers: { ...request.headers } };
  if (request.body !== undefined) init.body = request.body;
  const res = await fetch(request.url, init);
  return { status: res.status, body: await res.text() };
};

export const browserOpenSocket = (
  onMessage: (raw: string) => void,
): OnlinePagesOpenSocket => {
  return (url, events) => {
    const socket = new WebSocket(url);
    socket.addEventListener('message', (event) => {
      if (typeof event.data === 'string') onMessage(event.data);
    });
    // P95 D11: the adapter forgets a closed socket, and the next poll reopens it.
    socket.addEventListener('close', () => {
      events.onClose();
    });
    return {
      url,
      close: () => {
        socket.close();
      },
      send: (text) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(text);
      },
    };
  };
};
