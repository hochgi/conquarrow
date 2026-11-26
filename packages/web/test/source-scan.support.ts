/**
 * Where source-scan tests read from.
 *
 * A scan reads a `src` file as text. Inside a Stryker sandbox
 * (`.stryker-tmp/sandbox-*`) that file is the instrumented copy, whose
 * preamble trips scans such as "no `.apply(`". Mapping the sandbox path back
 * to the working tree makes every scan read the committed source, in and out
 * of a mutation run. Behavioural tests are unaffected: they import the
 * instrumented modules as usual.
 */

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The directory of `url`, outside any Stryker sandbox. */
export const committedDir = (url: string): string =>
  dirname(fileURLToPath(url)).replace(/[\\/]\.stryker-tmp[\\/]sandbox-[^\\/]+/, '');
