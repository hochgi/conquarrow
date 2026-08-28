/**
 * BYOK (bring-your-own-key) config for the optional LLM opponent.
 *
 * Persists in localStorage for the browser profile (playtest convenience).
 * Never written into match logs. Never sent to any arrows server (except an
 * optional pass-through proxy the player configures — key is only in the
 * Authorization header of that request).
 */

export const BYOK_STORAGE_KEY = 'conquarrow:byok';

/** Shown when a direct (no proxy) fetch fails — often CORS. ADR 0003. */
export const BYOK_CORS_HINT =
  'browser CORS — on Pages leave Proxy URL empty and use a CORS-ok host (x.ai, Groq, OpenRouter); api.openai.com often needs pnpm dev (/__byok) or a personal Proxy URL';

/** Hosts a same-origin / player-owned relay may forward to (SSRF guard). */
export const BYOK_UPSTREAM_ALLOWLIST: readonly string[] = [
  'api.openai.com',
  'openrouter.ai',
  'api.groq.com',
  'api.together.xyz',
  'api.fireworks.ai',
  'api.deepseek.com',
  'api.mistral.ai',
  'api.moonshot.cn',
  'generativelanguage.googleapis.com',
  // NVIDIA NIM (build.nvidia.com / integrate)
  'integrate.api.nvidia.com',
  'api.nvcf.nvidia.com',
  // xAI Grok
  'api.x.ai',
  // other OpenAI-compatible bases used in personal playtest
  'api.z.ai',
  'zenmux.ai',
  'api.valarhq.ai',
];

export const isAllowedByokUpstream = (urlString: string): boolean => {
  try {
    const url = new URL(urlString);
    const host = url.hostname.toLowerCase();
    const isLocal =
      host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
    // Local LiteLLM (and friends): http(s) on loopback only.
    if (isLocal) return url.protocol === 'http:' || url.protocol === 'https:';
    if (url.protocol !== 'https:') return false;
    if (BYOK_UPSTREAM_ALLOWLIST.includes(host)) return true;
    // Azure OpenAI: *.openai.azure.com
    if (host.endsWith('.openai.azure.com')) return true;
    // NVIDIA subdomains
    if (host.endsWith('.api.nvidia.com') || host.endsWith('.nvcf.nvidia.com')) return true;
    return false;
  } catch {
    return false;
  }
};

export interface ByokConfig {
  readonly enabled: boolean;
  /** OpenAI-compatible base, e.g. `https://api.openai.com/v1` (no trailing slash required). */
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  /**
   * Optional CORS relay. Empty = call `baseUrl` directly (works only if the
   * provider allows browser origins). Local Vite serves `/__byok` automatically
   * in dev when this is empty.
   */
  readonly proxyUrl: string;
  /**
   * Let reasoning models (Nemotron Ultra, etc.) think before answering.
   * Default true — turn off only for fast non-reasoning chat models.
   */
  readonly reasoning: boolean;
  /**
   * Route picks through the local turn runner (plan→commit→validate) instead
   * of a single chat/completions call. Experiment — see tools/byok-turn-runner.
   */
  readonly useTurnRunner: boolean;
  /** Empty under Vite → `/__turn`. Otherwise e.g. `http://127.0.0.1:4010`. */
  readonly turnRunnerUrl: string;
}

export const DEFAULT_BYOK: ByokConfig = {
  enabled: false,
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-4o-mini',
  proxyUrl: '',
  reasoning: true,
  useTurnRunner: false,
  turnRunnerUrl: '',
};

export const isByokReady = (config: ByokConfig): boolean =>
  config.enabled &&
  config.baseUrl.trim().length > 0 &&
  config.apiKey.trim().length > 0 &&
  config.model.trim().length > 0;

const readStore = (): Storage | undefined => {
  if (typeof localStorage !== 'undefined') return localStorage;
  if (typeof sessionStorage !== 'undefined') return sessionStorage;
  return undefined;
};

export const loadByokConfig = (): ByokConfig => {
  const store = readStore();
  if (store === undefined) return DEFAULT_BYOK;
  try {
    const raw = store.getItem(BYOK_STORAGE_KEY);
    if (raw === null || raw === '') return DEFAULT_BYOK;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return DEFAULT_BYOK;
    const o = parsed as Record<string, unknown>;
    return {
      enabled: o['enabled'] === true,
      baseUrl: typeof o['baseUrl'] === 'string' ? o['baseUrl'] : DEFAULT_BYOK.baseUrl,
      apiKey: typeof o['apiKey'] === 'string' ? o['apiKey'] : '',
      model: typeof o['model'] === 'string' ? o['model'] : DEFAULT_BYOK.model,
      proxyUrl: typeof o['proxyUrl'] === 'string' ? o['proxyUrl'] : '',
      // Default on: absence means reasoning (older saves).
      reasoning: o['reasoning'] !== false,
      useTurnRunner: o['useTurnRunner'] === true,
      turnRunnerUrl: typeof o['turnRunnerUrl'] === 'string' ? o['turnRunnerUrl'] : '',
    };
  } catch {
    return DEFAULT_BYOK;
  }
};

export const saveByokConfig = (config: ByokConfig): void => {
  const store = readStore();
  if (store === undefined) return;
  store.setItem(BYOK_STORAGE_KEY, JSON.stringify(config));
};

/** Normalize so `${base}/chat/completions` is well-formed. */
export const chatCompletionsUrl = (baseUrl: string): string => {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  return `${trimmed}/chat/completions`;
};

/**
 * Where the browser actually POSTs.
 * - explicit `proxyUrl` wins
 * - else `VITE_BYOK_PROXY` from build env
 * - else `/__byok` under Vite dev (same-origin middleware)
 * - else '' → call upstream directly (CORS may fail)
 */
export const resolveByokProxyUrl = (config: ByokConfig): string => {
  const fromConfig = config.proxyUrl.trim();
  if (fromConfig.length > 0) return fromConfig;
  const envProxy = import.meta.env.VITE_BYOK_PROXY;
  if (typeof envProxy === 'string' && envProxy.trim().length > 0) return envProxy.trim();
  if (import.meta.env.DEV) return '/__byok';
  return '';
};

/**
 * Base URL for the local turn runner (no trailing slash).
 * Empty when the seat is not using the runner.
 */
export const resolveTurnRunnerUrl = (config: ByokConfig): string => {
  if (!config.useTurnRunner) return '';
  const fromConfig = config.turnRunnerUrl.trim().replace(/\/+$/, '');
  if (fromConfig.length > 0) return fromConfig;
  if (import.meta.env.DEV) return '/__turn';
  return 'http://127.0.0.1:4010';
};

export const BYOK_UPSTREAM_HEADER = 'X-Arrows-Byok-Upstream';
