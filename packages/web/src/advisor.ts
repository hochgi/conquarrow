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

/** Build the one-question System One body for this completion's offer. */
export const advisorRequestBody = (
  _advisor: AdvisorConfig,
  _me: PlayerId,
  _systemPrompt: string,
  _plainPrompt: string,
  _offerSize: number,
): AdvisorRequestBody => {
  throw new Error('not implemented: advisorRequestBody (P72)');
};

/** POST the body to the advisor's System One URL (via the seat's relay). Never throws. */
export const askAdvisor = (
  _byok: ByokConfig,
  _body: AdvisorRequestBody,
  _offerSize: number,
  _fetchImpl: FetchLike,
): Promise<AdvisorAnswer> => Promise.reject(new Error('not implemented: askAdvisor (P72)'));

/** The plain prompt plus the legend line and ` advisor=<p.toFixed(2)>` on every offer row. */
export const adviseUserPrompt = (_plainPrompt: string, _probabilities: readonly number[]): string => {
  throw new Error('not implemented: adviseUserPrompt (P72)');
};
