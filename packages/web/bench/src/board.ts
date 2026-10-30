/**
 * The bench's composition of the board — the same two factories `App.tsx`
 * composes: the generated tiling behind `GeometryPort`, and the pure engine.
 */

import type { GeometryPort, RulesPort } from '@conquarrow/contracts';
import { makeTiling } from '@conquarrow/geometry-tiling';
import { makeRules } from '@conquarrow/rules-core';

export const geometry: GeometryPort = makeTiling();
export const rules: RulesPort = makeRules(geometry);
