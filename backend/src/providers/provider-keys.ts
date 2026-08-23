/**
 * Missing-provider-key errors, phrased once.
 *
 * A keyless community install reaches provider clients through MANY paths —
 * the capability router, direct handlers, and shared singletons imported by
 * a dozen modules. Guarding each call site is the "remember to update the
 * list" pattern this repo avoids: the founder's soak found three different
 * error shapes for one root cause (raw Replicate 401, bare
 * "ELEVENLABS_API_KEY is not configured", and a 503). This is the single
 * phrasing, and the guards below sit at the client boundary so a NEW call
 * site inherits it without being told.
 */

import { PROVIDER_KEY_META, providerIdFor } from "../lib/provider-keys-runtime.js"
import { isNodaroConnectedCached } from "../lib/nodaro-connect-cache.js"

/** Whether connecting nodaro.ai stands in for this key — from the one
 *  runtime table (PROVIDER_KEY_META), never a hand-kept list here. */
function connectionCovers(keyName: string): boolean {
  const id = providerIdFor(keyName)
  return id !== null && PROVIDER_KEY_META[id].cloudCovered
}

/** Providers a self-host can configure with a key of their own. */
export type ProviderKeyName =
  | "REPLICATE_API_TOKEN"
  | "KIE_API_KEY"
  | "ELEVENLABS_API_KEY"
  | "ANTHROPIC_API_KEY"
  | "GEMINI_API_KEY"
  | "FAL_KEY"
  | "HEYGEN_API_KEY"
  | "BEEBLE_API_KEY"
  | "APIFY_API_TOKEN"

const WHERE_TO_GET: Record<ProviderKeyName, string> = {
  REPLICATE_API_TOKEN: "replicate.com",
  KIE_API_KEY: "kie.ai",
  ELEVENLABS_API_KEY: "elevenlabs.io",
  ANTHROPIC_API_KEY: "console.anthropic.com",
  GEMINI_API_KEY: "aistudio.google.com",
  FAL_KEY: "fal.ai",
  HEYGEN_API_KEY: "heygen.com",
  BEEBLE_API_KEY: "beeble.ai",
  APIFY_API_TOKEN: "apify.com",
}

export class MissingProviderKeyError extends Error {
  readonly code = "provider_key_missing"
  constructor(readonly keyName: ProviderKeyName, label?: string) {
    // Short on purpose: this string is rendered inside a node card (which
    // truncates) and a corner toast (which overflows). The founder's first
    // version ran ~230 chars and was unreadable in both. Everything a user
    // needs is here — which key, whether connecting nodaro.ai is an answer
    // (it is for every key the connection covers — say so, do not send a
    // keyless install shopping for a key it does not need), and where the
    // how-to lives (Install health).
    const head = `${label ? `${label}: n` : "N"}eeds ${keyName}`
    // `cloudCovered` is per-KEY; coverage is per-CODE-PATH (#761: TTS was
    // covered, STT was not — same key, same flag, one true promise and one
    // false one). Reality check beats a finer-grained table: if the install
    // is ALREADY connected and this error still fired, the connection did
    // not cover THIS path — telling the user to connect again is asking them
    // to redo the thing they already did. Best-effort sync read; unknown
    // (null) keeps the optimistic wording.
    const alreadyConnected = isNodaroConnectedCached() === true
    super(
      connectionCovers(keyName) && !alreadyConnected
        ? `${head} \u2014 or connect nodaro.ai, which covers it. Either one: Install health \u2192 Provider keys.`
        : alreadyConnected && connectionCovers(keyName)
          ? `${head} \u2014 the nodaro.ai connection doesn't cover this operation. Add the key in Install health \u2192 Provider keys.`
          : `${head} (your own) \u2014 not covered by the nodaro.ai connection. Add it in Install health \u2192 Provider keys.`,
    )
    this.name = "MissingProviderKeyError"
  }
}

/** The in-app screen where keys are pasted and nodaro.ai is connected. The
 *  voices hint and the frontend's HeyGen catalog hint name it with the same
 *  words (#865 found the pair pointing at different screens for one job).
 *  MissingProviderKeyError and describeEmptyCapability above still say
 *  "Install health → Provider keys" — the no-login /setup screen — because
 *  those strings reach API callers and job errors too; unifying them is a
 *  separate change. */
const KEYS_SCREEN = "Integrations → Model providers"

/**
 * Why /v1/voices (and the library tab) is limited without a key. Deliberately
 * NOT the MissingProviderKeyError sentence: text-to-speech itself IS covered
 * by the nodaro.ai connection, and the built-in list still works for
 * generation (previews + descriptions are baked in, #862) — only the personal
 * voice library and the full catalog need the key, so "not covered by the
 * connection" would be false here.
 *
 * Resolved against the SAME state MissingProviderKeyError reads (#863): the
 * old constant told an already-connected install to go connect, and never
 * offered the connection to a keyless one. Two live states (connected / not)
 * plus a defensive third for a key the connection does not cover — today
 * PROVIDER_KEY_META says it does, so that branch is latent. Each sentence
 * ≤200 chars for the picker banner.
 */
