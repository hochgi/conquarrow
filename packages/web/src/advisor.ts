/**
 * Decision-API advisor — the I/O leaf and its pure helpers (P72, ADR 0006).
 *
 * Before each BYOK completion the advisor ranks the same legal-move offer the
 * seat's model is about to see, in the System One format. The prompt then
 * shows each row's probability; the model still chooses. A failed call leaves
 * that completion unadvised. Adapter only — never referenced from the core.
 */

import type { PlayerId } from '@conquarrow/contracts';
import type { FetchLike } from './byokBot';
import type { AdvisorConfig, ByokConfig } from './byokConfig';
import { byokRelayRoute, isAdvisorReady, systemOneUrl } from './byokConfig';

/** System One `choice` cap: an offer with more rows is never sent. */
export const ADVISOR_MAX_OPTIONS = 255;

/** Per-call timeout (`AbortSignal.timeout`). */
export const ADVISOR_TIMEOUT_MS = 10_000;

/** Inserted as its own line directly after the `LEGAL_MOVES …` header on an advised prompt. */
export const ADVISOR_LEGEND =
  "advisor=p on a row is an independent decision model's probability that the row is the best next step. It is advice; you choose.";

export interface AdvisorChoiceQuestion {
  readonly type: 'choice';
  readonly instructions: string;
  /** `m0 … m<n−1>` → row text, inserted in index order. */
  readonly criteria: Readonly<Record<string, string>>;
}

/** The System One request body. No other fields. */
export interface AdvisorRequestBody {
  readonly model: string;
  readonly state: string;
  readonly questions: { readonly move: AdvisorChoiceQuestion };
}

export type AdvisorAnswer =
  | {
      readonly ok: true;
      /** The reply's top-level `model`, else the configured advisor model. */
      readonly model: string;
      /** Engine order, one per offer row; missing or non-finite reads as 0. */
      readonly probabilities: readonly number[];
      /** Argmax over the offer; ties to the lowest index. */
      readonly top: number;
    }
  | { readonly ok: false; readonly reason: string };

// ---------------------------------------------------------------- reading the plain prompt

const LEGAL_MOVES_HEADER = 'LEGAL_MOVES';
const OFFER_ROW = /^\[(\d+)\] /;

interface OfferRow {
  /** Position in the prompt's lines. */
  readonly line: number;
  /** The global offer index `i` of `[i]`. */
  readonly index: number;
}

interface PromptLayout {
  readonly lines: readonly string[];
  /** Line of the `LEGAL_MOVES …` header. */
  readonly header: number;
  /** The offer rows: the `[i] …` lines directly under the header, in prompt order. */
  readonly rows: readonly OfferRow[];
}

const layoutOf = (prompt: string): PromptLayout => {
  const lines = prompt.split('\n');
  const header = lines.findIndex((l) => l.startsWith(LEGAL_MOVES_HEADER));
  if (header < 0) throw new Error('advisor: prompt has no LEGAL_MOVES line');
  const rows: OfferRow[] = [];
  for (let line = header + 1; line < lines.length; line += 1) {
    const match = OFFER_ROW.exec(lines[line] ?? '');
    if (match?.[1] === undefined) break;
    rows.push({ line, index: Number(match[1]) });
  }
  return { lines, header, rows };
};

/** Row text by offer index: the row line without its `[i] ` prefix. */
const rowTextsOf = (layout: PromptLayout): ReadonlyMap<number, string> =>
  new Map(layout.rows.map((row) => [row.index, (layout.lines[row.line] ?? '').replace(OFFER_ROW, '')]));

/** The prompt up to, not including, the LEGAL_MOVES line, with no trailing blank line. */
const statePrefixOf = (layout: PromptLayout): string =>
  layout.lines.slice(0, layout.header).join('\n').replace(/\n+$/, '');

const optionName = (i: number): string => `m${String(i)}`;

// ---------------------------------------------------------------- the request

/** Build the one-question System One body for this completion's offer. */
export const advisorRequestBody = (
  advisor: AdvisorConfig,
  me: PlayerId,
  systemPrompt: string,
  plainPrompt: string,
  offerSize: number,
): AdvisorRequestBody => {
  const layout = layoutOf(plainPrompt);
  const texts = rowTextsOf(layout);
  const criteria: Record<string, string> = {};
  for (let i = 0; i < offerSize; i += 1) {
    const text = texts.get(i);
    if (text === undefined) throw new Error(`advisor: offer row [${String(i)}] missing from the prompt`);
    criteria[optionName(i)] = text;
  }
  const seat = String(me);
  return {
    model: advisor.model.trim(),
    state: `${systemPrompt}\n\n${statePrefixOf(layout)}`,
    questions: {
      move: {
        type: 'choice',
        instructions: `You are advising seat ${seat} in Conquarrow. Which single legal step should seat ${seat} play next to make the most progress toward winning?`,
        criteria,
      },
    },
  };
};

// ---------------------------------------------------------------- the reply

const REDACTED = '[redacted]';

/** Scrub both keys (advisor and seat) out of a reason before it leaves the leaf. */
const redactKeys = (byok: ByokConfig, reason: string): string =>
  [byok.advisor.apiKey, byok.apiKey]
    .flatMap((key) => [key, key.trim()])
    .filter((key) => key.length > 0)
    .reduce((out, key) => out.split(key).join(REDACTED), reason);

