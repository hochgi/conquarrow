/**
 * Reply parser (P92). One parser. Does not apply a move.
 *
 * @see docs/spec/remote-agent-mcp/remote-agent-mcp.md
 */

/** A parsed reply. Indices are offer rows, not moves the parser applied. */
export interface ParsedReply {
  readonly moves: readonly number[];
  readonly endTurn: boolean;
  readonly why?: string;
  readonly plan?: string;
}

export interface ParsedMoveBatch {
  readonly indices: readonly number[];
  readonly endTurn: boolean;
}

const stripMarkdownFence = (text: string): string => {
  const trimmed = text.trim();
  const lines = trimmed.split(/\r?\n/);
  if (lines.length < 2) return trimmed;
  const first = lines[0]?.trim() ?? '';
  const last = lines[lines.length - 1]?.trim() ?? '';
  if (!/^```(?:json)?$/i.test(first) || last !== '```') return trimmed;
  return lines.slice(1, -1).join('\n').trim();
};

const integerIndices = (moves: unknown): number[] | undefined => {
  if (!Array.isArray(moves)) return undefined;
  const indices: number[] = [];
  for (const entry of moves) {
    if (typeof entry !== 'number' || !Number.isInteger(entry)) return undefined;
    indices.push(entry);
  }
  return indices;
};

export const asUsableBatch = (value: unknown): ParsedMoveBatch | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const rec = value as Record<string, unknown>;
  if (typeof rec['endTurn'] !== 'boolean') return undefined;
  const indices = integerIndices(rec['moves']);
  if (indices === undefined) return undefined;
  return { indices, endTurn: rec['endTurn'] };
};

const tryJsonParse = (text: string): unknown => {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
};

/** Brace-depth walk; `{` inside strings/escapes is not a start. Nested objects included. */
const collectJsonObjectSlices = (text: string): string[] => {
  const slices: string[] = [];
  const starts: number[] = [];
  let inString = false;
  let escape = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === '\\') {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === '{') {
      starts.push(i);
      continue;
    }
    if (ch === '}') {
      const start = starts.pop();
      if (start === undefined) continue;
      slices.push(text.slice(start, i + 1));
    }
  }
  return slices;
};

export interface ParsedBatchResult {
  readonly batch: ParsedMoveBatch;
  readonly salvaged: boolean;
  readonly plan: unknown;
  readonly why?: string;
}

const recordOf = (value: unknown): Record<string, unknown> | undefined => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
};

const planKeyOf = (value: unknown): unknown => recordOf(value)?.['plan'];

const whyOf = (value: unknown): string | undefined => {
  const why = recordOf(value)?.['why'];
  return typeof why === 'string' ? why : undefined;
};

const lastUsableFromSlices = (stripped: string): ParsedBatchResult | undefined => {
  const slices = collectJsonObjectSlices(stripped);
  for (let i = slices.length - 1; i >= 0; i -= 1) {
    const slice = slices[i];
    if (slice === undefined) continue;
    const value = tryJsonParse(slice);
    const batch = asUsableBatch(value);
    if (batch !== undefined) {
      const why = whyOf(value);
      return { batch, salvaged: true, plan: planKeyOf(value), ...(why === undefined ? {} : { why }) };
    }
  }
  return undefined;
};

/**
 * Live turn parse: usable batch JSON only. Whole-string first; else last usable
 * object from a brace walk. No digit harvest, no extract retry.
 */
export const parseMoveBatchResult = (text: string): ParsedBatchResult | undefined => {
  const stripped = stripMarkdownFence(text);
  const wholeValue = tryJsonParse(stripped);
  const whole = asUsableBatch(wholeValue);
  if (whole !== undefined) {
    const why = whyOf(wholeValue);
    return { batch: whole, salvaged: false, plan: planKeyOf(wholeValue), ...(why === undefined ? {} : { why }) };
  }
  return lastUsableFromSlices(stripped);
};

export const parseMoveBatch = (text: string): ParsedMoveBatch | undefined =>
  parseMoveBatchResult(text)?.batch;

/** Metadata only — never quote model content or reasoning_content. */
export const unusableReplyError = (text: string): string => {
  const stripped = stripMarkdownFence(text);
  return `unusable model reply (chars=${String(stripped.length)}, objects=${String(collectJsonObjectSlices(stripped).length)})`;
};
/** Parse a model reply, including a fenced or trailing JSON object. Does not apply it. */
export const parseReply = (text: string): ParsedReply | undefined => {
  const parsed = parseMoveBatchResult(text);
  if (parsed === undefined) return undefined;
  const plan = typeof parsed.plan === 'string' ? parsed.plan : undefined;
  return {
    moves: parsed.batch.indices,
    endTurn: parsed.batch.endTurn,
    ...(parsed.why === undefined ? {} : { why: parsed.why }),
    ...(plan === undefined ? {} : { plan }),
  };
};
