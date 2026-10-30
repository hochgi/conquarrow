/**
 * P79 harness test support. Every model here is a scripted `FetchLike`:
 * no network, no key, no real model call.
 */

import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FetchLike } from '../../src/byokBot';
import type { ModelAccess } from '../src/seat';
import type { RetryOptions } from '../src/transport';

/** A key-shaped secret the harness must never write or print. */
export const SECRET_KEY = 'xai-P79-SECRET-do-not-leak-4f1c9e';

export const access: ModelAccess = {
  baseUrl: 'https://api.x.ai/v1',
  model: 'grok-scripted',
  apiKey: SECRET_KEY,
};

export const noSleep = (): Promise<void> => Promise.resolve();

export const fastRetry: RetryOptions = {
  maxRetries: 3,
  baseDelayMs: 1,
  timeoutMs: 60_000,
  sleep: noSleep,
};

export interface CapturedCall {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly system: string;
  readonly user: string;
}

export interface ContentStep {
  readonly content: string;
  readonly promptTokens?: number;
  readonly completionTokens?: number;
  /** Replaces the whole `usage` object when given. */
  readonly usage?: unknown;
}

export type ScriptStep =
  | ContentStep
  | { readonly status: number }
  | { readonly error: Error };

export type Script = (call: CapturedCall, index: number) => ScriptStep;

const headerRecord = (init: RequestInit | undefined): Record<string, string> => {
  const out: Record<string, string> = {};
  new Headers(init?.headers).forEach((value, key) => {
    out[key] = value;
  });
  return out;
};

const messageOf = (body: unknown, role: string): string => {
  if (typeof body !== 'object' || body === null) return '';
  const messages = (body as Record<string, unknown>)['messages'];
  if (!Array.isArray(messages)) return '';
  for (const item of messages) {
    if (typeof item !== 'object' || item === null) continue;
    const row = item as Record<string, unknown>;
    if (row['role'] === role && typeof row['content'] === 'string') return row['content'];
  }
  return '';
};

const completion = (step: ContentStep): Response =>
  new Response(
    JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content: step.content } }],
      usage: step.usage ?? {
        prompt_tokens: step.promptTokens ?? 1000,
        completion_tokens: step.completionTokens ?? 10,
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );

export interface ScriptedModel {
  readonly fetch: FetchLike;
  readonly calls: CapturedCall[];
}

export const scriptedModel = (script: Script): ScriptedModel => {
  const calls: CapturedCall[] = [];
  const fetch: FetchLike = (url, init) => {
    const raw = init?.body;
    const body: unknown = typeof raw === 'string' ? JSON.parse(raw) : undefined;
    const call: CapturedCall = {
      url,
      headers: headerRecord(init),
      system: messageOf(body, 'system'),
      user: messageOf(body, 'user'),
    };
    const index = calls.length;
    calls.push(call);
    const step = script(call, index);
    if ('error' in step) return Promise.reject(step.error);
    if ('status' in step) {
      return Promise.resolve(new Response(JSON.stringify({ error: 'scripted' }), { status: step.status }));
    }
    return Promise.resolve(completion(step));
  };
  return { fetch, calls };
};

export const batch = (moves: readonly number[], endTurn: boolean, plan?: string): string =>
  JSON.stringify({ moves, endTurn, why: 'scripted', ...(plan === undefined ? {} : { plan }) });

/** Play offer row 0, then end the turn. Always parses. */
export const firstRowModel = (plan?: string): ScriptedModel =>
  scriptedModel(() => ({ content: batch([0], true, plan) }));

export const unparseableModel = (): ScriptedModel =>
  scriptedModel(() => ({ content: 'I would like to think about this some more.' }));

/** `Seat X.` — the first line of the BYOK user prompt names the seat to move. */
export const seatNamedIn = (user: string): string | undefined =>
  /^Seat (\S+)\./.exec(user)?.[1];

export const tempDir = (): string => mkdtempSync(join(tmpdir(), 'p79-bench-'));

export const filesUnder = (dir: string): readonly string[] =>
  readdirSync(dir).map((name) => readFileSync(join(dir, name), 'utf8'));
