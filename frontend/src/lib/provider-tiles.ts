/**
 * The provider grid — Install health on /setup and "Model providers" on
 * Integrations both render from it — derived from /v1/setup/status:
 * `providers.keys` (which providers exist, in order, set or not),
 * `providers.sources` (env | app | oauth | null per provider) and
 * `providers.meta` (labels, env var, what it powers, cloud coverage, scope).
 *
 * The backend owns WHICH providers exist (it holds the keys) and what the
 * nodaro.ai connection covers; this module turns that into tile states, the
 * "who may edit" rule (env wins → an env-managed key is read-only here), the
 * core / node-specific grouping and the coverage banner. An older backend
 * that sends keys only still renders from the local label map, and an id
 * nobody labelled renders with its id rather than vanishing.
 */

export type ProviderSource = "env" | "app" | "oauth" | null

/** "core" unlocks model families; "node" exists for one or two specific nodes. */
export type ProviderScope = "core" | "node"

export interface ProviderMeta {
  readonly name: string
  /** What lights the tile — the env var name. */
  readonly env: string
  readonly whereToGet?: string
  readonly powers?: string
  /** Whether connecting nodaro.ai stands in for this key. */
  readonly cloudCovered?: boolean
  readonly scope?: ProviderScope
}

/** Fallback labels for a backend that predates `providers.meta`. */
export const PROVIDER_META: Record<string, ProviderMeta> = {
  nodaro: { name: "nodaro.ai", env: "NODARO_API_KEY", cloudCovered: false, scope: "core" },
  kie: { name: "KIE.ai", env: "KIE_API_KEY", cloudCovered: true, scope: "core" },
  replicate: { name: "Replicate", env: "REPLICATE_API_TOKEN", cloudCovered: true, scope: "core" },
  anthropic: { name: "Anthropic", env: "ANTHROPIC_API_KEY", cloudCovered: true, scope: "core" },
  gemini: { name: "Google Gemini", env: "GEMINI_API_KEY", cloudCovered: true, scope: "core" },
  elevenlabs: { name: "ElevenLabs", env: "ELEVENLABS_API_KEY", cloudCovered: true, scope: "core" },
  fal: { name: "fal.ai", env: "FAL_KEY", cloudCovered: true, scope: "core" },
  heygen: { name: "HeyGen", env: "HEYGEN_API_KEY", cloudCovered: true, scope: "node" },
  beeble: { name: "Beeble", env: "BEEBLE_API_KEY", cloudCovered: true, scope: "node" },
  apify: { name: "Apify", env: "APIFY_API_TOKEN", cloudCovered: true, scope: "node" },
}

export type TileState = "set" | "set (env)" | "set (app)" | "connected" | "key set (env)" | "key set (app)" | "missing"

export interface ProviderTile {
  readonly id: string
  readonly name: string
  readonly env: string
  readonly powers?: string
  readonly whereToGet?: string
  readonly cloudCovered: boolean
  readonly scope: ProviderScope
  readonly present: boolean
  readonly source: ProviderSource
  readonly state: TileState
  /** False when the key is managed by the environment (env wins) or by the OAuth connection. */
  readonly editable: boolean
}

export interface ProviderTileInput {
  readonly keys: Readonly<Record<string, boolean>>
  readonly sources?: Readonly<Record<string, ProviderSource>>
  readonly meta?: Readonly<Record<string, ProviderMeta>>
}

export function providerTiles({ keys, sources, meta }: ProviderTileInput): ProviderTile[] {
  return Object.entries(keys).map(([id, presentRaw]) => {
    const present = Boolean(presentRaw)
    const m = meta?.[id] ?? PROVIDER_META[id] ?? { name: id, env: id.toUpperCase() }
    const source: ProviderSource = sources ? (sources[id] ?? null) : present ? "env" : null
    const withSource = sources !== undefined
    let state: TileState
    if (!present) state = "missing"
    else if (id === "nodaro") state = source === "oauth" ? "connected" : source === "app" ? "key set (app)" : "key set (env)"
    else if (!withSource) state = "set"
    else state = source === "app" ? "set (app)" : "set (env)"
    const editable = !(present && (source === "env" || source === "oauth"))
    return {
      id,
      name: m.name,
      env: m.env,
      powers: m.powers,
      whereToGet: m.whereToGet,
      cloudCovered: m.cloudCovered ?? false,
      scope: m.scope ?? PROVIDER_META[id]?.scope ?? "core",
      present,
      source,
      state,
      editable,
    }
  })
}

export interface ProviderTileGroups {
  /** Keys that unlock model families — what a fresh install reaches for. */
  readonly core: ProviderTile[]
  /** Keys that exist for specific nodes; shown apart so they do not read as a general requirement. */
  readonly nodeSpecific: ProviderTile[]
}

export function groupProviderTiles(tiles: ReadonlyArray<ProviderTile>): ProviderTileGroups {
  return {
    core: tiles.filter((t) => t.scope === "core"),
    nodeSpecific: tiles.filter((t) => t.scope === "node"),
  }
}

export interface CloudCoverageSummary {
  /** Missing tiles that connecting nodaro.ai would clear. */
  readonly coveredMissing: number
  /** Missing tiles the connection does NOT cover — their own key is still needed. */
  readonly uncoveredMissing: ProviderTile[]
}

export function cloudCoverageSummary(tiles: ReadonlyArray<ProviderTile>): CloudCoverageSummary {
  const missing = tiles.filter((t) => !t.present && t.id !== "nodaro")
  return {
    coveredMissing: missing.filter((t) => t.cloudCovered).length,
    uncoveredMissing: missing.filter((t) => !t.cloudCovered),
  }
}