const objectAt = (value: unknown, key: string): Record<string, unknown> | undefined => {
  if (typeof value !== 'object' || value === null) return undefined;
  const next = (value as Record<string, unknown>)[key];
  return typeof next === 'object' && next !== null && !Array.isArray(next)
    ? (next as Record<string, unknown>)
    : undefined;
};

/** The argmax; ties go to the lowest index. */
const topOf = (probabilities: readonly number[]): number => {
  let top = 0;
  for (const [i, p] of probabilities.entries()) {
    if (p > (probabilities[top] ?? 0)) top = i;
  }
  return top;
};

/** Read `answers.move.probabilities` over the offer: `m<i>` if finite, else 0. */
const readAnswer = (byok: ByokConfig, body: unknown, offerSize: number): AdvisorAnswer => {
  const probs = objectAt(objectAt(objectAt(body, 'answers'), 'move'), 'probabilities');
  if (probs === undefined) return { ok: false, reason: 'missing answers.move.probabilities' };
  const probabilities: number[] = [];
  let usable = false;
  for (let i = 0; i < offerSize; i += 1) {
    const value = probs[optionName(i)];
    const finite = typeof value === 'number' && Number.isFinite(value);
    if (finite) usable = true;
    probabilities.push(finite ? value : 0);
  }
  if (!usable) return { ok: false, reason: 'no usable probabilities' };
  const replyModel = (body as Record<string, unknown>)['model'];
  return {
    ok: true,
    model: typeof replyModel === 'string' ? redactKeys(byok, replyModel) : byok.advisor.model.trim(),
    probabilities,
    top: topOf(probabilities),
  };
};

const postSystemOne = (byok: ByokConfig, body: AdvisorRequestBody, fetchImpl: FetchLike): Promise<Response> => {
  const { url, relayHeaders } = byokRelayRoute(byok, systemOneUrl(byok.advisor.baseUrl));
  return fetchImpl(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${byok.advisor.apiKey.trim()}`,
      ...relayHeaders,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(ADVISOR_TIMEOUT_MS),
  });
};

const exchange = async (
  byok: ByokConfig,
  body: AdvisorRequestBody,
  offerSize: number,
  fetchImpl: FetchLike,
): Promise<AdvisorAnswer> => {
  let response: Response;
  try {
    response = await postSystemOne(byok, body, fetchImpl);
  } catch (err) {
    return { ok: false, reason: `fetch failed: ${err instanceof Error ? err.message : 'network error'}` };
  }
  if (!response.ok) {
    return { ok: false, reason: `HTTP ${String(response.status)} from ${systemOneUrl(byok.advisor.baseUrl)}` };
  }
  let reply: unknown;
  try {
    reply = await response.json();
  } catch {
    return { ok: false, reason: 'response was not JSON' };
  }
  return readAnswer(byok, reply, offerSize);
};

/**
 * POST the body to the advisor's System One URL (via the seat's relay). Never
 * throws; a failure's reason never carries the advisor's or the seat's key.
 */
export const askAdvisor = async (
  byok: ByokConfig,
  body: AdvisorRequestBody,
  offerSize: number,
  fetchImpl: FetchLike,
): Promise<AdvisorAnswer> => {
  const answer = await exchange(byok, body, offerSize, fetchImpl);
  return answer.ok ? answer : { ok: false, reason: redactKeys(byok, answer.reason) };
};

// ---------------------------------------------------------------- one completion

/** What one completion needs to ask: the seat, its system prompt, its plain prompt and offer size. */
export interface AdvisorAsk {
  readonly me: PlayerId;
  readonly systemPrompt: string;
  readonly plainPrompt: string;
  readonly offerSize: number;
}

/**
 * Ask once for one completion. `undefined` when the advisor is not ready (off:
 * no call, no failure). An offer past {@link ADVISOR_MAX_OPTIONS} is a failure
 * with no call.
 */
export const adviseCompletion = (
  byok: ByokConfig,
  ask: AdvisorAsk,
  fetchImpl: FetchLike,
): Promise<AdvisorAnswer | undefined> => {
  if (!isAdvisorReady(byok.advisor)) return Promise.resolve(undefined);
  if (ask.offerSize > ADVISOR_MAX_OPTIONS) {
    return Promise.resolve({
      ok: false,
      reason: `offer too large (${String(ask.offerSize)} > ${String(ADVISOR_MAX_OPTIONS)})`,
    });
  }
  const body = advisorRequestBody(byok.advisor, ask.me, ask.systemPrompt, ask.plainPrompt, ask.offerSize);
  return askAdvisor(byok, body, ask.offerSize, fetchImpl);
};

// ---------------------------------------------------------------- the advised prompt

/** The plain prompt plus the legend line and ` advisor=<p.toFixed(2)>` on every offer row. */
export const adviseUserPrompt = (plainPrompt: string, probabilities: readonly number[]): string => {
  const layout = layoutOf(plainPrompt);
  const lines = [...layout.lines];
  for (const row of layout.rows) {
    lines[row.line] = `${lines[row.line] ?? ''} advisor=${(probabilities[row.index] ?? 0).toFixed(2)}`;
  }
  lines.splice(layout.header + 1, 0, ADVISOR_LEGEND);
  return lines.join('\n');
};
