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
    // needs is here — which key, and that the connection isn't the answer;
    // the how-to lives in Install health, which the sentence points at.
    super(
      `${label ? `${label}: n` : "N"}eeds your own ${keyName} \u2014 not covered by the nodaro.ai connection. ` +
        `Add it in Install health \u2192 Provider keys.`,
    )
    this.name = "MissingProviderKeyError"
  }
}

/**
 * Why /v1/voices (and the library tab) is limited without a key. Deliberately
 * NOT the MissingProviderKeyError sentence: text-to-speech itself IS covered
 * by the nodaro.ai connection, and the static premade list still works for
 * generation — only previews and the personal voice library need the key, so
 * "not covered by the connection" would be false here. Same render envelope
 * as the shared message: short, names the key, points at Install health.
 */
export function describeLimitedVoices(): string {
  return (
    "Showing a limited built-in voice list — previews and your voice library need " +
    "ELEVENLABS_API_KEY. Add it in Install health → Provider keys."
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
): string {
  const unset = (Object.keys(WHERE_TO_GET) as ProviderKeyName[]).filter((k) => !keys[k])
  if (unset.length === 0) {
    // Every key this install could hold is set — the model really is unknown.
    return `Model "${model}" is not supported for ${capability} by any registered provider`
  }
  const options = unset.slice(0, 2).join(" or ")
  const cloudNote = connectedToCloud ? "the nodaro.ai connection doesn't cover it" : "no provider is configured"
  return (
    `No provider for ${capability} \u2014 ${cloudNote}. ` +
    `Add ${options} in Install health \u2192 Provider keys.`
  )
}
