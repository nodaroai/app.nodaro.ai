/**
 * The models a Provider node offers. Per category it is the list the matching
 * generation node's own model picker offers, so a Provider can only name a
 * model that node runs; a category with no node to drive has no entry. Wired
 * into a node's Settings input, the Provider sets that node's model at run time
 * (`@nodaro/shared` settings-input.ts). The lists and the selection rule live in
 * `@nodaro/render-rules` (the server's new-node rule reads them too); this adds
 * each category's label.
 */
import {
  DEFAULT_PROVIDER_NODE_CATEGORY,
  PROVIDER_NODE_CATEGORY_MODELS,
  isProviderNodeCategory,
  validProviderSelection,
  type ProviderNodeCategory,
  type ProviderNodeCategoryModels,
} from "@nodaro/render-rules"
import type { MessageKey } from "@/lib/i18n"

export { DEFAULT_PROVIDER_NODE_CATEGORY, isProviderNodeCategory, validProviderSelection, type ProviderNodeCategory }

interface ProviderNodeCategoryEntry extends ProviderNodeCategoryModels {
  readonly label: MessageKey
}

const CATEGORY_LABELS: Readonly<Record<ProviderNodeCategory, MessageKey>> = {
  image: "common.image",
  video: "common.video",
}

export const PROVIDER_NODE_CATEGORIES: Readonly<Record<ProviderNodeCategory, ProviderNodeCategoryEntry>> = {
  image: { label: CATEGORY_LABELS.image, ...PROVIDER_NODE_CATEGORY_MODELS.image },
  video: { label: CATEGORY_LABELS.video, ...PROVIDER_NODE_CATEGORY_MODELS.video },
}

export const PROVIDER_NODE_CATEGORY_IDS = Object.keys(PROVIDER_NODE_CATEGORIES) as ProviderNodeCategory[]
