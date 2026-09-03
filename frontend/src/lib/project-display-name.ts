import type { LocaleId } from "@nodaro/shared"
import { translate } from "@/lib/i18n"
import { useLocaleStore } from "@/lib/locale-store"
import { useCallback } from "react"

/** The name migration 119 gives every user's default project. */
export const DEFAULT_PROJECT_NAME = "My Recent Flows"

/**
 * A project's name for display. The per-user DEFAULT project is created with
 * the English "My Recent Flows" and persisted as such — that string is chrome,
 * not something the user typed, so it reads in the user's language. A default
 * project the user has RENAMED, and every regular project, show verbatim.
 */
export function projectDisplayName(project: { readonly name: string; readonly isDefault?: boolean }, locale: LocaleId): string {
  if (project.isDefault && project.name === DEFAULT_PROJECT_NAME) return translate(locale, "projects.defaultName")
  return project.name
}

/** The description migration 119 gives every user's default project. */
export const DEFAULT_PROJECT_DESCRIPTION = "Auto-created workspace for new workflows"

/** Same rule for the seeded DESCRIPTION: chrome while it still equals the seed. */
export function projectDisplayDescription(project: { readonly description: string; readonly isDefault?: boolean }, locale: LocaleId): string {
  if (project.isDefault && project.description === DEFAULT_PROJECT_DESCRIPTION) return translate(locale, "projects.defaultDescription")
  return project.description
}

/** id → display name, for joins that render a project name by id (workflow search). */
export function projectNameMap(projects: ReadonlyArray<{ readonly id: string; readonly name: string; readonly isDefault?: boolean }>, locale: LocaleId): Map<string, string> {
  return new Map(projects.map((p) => [p.id, projectDisplayName(p, locale)]))
}

/** Hook: the display-name helper bound to the live locale. */
export function useProjectDisplayName(): (project: { readonly name: string; readonly isDefault?: boolean }) => string {
  const locale = useLocaleStore((s) => s.locale)
  return useCallback((project) => projectDisplayName(project, locale), [locale])
}

/** Hook: the display-description helper bound to the live locale. */
export function useProjectDisplayDescription(): (project: { readonly description: string; readonly isDefault?: boolean }) => string {
  const locale = useLocaleStore((s) => s.locale)
  return useCallback((project) => projectDisplayDescription(project, locale), [locale])
}
