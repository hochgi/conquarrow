/**
 * Results files: `<tier>-<arm-sha>-<mode>-<model>[-<tag>].json` under
 * `packages/web/bench/results/` (gitignored). No prompt text, and the key is
 * redacted from the serialized body as the last thing before it is written.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ResultName {
  readonly tier: string;
  readonly sha: string;
  readonly dirty: boolean;
  readonly mode: string;
  readonly model: string;
  readonly tag: string | undefined;
}

const slug = (text: string): string => text.replace(/[^A-Za-z0-9._-]+/g, '_');

export const resultFileName = (name: ResultName): string => {
  const sha = name.dirty ? `${name.sha}-dirty` : name.sha;
  const tag = name.tag === undefined ? '' : `-${slug(name.tag)}`;
  return `${[name.tier, sha, name.mode, slug(name.model)].join('-')}${tag}.json`;
};

export const resultExists = (dir: string, file: string): boolean => existsSync(join(dir, file));

export const writeResult = (
  dir: string,
  file: string,
  body: unknown,
  redact: (text: string) => string,
): string => {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, file);
  writeFileSync(path, `${redact(JSON.stringify(body, null, 2))}\n`, { flag: 'wx' });
  return path;
};

export interface Calibration {
  readonly file: string;
  readonly jobs: number;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly calls: number;
  readonly usd: number;
}

const calibrationOf = (file: string, raw: unknown): (Calibration & { readonly at: string }) | undefined => {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const rec = raw as Record<string, unknown>;
  const cost = rec['cost'];
  const jobs = rec['jobsRun'];
  const at = rec['finishedAt'];
  if (typeof cost !== 'object' || cost === null || typeof jobs !== 'number' || jobs === 0 || typeof at !== 'string') {
    return undefined;
  }
  const totals = cost as Record<string, unknown>;
  const num = (key: string): number => (typeof totals[key] === 'number' ? totals[key] : 0);
  return {
    file,
    jobs,
    promptTokens: num('promptTokens'),
    completionTokens: num('completionTokens'),
    calls: num('calls'),
    usd: num('usd'),
    at,
  };
};

/** The newest earlier run of this tier, mode and model, by its recorded finish time. */
export const latestCalibration = (
  dir: string,
  tier: string,
  mode: string,
  model: string,
): Calibration | undefined => {
  if (!existsSync(dir)) return undefined;
  const suffix = `-${mode}-${slug(model)}`;
  let best: (Calibration & { readonly at: string }) | undefined;
  for (const file of readdirSync(dir).toSorted()) {
    if (!file.startsWith(`${tier}-`) || !file.endsWith('.json') || !file.includes(suffix)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(readFileSync(join(dir, file), 'utf8'));
    } catch {
      continue;
    }
    const found = calibrationOf(file, parsed);
    if (found !== undefined && (best === undefined || found.at > best.at)) best = found;
  }
  return best;
};
