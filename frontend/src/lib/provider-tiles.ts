/**
 * The Install-health provider grid, derived from the backend's
 * `checks.providers.keys` — one tile per key, in the backend's order.
 *
 * The grid used to be a second, hand-copied list of six providers while the
 * "N/6 set" counter already came from `keys`; nodaro.ai lived outside both as
 * a banner-only boolean, so it never read as a provider. The backend owns
 * WHICH providers exist (it is the thing that holds the keys); this module
 * only owns how each one is labelled. A key the backend reports and this map
 * does not know renders with its id, so a new provider is visible on day one
 * rather than silently absent.
 */

export type NodaroCredentialSource = "oauth" | "env" | null

export interface ProviderMeta {
  readonly name: string
  /** What lights the tile — an env var name, or for nodaro.ai the two ways. */
  readonly env: string
}

export const PROVIDER_META: Record<string, ProviderMeta> = {
  nodaro: { name: "nodaro.ai", env: "Connect (OAuth) · or NODARO_API_KEY" },
  kie: { name: "KIE.ai", env: "KIE_API_KEY" },
  replicate: { name: "Replicate", env: "REPLICATE_API_TOKEN" },
  anthropic: { name: "Anthropic", env: "ANTHROPIC_API_KEY" },
  gemini: { name: "Google Gemini", env: "GEMINI_API_KEY" },
  elevenlabs: { name: "ElevenLabs", env: "ELEVENLABS_API_KEY" },
  fal: { name: "fal.ai", env: "FAL_KEY" },
}

export type TileState = "set" | "missing" | "connected" | "key set"

export interface ProviderTile {
  readonly id: string
  readonly name: string
  readonly env: string
  readonly present: boolean
  readonly state: TileState
}

export function providerTiles(
  keys: Readonly<Record<string, boolean>>,
  nodaroSource: NodaroCredentialSource,
): ProviderTile[] {
  return Object.entries(keys).map(([id, present]) => {
    const meta = PROVIDER_META[id] ?? { name: id, env: id.toUpperCase() }
    const state: TileState =
      id === "nodaro"
        ? present
          ? nodaroSource === "env"
            ? "key set"
            : "connected"
          : "missing"
        : present
          ? "set"
          : "missing"
    return { id, name: meta.name, env: meta.env, present: Boolean(present), state }
  })
}
