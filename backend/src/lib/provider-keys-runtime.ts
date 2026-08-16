/**
 * Which provider key is in force — the ONE place that decides.
 *
 * Two layers, one rule:
 *   - env: the values parsed from process.env at boot (config.ts hands them
 *     over via setEnvProviderKeys); a test that assigns `config.KIE_API_KEY`
 *     lands here through the config setter.
 *   - app: operator-supplied keys stored encrypted in provider_credentials,
 *     pushed here as a whole snapshot by lib/provider-credentials.ts (loaded
 *     at boot with a transport retry, refreshed on write and on a TTL).
 *   Precedence: ENV WINS. Declared configuration beats stored configuration;
 *   an app value fills in only where env is empty (decision 2026-08-16).
 *
 * `config.<PROVIDER>_KEY` reads resolve THROUGH this module (getters installed
 * by config.ts), and the setup screen's tile source is the same
 * resolveProviderKey() — so a call site and the UI can never disagree about
 * which key is live. Deliberately a leaf module: no imports, no I/O, so
 * config.ts can depend on it without a cycle.
 */

/**
 * Every provider key the backend knows — the Install-health tiles, in
 * order. nodaro.ai first (the one that needs no third-party account); the
 * last three were keys the backend required but the setup screen never
 * listed, so a keyless install failed AI Avatar / Relight & Switch / Web Scrape
 * with "add HEYGEN_API_KEY" without ever having said such a key exists.
 */
export const PROVIDER_KEY_IDS = [
  "nodaro",
  "kie",
  "replicate",
  "anthropic",
  "gemini",
  "elevenlabs",
  "fal",
  "heygen",
  "beeble",
  "apify",
] as const
export type ProviderKeyId = (typeof PROVIDER_KEY_IDS)[number]

/** Provider id -> the environment variable that carries its key. */
export const PROVIDER_KEY_ENV: Readonly<Record<ProviderKeyId, string>> = {
  nodaro: "NODARO_API_KEY",
  kie: "KIE_API_KEY",
  replicate: "REPLICATE_API_TOKEN",
  anthropic: "ANTHROPIC_API_KEY",
  gemini: "GEMINI_API_KEY",
  elevenlabs: "ELEVENLABS_API_KEY",
  fal: "FAL_KEY",
  heygen: "HEYGEN_API_KEY",
  beeble: "BEEBLE_API_KEY",
  apify: "APIFY_API_TOKEN",
}

export interface ProviderKeyMeta {
  readonly name: string
  /** Where the operator gets one. */
  readonly whereToGet: string
  /** What stops working without it — the honest tile subtitle. */
  readonly powers: string
  /**
   * Whether connecting nodaro.ai stands in for this key. The capability
   * router sends image / video / speech / LLM work through the cloud; the
   * vendor-direct nodes (HeyGen avatars, Beeble relight, Apify web scrape)
   * reach it through the job replay in providers/nodaro/run-on-cloud.ts and
   * the catalog relay in routes/heygen-catalog.ts. Only nodaro.ai itself is
   * not "covered" (it IS the connection). The setup banner ("one click
   * clears the N it covers") and the "own key needed" note derive from this.
   */
  readonly cloudCovered: boolean
  /**
   * How broad the key is: "core" keys unlock whole families of models
   * (the ones a fresh install reaches for); "node" keys exist for one or two
   * specific nodes (HeyGen → the avatar nodes, Beeble → Relight & Switch,
   * Apify → Web Scrape). The screens group by this so three niche keys do
   * not read as a general requirement.
   */
  readonly scope: "core" | "node"
}

export const PROVIDER_KEY_META: Readonly<Record<ProviderKeyId, ProviderKeyMeta>> = {
  nodaro: { name: "nodaro.ai", whereToGet: "app.nodaro.ai → Settings → API", powers: "every model, one account", cloudCovered: false, scope: "core" },
  kie: { name: "KIE.ai", whereToGet: "kie.ai", powers: "broadest media-model coverage", cloudCovered: true, scope: "core" },
  replicate: { name: "Replicate", whereToGet: "replicate.com", powers: "Flux 2 family, LoRA training", cloudCovered: true, scope: "core" },
  anthropic: { name: "Anthropic", whereToGet: "console.anthropic.com", powers: "Claude LLM nodes", cloudCovered: true, scope: "core" },
  gemini: { name: "Google Gemini", whereToGet: "aistudio.google.com", powers: "Gemini LLM + video analysis lane", cloudCovered: true, scope: "core" },
  elevenlabs: { name: "ElevenLabs", whereToGet: "elevenlabs.io", powers: "speech, voices, dubbing", cloudCovered: true, scope: "core" },
  fal: { name: "fal.ai", whereToGet: "fal.ai", powers: "fal-hosted models", cloudCovered: true, scope: "core" },
  heygen: { name: "HeyGen", whereToGet: "heygen.com", powers: "AI Avatar + Cinematic Avatar nodes", cloudCovered: true, scope: "node" },
  beeble: { name: "Beeble", whereToGet: "beeble.ai", powers: "Relight & Switch node (SwitchX)", cloudCovered: true, scope: "node" },
  apify: { name: "Apify", whereToGet: "apify.com", powers: "Web Scrape node (Google search, site crawl, Instagram/TikTok)", cloudCovered: true, scope: "node" },
}

