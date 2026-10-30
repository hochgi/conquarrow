/**
 * The bench's HTTP leaf around the injected `FetchLike` (P79 hygiene).
 *
 * Two thin wrappers and a redactor — no game logic, no prompt text:
 *
 * - `retryingFetch` retries a **transport** failure (HTTP 429 / 5xx, a thrown
 *   network error, a timeout) with backoff *before* `playLlmBotTurn` sees it, so
 *   a rate limit is not scored as a model fallback. A 200 whose body does not
 *   parse is the model's answer and is never retried here.
 * - `relayFetch` stands in for the Vite dev relay (`vite.byok-proxy.ts`). The
 *   adapter posts to `/__byok` with the real URL in `X-Arrows-Byok-Upstream`
 *   whenever `import.meta.env.DEV` holds, which it does under Vite's SSR loader
 *   and Vitest. Node has no relay to talk to, so this forwards the same request
 *   upstream — same body, same headers, minus the relay header — subject to the
 *   same allowlist.
 * - `redactor` scrubs the key out of anything the harness writes or prints.
 */

import type { FetchLike } from '../../src/byokBot';
import { BYOK_UPSTREAM_HEADER, isAllowedByokUpstream } from '../../src/byokConfig';

export interface TransportCounters {
  /** Completions `playLlmBotTurn` asked for — one per POST it made. */
  calls: number;
  /** Extra attempts the retry layer spent on transport failures. */
  retries: number;
}

export interface RetryOptions {
  readonly maxRetries: number;
  readonly baseDelayMs: number;
  /** Per attempt. A reasoning completion can run for minutes. */
  readonly timeoutMs: number;
  readonly sleep: (ms: number) => Promise<void>;
}

const MAX_DELAY_MS = 60_000;

export const isTransientStatus = (status: number): boolean => status === 429 || status >= 500;

const retryAfterMs = (response: Response | undefined): number => {
  const raw = response?.headers.get('retry-after') ?? null;
  if (raw === null) return 0;
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : 0;
};

const backoffMs = (options: RetryOptions, attempt: number, response?: Response): number =>
  Math.min(MAX_DELAY_MS, Math.max(options.baseDelayMs * 2 ** attempt, retryAfterMs(response)));

const withTimeout = (init: RequestInit | undefined, timeoutMs: number): RequestInit => {
  const timeout = AbortSignal.timeout(timeoutMs);
  const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
  return { ...init, signal };
};

const discard = async (response: Response): Promise<void> => {
  try {
    await response.body?.cancel();
  } catch {
    // The body is being thrown away; a failure to drain it changes nothing.
  }
};

export const retryingFetch =
  (base: FetchLike, options: RetryOptions, counters: TransportCounters): FetchLike =>
  async (input, init) => {
    for (let attempt = 0; ; attempt += 1) {
      const last = attempt >= options.maxRetries;
      let response: Response;
      try {
        response = await base(input, withTimeout(init, options.timeoutMs));
      } catch (err) {
        if (last) {
          counters.calls += 1;
          throw err;
        }
        counters.retries += 1;
        await options.sleep(backoffMs(options, attempt));
        continue;
      }
      if (!isTransientStatus(response.status) || last) {
        counters.calls += 1;
        return response;
      }
      await discard(response);
      counters.retries += 1;
      await options.sleep(backoffMs(options, attempt, response));
    }
  };

const isAbsolute = (url: string): boolean => /^https?:\/\//i.test(url);

export const relayFetch =
  (base: FetchLike): FetchLike =>
  (input, init) => {
    const headers = new Headers(init?.headers);
    const upstream = headers.get(BYOK_UPSTREAM_HEADER);
    headers.delete(BYOK_UPSTREAM_HEADER);
    const target = isAbsolute(input) ? input : upstream;
    if (target === null || !isAllowedByokUpstream(target)) {
      return Promise.reject(new Error('bench relay: no allowed upstream for this request'));
    }
    return base(target, { ...init, headers });
  };

export const REDACTED = '[redacted]';

/** Replace every occurrence of the key (as configured, and trimmed) with `[redacted]`. */
export const redactor = (secret: string): ((text: string) => string) => {
  const needles = [...new Set([secret, secret.trim()])].filter((s) => s.length > 0);
  return (text) => needles.reduce((out, needle) => out.split(needle).join(REDACTED), text);
};
