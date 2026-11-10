/**
 * The models a Provider node offers, per category: the list the matching
 * generation node's own model menu offers (`model-menus.ts`), so a Provider can
 * only name a model that node runs. Wired into a node's Settings input, the
 * Provider sets that node's model at run time (`@nodaro/shared` settings-input).
 * The editor adds each category's label; the new-node rule reads these on both
 * sides.
 */
import { IMAGE_MODEL_ROLE_DEFAULTS } from "@nodaro/shared/model-catalog"
import { DEFAULT_VIDEO_PROVIDER } from "@nodaro/shared/models"
import { IMAGE_GEN_MODELS, VIDEO_GEN_MODELS } from "./model-menus"

export type ProviderNodeCategory = "image" | "video"

export interface ProviderNodeCategoryModels {
  readonly models: readonly { readonly value: string; readonly label: string; readonly desc: string }[]
  /** The model a new node, or a switch to this category, starts on — the matching node's own default. */
  readonly defaultModel: string
}

export const PROVIDER_NODE_CATEGORY_MODELS: Readonly<Record<ProviderNodeCategory, ProviderNodeCategoryModels>> = {
  image: { models: IMAGE_GEN_MODELS, defaultModel: IMAGE_MODEL_ROLE_DEFAULTS.general },
  video: { models: VIDEO_GEN_MODELS, defaultModel: DEFAULT_VIDEO_PROVIDER },
}

/** A new Provider node's category (NODE_DEFINITIONS), and where one holding no valid category lands. */
export const DEFAULT_PROVIDER_NODE_CATEGORY: ProviderNodeCategory = "video"

export function isProviderNodeCategory(value: unknown): value is ProviderNodeCategory {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PROVIDER_NODE_CATEGORY_MODELS, value)
}

/**
 * The category and model a Provider node holds, made valid: the stored pair
 * when it is one the panel offers, else the category's default model. A node
 * saved before the Provider offered real models holds a vendor name ("pika")
 * or a category no node reads ("voice", "script").
 */
export function validProviderSelection(data: { readonly category?: unknown; readonly provider?: unknown }): {
  category: ProviderNodeCategory
  provider: string
} {
  const category = isProviderNodeCategory(data.category) ? data.category : DEFAULT_PROVIDER_NODE_CATEGORY
  const entry = PROVIDER_NODE_CATEGORY_MODELS[category]
  const provider = typeof data.provider === "string" && entry.models.some((m) => m.value === data.provider) ? data.provider : entry.defaultModel
  return { category, provider }
}
