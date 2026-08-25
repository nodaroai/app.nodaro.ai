/** Shape of one seeded tutorial — a `workflow_templates` row's content. The
 *  in-tree base templates and operator-supplied pack templates share it. */
export interface TutorialTemplateDoc {
  slug: string
  name: string
  description?: string | null
  markdownDescription?: string | null
  category?: string
  outputTypes?: string[]
  tags?: string[]
  complexity?: string
  previewMediaUrl?: string | null
  previewMediaType?: string | null
  /** Looked up by slug — migration 114 seeds the base categories; a pack
   *  declares any additional slug it uses in its manifest (see ensureTutorialCategory). */
  tutorialCategorySlug: string
  tutorialSortOrder: number
  nodes: unknown[]
  edges: unknown[]
  settings?: Record<string, unknown>
}

/** A category a pack contributes/orders. Upserted into tutorial_categories at
 *  seed time (data, not a migration) so a pack's templates can reference a
 *  category the base image does not ship. */
export interface TutorialPackCategory {
  slug: string
  name: string
  sortOrder?: number
}

export interface TutorialPackManifest {
  /** Human-readable pack name, used in logs. */
  name: string
  /** Optional pack version, surfaced in the load log. */
  version?: string
  /** Optional content locale (e.g. "he"). Advisory metadata; logged, not wired
   *  to filtering (the schema has no per-row locale column). */
  locale?: string
  /** Every category any of this pack's templates map into. A template whose
   *  tutorialCategorySlug is absent here is an ERROR. */
  categories: TutorialPackCategory[]
  /** Optional denylist for the "no prompt naming a real person / a specific
   *  composition" rule — matched case-insensitively against template prompts,
   *  WARN-only (see design decision in the plan). */
  forbiddenPromptTerms?: string[]
}

export interface PackIssue {
  pack: string
  templateSlug?: string
  severity: "error" | "warn"
  code: string
  message: string
}

export interface LoadedPack {
  name: string
  dir: string
  locale?: string
  categories: TutorialPackCategory[]
  docs: TutorialTemplateDoc[]
}
