import type { NodaroClient } from "../client.js"
import type { FactoryPreset } from "@nodaro/prompts/presets"

/**
 * A user's saved custom preset (`GET /v1/node-presets`). Mirrors the backend's
 * camelCase row shape. `data` is captured node config — merge it into a node's
 * data when building/running a workflow to "apply" the preset.
 */
export interface NodePreset {
  id: string
  nodeType: string
  name: string
  description?: string
  data: Record<string, unknown>
  groupId?: string
  tags: string[]
  sortOrder: number
  /**
   * How many connected reference images the preset works from (0 = none),
   * counted from the `{image:N}` tokens in its prompt. Absent from servers that
   * predate it.
   */
  minReferences?: number
  /** `minReferences > 0` — the preset works from a connected photo. */
  needsImage?: boolean
  /** The example picture stored with the preset, or null. */
  previewUrl?: string | null
  createdAt: string
  updatedAt: string
}

/** A user's preset folder/section (`GET /v1/node-preset-groups`). */
export interface NodePresetGroup {
  id: string
  nodeType: string
  name: string
  kind: "folder" | "section"
  sortOrder: number
  createdAt: string
  updatedAt: string
}

/**
 * One built-in preset as `GET /v1/node-presets/factory` serves it: the
 * catalog entry plus what a client needs to present it.
 */
export interface FactoryPresetEntry extends FactoryPreset {
  /**
   * How many connected reference images the preset works from (0 = none):
   * Reference Sheet, Portrait Transformations, Edits and every template using
   * `{image:N}` need at least one. Absent from servers that predate it.
   */
  minReferences?: number
  /** `minReferences > 0` — the preset works from a connected photo. */
  needsImage?: boolean
  /**
   * An example picture of what the preset makes — an absolute URL on the
   * server you asked — or null while the preset has none.
   */
  previewUrl?: string | null
}

/**
 * Result of `GET /v1/node-presets/factory` — the built-in (factory) catalog for
 * a node type.
 */
export interface FactoryPresetsResult {
  data: FactoryPresetEntry[]
}

/** `POST /v1/node-presets` body. */
export interface CreateNodePresetInput {
  /** The node type the preset configures, e.g. `"generate-image"`. */
  nodeType: string
  /** Unique per node type (case-insensitive); a duplicate answers 409 `name_taken`. */
  name: string
  description?: string
  /** Node config (≤ 64 KB). Runtime keys (results, job ids, labels) are stripped. */
  data: Record<string, unknown>
  /** One of your preset groups, or null for none. */
  groupId?: string | null
  tags?: string[]
  sortOrder?: number
  /**
   * An example picture: an image stored on this platform (an upload or a
   * generated result) that already exists. Anything else answers 400.
   */
  previewUrl?: string | null
}

/** `PATCH /v1/node-presets/:id` body — every field optional; `previewUrl: null` removes the picture. */
export type UpdateNodePresetInput = Partial<Omit<CreateNodePresetInput, "nodeType">>

/** One entry of `POST /v1/node-presets/import` (the `presets export` envelope's entries fit). */
export interface ImportNodePresetInput {
  nodeType: string
  name: string
  description?: string
  data: Record<string, unknown>
  previewUrl?: string | null
}

/** `POST /v1/node-presets/reorder` body. */
export interface ReorderNodePresetsInput {
  groups?: Array<{ id: string; sortOrder: number }>
  /** `groupId` moves the preset into one of your groups (null = out of any group). */
  presets?: Array<{ id: string; groupId?: string | null; sortOrder: number }>
}

/** A favorite: a factory preset id (`"generate-image/character-board"`) or one of your preset ids. */
export interface NodePresetFavoriteInput {
  nodeType: string
  presetId: string
}

/** `POST /v1/node-preset-groups` body. */
export interface CreateNodePresetGroupInput {
  nodeType: string
  name: string
  /** A collapsible `"folder"` (default) or a flat `"section"` header. */
  kind?: "folder" | "section"
  sortOrder?: number
}

/** `PATCH /v1/node-preset-groups/:id` body. */
export interface UpdateNodePresetGroupInput {
  name?: string
  sortOrder?: number
}

/**
 * Node presets — reusable, named node configurations: your own presets and
 * folders, your favorites, and the built-in factory catalog.
 *
 * To *use* a preset, take its `data` and merge it into a node's config when you
 * create/update a workflow. `needsImage` / `minReferences` say how many photos
 * it works from; `previewUrl` is an example picture (null when there is none).
 *
 * The factory catalog (`listFactory`) is public: no token needed. Reads of
 * your own library need the `presets:read` scope for an OAuth app token;
 * writes (create, update, delete, import, reorder, favorites, groups) need
 * `assets:write`. Your own API key needs neither — but a key limited to some
 * workflows cannot reach your own presets (it reads the factory catalog as
 * anyone can).
 */
export class PresetsResource {
  constructor(private client: NodaroClient) {}

  /**
   * `GET /v1/node-presets` → your custom presets, newest first. Pass `nodeType`
   * (e.g. `"generate-image"`) to filter to one node type.
   */
  async list(nodeType?: string): Promise<NodePreset[]> {
    const qs = nodeType ? `?nodeType=${encodeURIComponent(nodeType)}` : ""
    const res = await this.client.request<{ data: NodePreset[] }>("GET", `/v1/node-presets${qs}`)
    return res.data
  }

