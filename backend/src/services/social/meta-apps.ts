import type { SocialProvider } from "./providers/types.js"

/**
 * The Meta-family OAuth apps a deployment may have configured.
 *
 * Meta issues SEPARATE credentials per login product: Facebook Login for
 * Business (Pages + Instagram-business) uses the Facebook app id/secret, while
 * Instagram Login (`instagram-standalone`) uses the Instagram app's own id and
 * secret. Both, however, share one privacy surface — a user removing "Nodaro"
 * from their Meta settings can trigger a deletion callback signed by EITHER
 * app — so anything that reasons about "our Meta integration" reads this list
 * instead of naming one app.
 *
 * Adding a future Meta login product = one entry here; the deletion callbacks
 * and the provider scoping follow automatically.
 */
export const META_APPS = [
  { idEnv: "META_APP_ID", secretEnv: "META_APP_SECRET" },
  { idEnv: "INSTAGRAM_APP_ID", secretEnv: "INSTAGRAM_APP_SECRET" },
] as const

/** Env var names identifying a Meta-family app. */
const META_APP_ID_ENVS: readonly string[] = META_APPS.map((a) => a.idEnv)

/**
 * Every app secret actually configured here. Callbacks verify an incoming
 * `signed_request` against each, because Meta signs with the app the user
 * authorized — which may be either one.
 */
export function configuredMetaAppSecrets(): string[] {
  return META_APPS.map((a) => process.env[a.secretEnv]).filter(
    (secret): secret is string => typeof secret === "string" && secret.length > 0,
  )
}

/**
 * Is this provider backed by one of our Meta apps? Derived from the provider's
 * own `requiredEnv` rather than a hardcoded platform list, so a Meta-backed
 * network added later is covered the day it is registered.
 */
export function isMetaBackedProvider(provider: SocialProvider): boolean {
  return provider.requiredEnv.some((env) => META_APP_ID_ENVS.includes(env))
}
