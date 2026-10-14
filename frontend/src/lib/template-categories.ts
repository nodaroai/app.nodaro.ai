import { TEMPLATE_CATEGORIES, normalizeTemplateCategory, type TemplateCategory } from "@nodaro/shared/apps"
import type { MessageKey, TFunction } from "@/lib/i18n"

/**
 * The localized names of the template use cases. The values themselves are
 * `TEMPLATE_CATEGORIES` in `@nodaro/shared` (shared with the API); the
 * `Record` is total, so a category added there without a label here fails
 * the build.
 */
const LABEL_KEYS: Readonly<Record<TemplateCategory, MessageKey>> = {
  "product-imagery": "tcat.productImagery",
  "static-ads": "tcat.staticAds",
  "user-generated-content": "tcat.ugc",
  "video-ads": "tcat.videoAds",
  "brand-assets": "tcat.brandAssets",
  automations: "tcat.automations",
  "campaign-concepts": "tcat.campaignConcepts",
  "social-creatives": "tcat.socialCreatives",
}

export const TEMPLATE_CATEGORY_VALUES: readonly string[] = TEMPLATE_CATEGORIES

/** The name of a category; a legacy value reads as its new home, anything else as the default bucket. */
export function templateCategoryLabel(value: string, t: TFunction): string {
  return t(LABEL_KEYS[normalizeTemplateCategory(value)])
}
