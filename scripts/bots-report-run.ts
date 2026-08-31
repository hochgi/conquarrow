/**
 * Advisory `pnpm bots` runner. Not a search module — wires geometry + rules
 * into `collectBotsReport`.
 */
import { makeMatch, makeTiling } from '@conquarrow/geometry-tiling';
import { makeRules } from '@conquarrow/rules-core';
import {
  BOTS_MATCH_CONFIG,
  BOTS_SEEDS,
  collectBotsReport,
  formatBotsReport,
} from '../packages/web/src/botReport.ts';

const geometry = makeTiling();
const rules = makeRules(geometry);
const openings = BOTS_SEEDS.map((spawnerSeed) =>
  makeMatch({ ...BOTS_MATCH_CONFIG, spawnerSeed }),
);
const rows = collectBotsReport(geometry, rules, openings);
console.log(formatBotsReport(rows));
