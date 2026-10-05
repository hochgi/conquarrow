/**
 * docs/spec/online-edge-probes/online-edge-probes.md § Invariants 1–6.
 *
 * 1–3 run the real store over the probed S3 (1 also against `mapStore`).
 * 4–6 are repository policy, read off disk the way `infra.test.ts` does.
 * 7 [LINT] is not a Vitest property — the reviewer verifies it with a
 * throwaway import (typed lint needs a tsconfig a synthetic file is not in).
 *
 * No randomness: invariant 1's catalogue is fixed, so a failure names the
 * script that drifted and replays identically.
 */

import { GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { ObjectPutOptions, ObjectStore } from '../src/create-online-api';
import { isPreconditionFailed } from '../src/api-types';
import { PreconditionFailed } from '../src/create-online-api';
import { mapStore } from './support';
import {
  ASTRAL,
  HIGH_BMP,
  type EdgeRig,
  createEdgeRig,
  rejectionOf,
  s3Error,
  seedBacking,
  utf16Order,
} from './online-edge-probes.support';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

const withEdgeRig = async (body: (edge: EdgeRig) => Promise<void>): Promise<void> => {
  const edge = createEdgeRig();
  try {
    await body(edge);
  } finally {
    await edge.close();
  }
};

// ── 1 [EQUIV] ──────────────────────────────────────────────────────────────

type Op =
  | { readonly op: 'get'; readonly key: string }
  | {
      readonly op: 'put';
      readonly key: string;
      readonly body: string;
      readonly options?: ObjectPutOptions;
    }
  | { readonly op: 'delete'; readonly key: string }
  | { readonly op: 'list'; readonly prefix: string };

type Outcome =
  | { readonly op: 'get'; readonly value: string | undefined }
  | { readonly op: 'put'; readonly result: 'ok' | 'PreconditionFailed' }
  | { readonly op: 'delete' }
  | { readonly op: 'list'; readonly keys: readonly string[] };

const get = (key: string): Op => ({ op: 'get', key });
const put = (key: string, body: string, options?: ObjectPutOptions): Op =>
  options === undefined ? { op: 'put', key, body } : { op: 'put', key, body, options };
const del = (key: string): Op => ({ op: 'delete', key });
const list = (prefix: string): Op => ({ op: 'list', prefix });

const runOp = async (store: ObjectStore, op: Op): Promise<Outcome> => {
  switch (op.op) {
    case 'get':
      return { op: 'get', value: await store.get(op.key) };
    case 'put':
      try {
        await store.put(op.key, op.body, op.options);
        return { op: 'put', result: 'ok' };
      } catch (error: unknown) {
        if (isPreconditionFailed(error)) return { op: 'put', result: 'PreconditionFailed' };
        throw error;
      }
    case 'delete':
      await store.delete(op.key);
      return { op: 'delete' };
    case 'list':
      return { op: 'list', keys: [...(await store.listPrefix(op.prefix))] };
  }
};

const runScript = async (store: ObjectStore, ops: readonly Op[]): Promise<readonly Outcome[]> => {
  const outcomes: Outcome[] = [];
  for (const op of ops) outcomes.push(await runOp(store, op));
  return outcomes;
};

const A = 'conquarrow/a';
const B = 'conquarrow/b';
const P = 'conquarrow/p/';
const UNICODE_BODY = `{"n":"${HIGH_BMP}${ASTRAL}é"}`;

/** The fixed catalogue. Each script runs on an empty store. */
const CATALOGUE: readonly { readonly name: string; readonly ops: readonly Op[] }[] = [
  { name: 'plain put then get', ops: [put(A, '{"a":1}'), get(A)] },
  { name: 'get of a never-written key', ops: [get(A), get(B)] },
  { name: 'overwrite then get', ops: [put(A, 'one'), put(A, 'two'), get(A)] },
  {
    name: 'delete then get; delete of a missing key',
    ops: [put(A, 'x'), del(A), get(A), del(B), get(B)],
  },
  {
    name: 'create-only on absent, then on existing',
    ops: [
      put(A, 'first', { ifNoneMatch: '*' }),
      put(A, 'second', { ifNoneMatch: '*' }),
      get(A),
    ],
  },
  {
    name: 'create-only after a delete',
    ops: [put(A, 'x'), del(A), put(A, 'again', { ifNoneMatch: '*' }), get(A)],
  },
  {
    name: 'compare-and-swap with current, stale, then the new current',
    ops: [
      put(A, 'v0'),
      put(A, 'v1', { ifMatch: 'v0' }),
      put(A, 'v2', { ifMatch: 'v0' }),
      put(A, 'v2', { ifMatch: 'v1' }),
      get(A),
    ],
  },
  { name: 'compare-and-swap on an absent key', ops: [put(A, 'v1', { ifMatch: 'v0' }), get(A)] },
  {
    name: 'compare-and-swap against a body that differs only in case or whitespace',
    ops: [put(A, 'v0'), put(A, 'x', { ifMatch: 'V0' }), put(A, 'x', { ifMatch: 'v0 ' }), get(A)],
  },
  {
    name: 'empty body round-trips and swaps against empty',
    ops: [put(A, ''), get(A), put(A, 'filled', { ifMatch: '' }), get(A)],
  },
  {
    name: 'unicode body round-trips and swaps',
    ops: [put(A, UNICODE_BODY), put(A, 'ok', { ifMatch: UNICODE_BODY }), get(A)],
  },
  {
    name: 'listing: nested, sibling-prefix and outside keys',
    ops: [
      put(`${P}2`, '{}'),
      put(`${P}10`, '{}'),
      put(`${P}1`, '{}'),
      put(`${P}deep/x`, '{}'),
      put('conquarrow/p', '{}'),
      put('conquarrow/pq/1', '{}'),
      put(B, '{}'),
      list(P),
      list('conquarrow/'),
      list('conquarrow/none/'),
    ],
  },
  {
    name: 'listing order where UTF-16 and UTF-8 disagree',
    ops: [put(`${P}${HIGH_BMP}`, '{}'), put(`${P}${ASTRAL}`, '{}'), put(`${P}z`, '{}'), list(P)],
  },
  {
    name: 'listing after deletes',
    ops: [put(`${P}1`, '{}'), put(`${P}2`, '{}'), del(`${P}1`), list(P), del(`${P}2`), list(P)],
  },
];

// ── 2 [LIST] ───────────────────────────────────────────────────────────────

const LIST_SIZES = [0, 1, 999, 1000, 1001, 2000, 2001] as const;
const PAGE_CAP = 1000;

/**
 * `n` keys under `prefix`. Each consecutive pair shares a stem and ends in one
 * HIGH_BMP and one ASTRAL character, so the backing's UTF-8 page order and
 * `compareStrings`' UTF-16 order disagree — the store's own sort is observable.
 */
const divergentKeysUnder = (prefix: string, n: number): readonly string[] =>
  Array.from(
    { length: n },
    (_, i) => `${prefix}${String(Math.floor(i / 2))}${i % 2 === 0 ? HIGH_BMP : ASTRAL}`,
  );

const OUTSIDE_P = ['conquarrow/p', 'conquarrow/pp/1', 'conquarrow/o/1', 'conquarrow/q/1'];

// ── 4–6: manifests and hooks ───────────────────────────────────────────────

const TEST_KIT = /^@(hochgi|vnatures)\/test-kit/;

type Manifest = {
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly devDependencies?: Readonly<Record<string, string>>;
  readonly peerDependencies?: Readonly<Record<string, string>>;
  readonly optionalDependencies?: Readonly<Record<string, string>>;
};

const readManifest = (relative: string): Manifest =>
  JSON.parse(readFileSync(resolve(root, relative), 'utf8')) as Manifest;

const testKitNames = (section: Readonly<Record<string, string>> | undefined): readonly string[] =>
  Object.keys(section ?? {})
    .filter((name) => TEST_KIT.test(name))
    .sort(utf16Order);

const workspacePackages = (): readonly string[] =>
  readdirSync(resolve(root, 'packages'))
    .filter((name) => existsSync(resolve(root, 'packages', name, 'package.json')))
    .sort(utf16Order);

const PURE_FIXED = ['contracts', 'rules-core'] as const;

const purePackages = (): readonly string[] => [
  ...PURE_FIXED,
  ...workspacePackages().filter((name) => name.startsWith('geometry-')),
];

/** The `pre-push:` block of lefthook.yml — up to the next top-level key. */
const prePushBlock = (yaml: string): readonly string[] => {
  const lines = yaml.split('\n');
  const start = lines.findIndex((line) => /^pre-push:\s*$/.test(line));
  if (start < 0) return [];
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^\S/.test(line) && !line.startsWith('#'));
  return end < 0 ? rest : rest.slice(0, end);
};

