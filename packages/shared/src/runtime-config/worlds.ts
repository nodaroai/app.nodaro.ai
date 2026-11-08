/**
 * The worlds a Nodaro deployment can offer — the tabs of the shared site
 * header, in its canonical display order — and the node types each one runs.
 *
 * A world is offered to a viewer when the deployment's profile allows it
 * (`surface.worlds.allow`, when set) AND every node type it runs is available
 * to that viewer. The platform's `GET /v1/surface/availability` answers both
 * per viewer; this table is the one copy that answer and every client read,
 * so a world is never shown where its runs would be refused.
 *
 * Structural vocabulary only (ids and node-type names), no content.
 */

export const WORLD_IDS = Object.freeze(["explore", "image", "video", "music", "trends", "motion", "voice", "app", "studio"] as const)

export type WorldId = (typeof WORLD_IDS)[number]

const WORLD_ID_SET: ReadonlySet<string> = new Set(WORLD_IDS)

export function isWorldId(value: unknown): value is WorldId {
  return typeof value === "string" && WORLD_ID_SET.has(value)
}

/**
 * The node types each world runs: a world is offered only while every one of
 * them is available to the viewer. A world with none runs no node of its own
 * and is gated by the allowlist alone: Explore is a showcase, App is the
 * workflow editor (whose nodes are gated one by one inside it), Studio is its
 * own product.
 *
 * - `image`: Generate Image (`POST /v1/generate-image`).
 * - `video`: Generate Video and Text to Video — the world's two routes
 *   (`/v1/generate-video` from a start frame, `/v1/text-to-video` from a
 *   prompt). The canvas's Image to Video node is not one of them.
 * - `music`: Suno Create Music (`/v1/suno/generate`).
 * - `trends`, `motion`: Cast Swap (`/v1/cast-swap`), the run both worlds start.
 * - `voice`: Voice Changer Pro (`/v1/voice-changer-pro`).
 */
export const WORLD_REQUIRED_NODE_TYPES: Readonly<Record<WorldId, readonly string[]>> = Object.freeze({
  explore: Object.freeze([]),
  image: Object.freeze(["generate-image"]),
  video: Object.freeze(["generate-video", "text-to-video"]),
  music: Object.freeze(["suno-generate"]),
  trends: Object.freeze(["cast-swap"]),
  motion: Object.freeze(["cast-swap"]),
  voice: Object.freeze(["voice-changer-pro"]),
  app: Object.freeze([]),
  studio: Object.freeze([]),
})

/** The worlds part of a deployment's surface profile. */
export interface SurfaceWorlds {
  /**
   * When PRESENT, exactly these worlds are offered (`[]` offers none). Absent:
   * every world is, subject to its node types. Unlike the profile's other
   * lists, presence is what narrows, so a list whose ids are all unknown
   * offers nothing instead of everything.
   */
  readonly allow?: readonly string[]
  /** The world a visit to the site's root lands on. Always one `allow` lets through. */
  readonly home?: WorldId
  /** Display order; worlds it leaves out follow in canonical order. */
  readonly order?: readonly WorldId[]
}

/** Does the profile's allowlist let this world through? (Node availability is checked separately.) */
export function worldAllowed(worlds: SurfaceWorlds | undefined, id: string): boolean {
  return worlds?.allow === undefined || worlds.allow.includes(id)
}

/** Every world, `order`'s known ids first (each once), then the rest in canonical order. */
export function orderWorlds(order?: readonly string[]): WorldId[] {
  const out: WorldId[] = []
  for (const id of order ?? []) if (isWorldId(id) && !out.includes(id)) out.push(id)
  for (const id of WORLD_IDS) if (!out.includes(id)) out.push(id)
  return out
}
