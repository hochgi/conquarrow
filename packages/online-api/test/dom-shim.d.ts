/**
 * Names `byokBot.ts` uses, so the observe test can import the web prompt
 * without giving online-api the DOM lib. Not a browser.
 */

interface Storage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  readonly length: number;
  key(index: number): string | null;
  clear(): void;
}

declare const localStorage: Storage;
declare const sessionStorage: Storage;

interface RequestInit {
  readonly method?: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

interface Response {
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}

declare function fetch(input: string, init?: RequestInit): Promise<Response>;

interface ImportMeta {
  readonly env: {
    readonly DEV?: boolean;
    readonly VITE_BYOK_PROXY?: string;
  };
}

declare module 'docs/byok-teaching.md?raw' {
  const body: string;
  export default body;
}
