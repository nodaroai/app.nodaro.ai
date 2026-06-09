import type { NodaroClient } from "../client.js"
import type { FactoryPreset } from "@nodaro/shared"

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
 * Result of `GET /v1/node-presets/factory` — the built-in (factory) catalog for
 * a node type.
 */
export interface FactoryPresetsResult {
  data: FactoryPreset[]
}

/**
 * Node presets — reusable, named node configurations.
 *
 * Read-only over the API today: list your own custom presets and their folders,
 * and list the built-in factory catalog. To *use* a preset, take its `data` and
 * merge it into a node's config when you create/update a workflow. (Creating and
 * editing presets remains in the editor for now.)
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
   */
  listFactory(nodeType: string): Promise<FactoryPresetsResult> {
    return this.client.request<FactoryPresetsResult>(
      "GET",
      `/v1/node-presets/factory?nodeType=${encodeURIComponent(nodeType)}`,
    )
  }
}
