/**
 * Minimal Node module shapes so online-api tests typecheck without @types/node
 * (which would leak `process` / `crypto` globals into the pure packages).
 */

declare module 'node:crypto' {
  interface Hash {
    update(data: string, encoding: 'utf8'): Hash;
    digest(encoding: 'hex'): string;
  }
  export function createHash(algorithm: 'sha256'): Hash;
  export function randomBytes(size: number): Uint8Array;
}

declare module 'node:process' {
  export const env: { readonly [key: string]: string | undefined };
}

declare module 'node:fs' {
  export function readFileSync(path: string, encoding: 'utf8'): string;
  export function existsSync(path: string): boolean;
  export function readdirSync(path: string): string[];
}

declare module 'node:path' {
  export function dirname(p: string): string;
  export function resolve(...paths: string[]): string;
}

declare module 'node:url' {
  export function fileURLToPath(url: string): string;
}