describe('online-edge-probes — invariants', () => {
  describe('1 [EQUIV] real store over probed S3 ≡ map store', () => {
    it.each(CATALOGUE)('$name', async ({ ops }) => {
      const expected = await runScript(mapStore(new Map<string, string>()), ops);
      await withEdgeRig(async (edge) => {
        expect(await runScript(edge.store, ops)).toEqual(expected);
      });
    });
  });

  describe('2 [LIST] every key under the prefix, sorted, in ⌈n / 1000⌉ calls', () => {
    it.each(LIST_SIZES)('n = %i', async (n) => {
      await withEdgeRig(async (edge) => {
        const under = divergentKeysUnder(P, n);
        await seedBacking(edge, [...under, ...OUTSIDE_P].map((key) => [key, '{}'] as const));

        const result = await edge.store.listPrefix(P);

        expect(result).toEqual([...under].sort(utf16Order));
        const calls = n === 0 ? 1 : Math.ceil(n / PAGE_CAP);
        edge.s3.probe.command('ListObjectsV2Command').expect.calledTimes(calls);
      });
    });
  });

  describe('3 [NO-PUT] a failed ifMatch comparison sends no PutObject', () => {
    const K = 'conquarrow/k1';
    const cases: readonly {
      readonly name: string;
      readonly seeded: string | undefined;
      readonly ifMatch: string;
      readonly bare404?: true;
    }[] = [
      { name: 'absent key', seeded: undefined, ifMatch: 'v0' },
      {
        name: 'absent key, read answered by a bare 404',
        seeded: undefined,
        ifMatch: 'v0',
        bare404: true,
      },
      { name: 'stale body', seeded: 'v0', ifMatch: 'v1' },
      { name: 'empty ifMatch against a body', seeded: 'v0', ifMatch: '' },
      { name: 'body differing in case', seeded: 'v0', ifMatch: 'V0' },
      { name: 'body differing in trailing whitespace', seeded: 'v0', ifMatch: 'v0 ' },
      { name: 'the ETag string instead of the body', seeded: 'v0', ifMatch: 'ETAG' },
    ];

    it.each(cases)('$name', async ({ seeded, ifMatch, bare404 }) => {
      await withEdgeRig(async (edge) => {
        const etags = await seedBacking(edge, seeded === undefined ? [] : [[K, seeded]]);
        if (bare404 === true) {
          edge.s3.probe.command(GetObjectCommand).once().reject(s3Error('NotFound', 404));
        }
        const match = ifMatch === 'ETAG' ? (etags.get(K) ?? 'no-etag') : ifMatch;

        const reason = await rejectionOf(
          Promise.resolve(edge.store.put(K, 'next', { ifMatch: match })),
        );

        expect(reason).toBeInstanceOf(PreconditionFailed);
        edge.s3.probe.command(GetObjectCommand).expect.calledTimes(1);
        edge.s3.probe.command(PutObjectCommand).expect.neverCalled();
      });
    });
  });

  describe('4 [CORE-CLEAN] no pure package names test-kit', () => {
    it.each(purePackages())('packages/%s', (name) => {
      const manifest = readManifest(`packages/${name}/package.json`);
      expect(testKitNames(manifest.dependencies)).toEqual([]);
      expect(testKitNames(manifest.devDependencies)).toEqual([]);
      expect(testKitNames(manifest.peerDependencies)).toEqual([]);
    });

    it('the geometry packages are enumerated from the directory', () => {
      const geometry = purePackages().filter((name) => name.startsWith('geometry-'));
      expect(geometry.length).toBeGreaterThan(0);
    });
  });

  describe('5 [DEV-ONLY] test-kit is only ever a devDependency', () => {
    const manifests = [
      'package.json',
      ...workspacePackages().map((name) => `packages/${name}/package.json`),
    ];

    it.each(manifests)('%s', (relative) => {
      const manifest = readManifest(relative);
      expect(testKitNames(manifest.dependencies)).toEqual([]);
      expect(testKitNames(manifest.peerDependencies)).toEqual([]);
      expect(testKitNames(manifest.optionalDependencies)).toEqual([]);
    });

    it('online-api names all three test-kit packages, under devDependencies', () => {
      const manifest = readManifest('packages/online-api/package.json');
      expect(testKitNames(manifest.devDependencies)).toEqual([
        '@hochgi/test-kit',
        '@hochgi/test-kit-mock',
        '@hochgi/test-kit-s3',
      ]);
    });
  });

  describe('6 [HOOK] pre-push runs pnpm verify and nothing else', () => {
    it('the pre-push hook runs exactly `pnpm verify`', () => {
      const block = prePushBlock(readFileSync(resolve(root, 'lefthook.yml'), 'utf8'));
      const runs = block
        .map((line) => /^\s+run:\s*(.+?)\s*$/.exec(line)?.[1])
        .filter((run): run is string => run !== undefined);
      expect(runs).toEqual(['pnpm verify']);
      expect(block.some((line) => /^\s+scripts:\s*$/.test(line))).toBe(false);
    });

    it('scripts/check-local-hygiene.sh does not exist', () => {
      expect(existsSync(resolve(root, 'scripts/check-local-hygiene.sh'))).toBe(false);
    });
  });
});
