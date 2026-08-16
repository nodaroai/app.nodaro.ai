import type { NodaroClient } from "../client.js"

/**
 * Cine shots — the Share → Remix record behind `/s/:id` share links.
 * Mirrors the backend's `/v1/shots` wire contract (`shots.ts::toWire`);
 * types are declared here so the SDK stays dependency-free — same
 * convention as `ModelSummary` / `PickerCatalog`.
 */

/** An `@`-mention entity reference captured in the shot's prompt state. */
export interface ShotEntityRef {
  entitySlug: string
  variantSlug?: string
  role?: string
  kind?: "character" | "location" | "object" | "creature"
}

export type ShotMode = "single" | "multi-shot" | "frame-to-motion" | "storyboard"

export interface Shot {
  id: string
  mode: ShotMode
  /** Opaque picker/builder selection state — round-tripped verbatim. */
  selectionState: Record<string, unknown>
  freeText?: string
  negativePrompt?: string
  assembledPrompt?: string
  perModelPrompts?: Record<string, string>
  models?: string[]
  entityRefs?: ShotEntityRef[]
  resultUrls?: string[]
  visibility: "private" | "public"
  schemaVersion: number
  ownerId: string
  createdAt: string
  updatedAt: string
}

export interface CreateShotInput {
  mode?: ShotMode
  selectionState?: Record<string, unknown>
  freeText?: string
  negativePrompt?: string
  assembledPrompt?: string
  perModelPrompts?: Record<string, string>
  /** Video model ids the shot targets (max 16). */
  models?: string[]
  entityRefs?: ShotEntityRef[]
  /**
   * Result media URLs (max 32). Must be plain public http(s) URLs — the
   * backend rejects signed URLs so a token can never leak into a share
   * record.
   */
  resultUrls?: string[]
  /** Rows default to private; sharing is an explicit "make public" action. */
  visibility?: "private" | "public"
}

export type UpdateShotInput = CreateShotInput

export class ShotsResource {
  constructor(private client: NodaroClient) {}

  /** Create a shot record. Returns the new shot's id — an unguessable
   *  capability string that doubles as the share-link path segment. */
  create(input: CreateShotInput = {}): Promise<{ id: string }> {
    return this.client.request("POST", "/v1/shots", { body: input })
  }

  /** Read a shot. Public shots are readable by anyone holding the id;
   *  private shots resolve only for their owner (404 otherwise). */
  get(id: string): Promise<{ shot: Shot }> {
    return this.client.request("GET", `/v1/shots/${encodeURIComponent(id)}`)
  }

  /** Update an owned shot (any subset of fields, e.g. a visibility toggle). */
  update(id: string, input: UpdateShotInput): Promise<{ shot: Shot }> {
    return this.client.request("PATCH", `/v1/shots/${encodeURIComponent(id)}`, { body: input })
  }

  /** Delete an owned shot. */
  async delete(id: string): Promise<void> {
    await this.client.request("DELETE", `/v1/shots/${encodeURIComponent(id)}`)
  }
}
