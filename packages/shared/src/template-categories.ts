/**
 * The use cases a marketplace template is filed under — exactly one each.
 * Shared by the publish/browse routes (the `category` enum), the Templates
 * page (tiles, URL filter, labels) and the publish dialog, so the list can
 * only change in one place. Labels live with the frontend's i18n
 * (`lib/template-categories.ts`), keyed by these values.
 */
export const TEMPLATE_CATEGORIES = [
  "product-imagery",
  "static-ads",
  "user-generated-content",
  "video-ads",
  "brand-assets",
  "automations",
  "campaign-concepts",
  "social-creatives",
  // Workflows an AI agent built through the MCP server, kept whole so every step can be opened and changed.
  "mcp",
] as const

export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number]

/** Where a template with no usable category is filed: the plain "it is a workflow" bucket. */
export const DEFAULT_TEMPLATE_CATEGORY: TemplateCategory = "automations"

/**
 * The categories templates were filed under before September 2026, each
 * read as its new home. Migration 423 rewrites the rows with the same map;
 * this keeps an old link (`?category=video-production`), a cached card and a
 * row the migration has not reached yet resolving in the meantime.
 */
export const LEGACY_TEMPLATE_CATEGORIES: Readonly<Record<string, TemplateCategory>> = {
  "image-generation": "product-imagery",
  "video-production": "video-ads",
  "audio-music": "social-creatives",
  "content-writing": "campaign-concepts",
  "social-media": "social-creatives",
  "data-processing": "automations",
  "multi-step": "automations",
  other: "automations",
}

const CURRENT = new Set<string>(TEMPLATE_CATEGORIES)

export function isTemplateCategory(value: unknown): value is TemplateCategory {
  return typeof value === "string" && CURRENT.has(value)
}

/** A current category as is, a legacy one as its new home, anything else as undefined. */
export function resolveTemplateCategory(value: string | null | undefined): TemplateCategory | undefined {
  if (value == null) return undefined
  if (isTemplateCategory(value)) return value
  return LEGACY_TEMPLATE_CATEGORIES[value]
}

/** The category a stored row reads as: resolved, else the default bucket. */
export function normalizeTemplateCategory(value: string | null | undefined): TemplateCategory {
  return resolveTemplateCategory(value) ?? DEFAULT_TEMPLATE_CATEGORY
}

/**
 * Every stored value that reads as `category` — the value itself and the
 * legacy ones that map to it — so a database filter matches rows the
 * migration has not rewritten yet.
 */
export function templateCategoryStoredValues(category: TemplateCategory): string[] {
  const legacy = Object.keys(LEGACY_TEMPLATE_CATEGORIES).filter((value) => LEGACY_TEMPLATE_CATEGORIES[value] === category)
  return [category, ...legacy]
}