  /**
   * `GET /v1/node-preset-groups` → your preset folders/sections, in display
   * order. Pass `nodeType` to filter to one node type.
   */
  async listGroups(nodeType?: string): Promise<NodePresetGroup[]> {
    const qs = nodeType ? `?nodeType=${encodeURIComponent(nodeType)}` : ""
    const res = await this.client.request<{ data: NodePresetGroup[] }>("GET", `/v1/node-preset-groups${qs}`)
    return res.data
  }

  /**
   * `GET /v1/node-presets/factory` → the built-in catalog for `nodeType`. These
   * ship with the app (no account needed to exist), so they're a good starting
   * point for "what configs are available".
   *
   * Login is optional: the catalog is public, so this works on a client with
   * no credential at all (`auth: { getToken: async () => null }`) — show the
   * names, example pictures (`previewUrl`) and photo counts (`minReferences`,
   * `needsImage`) to a visitor who is not signed in, and ask for a login only
   * when they generate. Your OWN presets (`list()`) still need a token.
   */
  listFactory(nodeType: string): Promise<FactoryPresetsResult> {
    return this.client.request<FactoryPresetsResult>(
      "GET",
      `/v1/node-presets/factory?nodeType=${encodeURIComponent(nodeType)}`,
    )
  }

  /** `POST /v1/node-presets` → the new preset. */
  async create(input: CreateNodePresetInput): Promise<NodePreset> {
    const res = await this.client.request<{ data: NodePreset }>("POST", "/v1/node-presets", { body: input })
    return res.data
  }

  /**
   * `PATCH /v1/node-presets/:id` → the updated preset. Pass the `updatedAt` you
   * read as `expectedUpdatedAt` to refuse (409 `conflict`) a change made
   * elsewhere since.
   */
  async update(id: string, patch: UpdateNodePresetInput, opts: { expectedUpdatedAt?: string } = {}): Promise<NodePreset> {
    const body = opts.expectedUpdatedAt ? { ...patch, expectedUpdatedAt: opts.expectedUpdatedAt } : patch
    const res = await this.client.request<{ data: NodePreset }>("PATCH", `/v1/node-presets/${encodeURIComponent(id)}`, { body })
    return res.data
  }

  /** `DELETE /v1/node-presets/:id` (404 when it is not yours). `expectedUpdatedAt` as on `update`. */
  async delete(id: string, opts: { expectedUpdatedAt?: string } = {}): Promise<{ success: true }> {
    const res = await this.client.request<{ data: { success: true } }>("DELETE", `/v1/node-presets/${encodeURIComponent(id)}`, {
      query: { expectedUpdatedAt: opts.expectedUpdatedAt },
    })
    return res.data
  }

  /**
   * `POST /v1/node-presets/import` — up to 500 presets in one call. A name you
   * already use gets an "(imported N)" suffix; a preset whose data is empty
   * after stripping runtime keys is skipped.
   */
  async import(presets: ImportNodePresetInput[]): Promise<{ imported: number }> {
    const res = await this.client.request<{ data: { imported: number } }>("POST", "/v1/node-presets/import", { body: { presets } })
    return res.data
  }

  /** `POST /v1/node-presets/reorder` — positions (and group membership) for many presets and groups at once. */
  async reorder(input: ReorderNodePresetsInput): Promise<{ ok: true }> {
    const res = await this.client.request<{ data: { ok: true } }>("POST", "/v1/node-presets/reorder", { body: input })
    return res.data
  }

  /** `GET /v1/node-presets/favorites` → your favorite preset ids for `nodeType`, newest first. */
  async favorites(nodeType: string): Promise<string[]> {
    const res = await this.client.request<{ data: string[] }>("GET", "/v1/node-presets/favorites", { query: { nodeType } })
    return res.data
  }

  /** `POST /v1/node-presets/favorites` — idempotent. */
  async addFavorite(input: NodePresetFavoriteInput): Promise<{ success: true }> {
    const res = await this.client.request<{ data: { success: true } }>("POST", "/v1/node-presets/favorites", { body: input })
    return res.data
  }

  /** `DELETE /v1/node-presets/favorites` — idempotent. */
  async removeFavorite(input: NodePresetFavoriteInput): Promise<{ success: true }> {
    const res = await this.client.request<{ data: { success: true } }>("DELETE", "/v1/node-presets/favorites", {
      query: { nodeType: input.nodeType, presetId: input.presetId },
    })
    return res.data
  }

  /** `POST /v1/node-preset-groups` → the new folder or section. */
  async createGroup(input: CreateNodePresetGroupInput): Promise<NodePresetGroup> {
    const res = await this.client.request<{ data: NodePresetGroup }>("POST", "/v1/node-preset-groups", { body: input })
    return res.data
  }

  /** `PATCH /v1/node-preset-groups/:id` → the renamed or moved group. */
  async updateGroup(id: string, patch: UpdateNodePresetGroupInput): Promise<NodePresetGroup> {
    const res = await this.client.request<{ data: NodePresetGroup }>("PATCH", `/v1/node-preset-groups/${encodeURIComponent(id)}`, {
      body: patch,
    })
    return res.data
  }

  /** `DELETE /v1/node-preset-groups/:id` — its presets move out of the group; none are deleted. */
  async deleteGroup(id: string): Promise<{ success: true }> {
    const res = await this.client.request<{ data: { success: true } }>("DELETE", `/v1/node-preset-groups/${encodeURIComponent(id)}`)
    return res.data
  }
}
