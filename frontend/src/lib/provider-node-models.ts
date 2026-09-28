/**
 * The models a Provider node offers. Per category it is the list the matching
 * generation node's own model picker offers (`model-options.ts`), so a Provider
 * can only name a model that node runs; a category with no node to drive has
 * no entry. Wired into a node's Settings input, the Provider sets that node's
 * model at run time (`@nodaro/shared` settings-input.ts).
 */
import { DEFAULT_VIDEO_PROVIDER } from "@nodaro/shared"
import { IMAGE_GEN_MODELS, VIDEO_GEN_MODELS } from "@/components/editor/config-panels/model-options"
import type { MessageKey } from "@/lib/i18n"
import type { ProviderData } from "@/types/nodes"

export type ProviderNodeCategory = "image" | "video"

interface ProviderNodeCategoryEntry {
  readonly label: MessageKey
  readonly models: readonly { readonly value: string; readonly label: string; readonly desc: string }[]
  /** The model a new node, or a switch to this category, starts on — the matching node's own default. */
  readonly defaultModel: string
}

export const PROVIDER_NODE_CATEGORIES: Readonly<Record<ProviderNodeCategory, ProviderNodeCategoryEntry>> = {
  image: { label: "common.image", models: IMAGE_GEN_MODELS, defaultModel: "nano-banana" },
  video: { label: "common.video", models: VIDEO_GEN_MODELS, defaultModel: DEFAULT_VIDEO_PROVIDER },
}

export const PROVIDER_NODE_CATEGORY_IDS = Object.keys(PROVIDER_NODE_CATEGORIES) as ProviderNodeCategory[]

/** A new Provider node's category (NODE_DEFINITIONS), and where one holding no valid category lands. */
export const DEFAULT_PROVIDER_NODE_CATEGORY: ProviderNodeCategory = "video"

export function isProviderNodeCategory(value: unknown): value is ProviderNodeCategory {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PROVIDER_NODE_CATEGORIES, value)
}

/**
 * The category and model a Provider node holds, made valid: the stored pair
 * when it is one the panel offers, else the category's default model. A node
 * saved before the Provider offered real models holds a vendor name ("pika")
 * or a category no node reads ("voice", "script").
 */
export function validProviderSelection(
  data: Pick<ProviderData, "category" | "provider">,
): { category: ProviderNodeCategory; provider: string } {
  const category = isProviderNodeCategory(data.category) ? data.category : DEFAULT_PROVIDER_NODE_CATEGORY
  const entry = PROVIDER_NODE_CATEGORIES[category]
  const provider = entry.models.some((m) => m.value === data.provider) ? data.provider : entry.defaultModel
  return { category, provider }
}