export function describeLimitedVoices(): string {
  const covered = connectionCovers("ELEVENLABS_API_KEY")
  const alreadyConnected = isNodaroConnectedCached() === true
  if (covered && alreadyConnected) {
    return (
      "Built-in voice list — speech runs through your nodaro.ai connection. " +
      `Your voice library and the full ElevenLabs catalog need your own ELEVENLABS_API_KEY (${KEYS_SCREEN}).`
    )
  }
  if (covered) {
    return (
      "Built-in voice list. To generate speech, add ELEVENLABS_API_KEY or connect nodaro.ai; " +
      `your voice library and the full catalog need the key itself. Either one: ${KEYS_SCREEN}.`
    )
  }
  return (
    "Built-in voice list — your voice library and the full ElevenLabs catalog need " +
    `ELEVENLABS_API_KEY (${KEYS_SCREEN}).`
  )
}

/** Throw the shared message when `value` is empty. */
export function requireProviderKey(
  value: string | undefined,
  keyName: ProviderKeyName,
  label?: string,
): void {
  if (!value || value.length === 0) {
    throw new MissingProviderKeyError(keyName, label)
  }
}

/**
 * Wrap a provider SDK singleton so ANY use of it fails with the shared
 * message while the key is unset. The check is per-access, not per-import:
 * a key added later (env reload, test) starts working without a restart of
 * this module.
 */
export function guardProviderClient<T extends object>(
  client: T,
  keyName: ProviderKeyName,
  readKey: () => string | undefined,
): T {
  return new Proxy(client, {
    get(target, prop, receiver) {
      requireProviderKey(readKey(), keyName)
      const value = Reflect.get(target, prop, receiver)
      return typeof value === "function" ? value.bind(target) : value
    },
  })
}

/**
 * A guarded client that is BUILT from the key in force and rebuilt when the
 * key changes. For SDKs that take the credential at construction (Replicate's
 * `auth`, Gemini's `apiKey`): with provider keys now live (`config.X_KEY`
 * resolves env → app-managed store), a singleton constructed once at import
 * would keep a stale key after the operator pastes a new one on /setup.
 * Same guard as guardProviderClient while the key is unset.
 *
 * Any new SDK singleton must go through this or read the key per call —
 * tools/check-provider-key-captures.mjs fails CI on a bare `new Sdk({ …
 * config.X_KEY })`.
 */
export function liveProviderClient<T extends object>(
  factory: (key: string) => T,
  keyName: ProviderKeyName,
  readKey: () => string | undefined,
): T {
  let built: { key: string; client: T } | null = null
  const current = (): T => {
    const key = readKey()
    requireProviderKey(key, keyName)
    if (!built || built.key !== key) built = { key: key!, client: factory(key!) }
    return built.client
  }
  return new Proxy({} as T, {
    get(_target, prop) {
      const client = current()
      const value = Reflect.get(client, prop, client)
      return typeof value === "function" ? value.bind(client) : value
    },
    has(_target, prop) {
      return prop in current()
    },
  })
}

/**
 * Why a capability had NO provider to serve it.
 *
 * The router's own phrasing ("Model X is not supported for Y by any
 * registered provider") is true but misleading on a self-host: it reads as
 * "this model is broken", when the real cause is that providers register only
 * when their key is set, and the nodaro.ai connection covers a subset of
 * capabilities. Derived from config at call time — no capability→key table to
 * drift, and a new provider key is covered by adding it to ProviderKeyName.
 */
export function describeEmptyCapability(
  capability: string,
  model: string,
  keys: Readonly<Record<ProviderKeyName, string>>,
  connectedToCloud: boolean,
  /**
   * The keys that can actually serve THIS capability, in the order to name
   * them. Callers that know their lane pass it (the LLM client: KIE, then
   * Anthropic for Claude models, Gemini for Gemini models); without it every
   * unset key is a candidate — which once told a Claude caller to add
   * REPLICATE_API_TOKEN.
   */
  candidates?: readonly ProviderKeyName[],
): string {
  const pool = candidates ?? (Object.keys(WHERE_TO_GET) as ProviderKeyName[])
  const unset = pool.filter((k) => !keys[k])
  if (unset.length === 0) {
    // Every key this install could hold is set — the model really is unknown.
    return `Model "${model}" is not supported for ${capability} by any registered provider`
  }
  const options = unset.slice(0, 2).join(" or ")
  // Not connected: connecting is an answer too (every key here is covered by
  // the connection except nodaro.ai's own). Connected and still here: the
  // connection did not cover this one — only a key will.
  const cloudNote = connectedToCloud ? "the nodaro.ai connection doesn't cover it" : "no provider is configured"
  const remedy = connectedToCloud
    ? `Add ${options} in Install health → Provider keys.`
    : `Add ${options} in Install health → Provider keys, or connect nodaro.ai.`
  return `No provider for ${capability} — ${cloudNote}. ${remedy}`
}