export type ProviderKeySource = "env" | "app"

export interface ResolvedProviderKey {
  readonly value: string
  readonly source: ProviderKeySource
}

export function envVarFor(id: ProviderKeyId): string {
  return PROVIDER_KEY_ENV[id]
}

export function providerIdFor(envVar: string): ProviderKeyId | null {
  const hit = (Object.entries(PROVIDER_KEY_ENV) as Array<[ProviderKeyId, string]>).find(([, v]) => v === envVar)
  return hit ? hit[0] : null
}

/** A change listener may be async (registering a provider can be); a caller
 *  that applies a snapshot can await every listener through `applyAppSnapshot`. */
export type ProviderKeysListener = (changed: ReadonlyArray<ProviderKeyId>) => void | Promise<void>

let envKeys: Partial<Record<ProviderKeyId, string>> = {}
let appKeys: Partial<Record<ProviderKeyId, string>> = {}
const listeners = new Set<ProviderKeysListener>()

const present = (v: string | undefined): v is string => typeof v === "string" && v.trim().length > 0

export function resolveProviderKey(id: ProviderKeyId): ResolvedProviderKey | null {
  const env = envKeys[id]
  if (present(env)) return { value: env, source: "env" }
  const app = appKeys[id]
  if (present(app)) return { value: app, source: "app" }
  return null
}

function effective(): Record<ProviderKeyId, string | null> {
  const out = {} as Record<ProviderKeyId, string | null>
  for (const id of PROVIDER_KEY_IDS) out[id] = resolveProviderKey(id)?.value ?? null
  return out
}

interface Notified {
  readonly changed: ReadonlyArray<ProviderKeyId>
  /** Resolves once every listener has settled (a rejected listener is logged, not propagated). */
  readonly settled: Promise<void>
}

function notify(before: Record<ProviderKeyId, string | null>): Notified {
  const after = effective()
  const changed = PROVIDER_KEY_IDS.filter((id) => before[id] !== after[id])
  if (changed.length === 0) return { changed, settled: Promise.resolve() }
  const logFailure = (err: unknown): void => {
    console.error("[provider-keys] change listener failed:", err)
  }
  // Listeners run synchronously (a sync listener has taken effect when this
  // returns); only their async completion is collected.
  const results: Promise<void>[] = []
  for (const listener of listeners) {
    try {
      results.push(Promise.resolve(listener(changed)).catch(logFailure))
    } catch (err) {
      logFailure(err)
    }
  }
  return { changed, settled: Promise.all(results).then(() => undefined) }
}

/** Boot: the parsed environment values, all providers at once. */
export function setEnvProviderKeys(values: Partial<Record<ProviderKeyId, string>>): void {
  const before = effective()
  envKeys = { ...values }
  notify(before)
}

/** A single env-layer write (the config setter path). */
export function setEnvProviderKey(id: ProviderKeyId, value: string): void {
  const before = effective()
  envKeys = { ...envKeys, [id]: value }
  notify(before)
}

/** The app layer is replaced wholesale — a provider absent from the snapshot
 *  has no app-managed key (a cleared row disappears). Resolves, once every
 *  change listener has settled, with the ids whose effective value changed —
 *  so a caller can re-route the moment a late key is actually registered. */
export function applyAppSnapshot(values: Partial<Record<ProviderKeyId, string>>): Promise<ReadonlyArray<ProviderKeyId>> {
  const before = effective()
  appKeys = { ...values }
  const { changed, settled } = notify(before)
  return settled.then(() => changed)
}

/** Fires with the ids whose EFFECTIVE value changed. Returns an unsubscribe. */
export function subscribeProviderKeys(listener: ProviderKeysListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function _resetProviderKeysRuntimeForTests(): void {
  envKeys = {}
  appKeys = {}
  listeners.clear()
}
