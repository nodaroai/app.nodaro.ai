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

/** id → display name, for joins that render a project name by id (workflow search). */
export function projectNameMap(projects: ReadonlyArray<{ readonly id: string; readonly name: string; readonly isDefault?: boolean }>, locale: LocaleId): Map<string, string> {
  return new Map(projects.map((p) => [p.id, projectDisplayName(p, locale)]))
}

/** Hook: the display-name helper bound to the live locale. */
export function useProjectDisplayName(): (project: { readonly name: string; readonly isDefault?: boolean }) => string {
  const locale = useLocaleStore((s) => s.locale)
  return useCallback((project) => projectDisplayName(project, locale), [locale])
}
