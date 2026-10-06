"use client"

/**
 * The picker-ui pickers' interface strings in the interface language. The
 * package owns no dictionary: each picker takes a `copy` object from its host
 * (English when omitted) and the panel builds it here from the dictionary. A
 * field added to a picker's copy type is a compile error here until it is
 * translated.
 */
import { useMemo } from "react"
import { useT } from "@/lib/i18n"
import type { LightingPickerCopy, PickerSearchCopy, TransitionPickerCopy } from "@/lib/picker-ui"

/** The Transition picker's strings. */
export function useTransitionPickerCopy(): TransitionPickerCopy {
  const t = useT()
  return useMemo<TransitionPickerCopy>(
    () => ({
      searchPlaceholder: t("paramcfg.searchTransitions"),
      searchResults: t("paramcfg.transitionSearchResults"),
      categories: t("paramcfg.transitionCategories"),
      selectedCount: (n, max) => t("paramcfg.transitionsSelected", { n, max }),
      categorySelectedCount: (n) =>
        t(n === 1 ? "paramcfg.transitionCategoryPickedOne" : "paramcfg.transitionCategoryPicked", { n }),
      noMatch: (query) => t("paramcfg.noTransitionsMatch", { query }),
    }),
    [t],
  )
}

/** The Lighting picker's strings. */
export function useLightingPickerCopy(): LightingPickerCopy {
  const t = useT()
  return useMemo<LightingPickerCopy>(
    () => ({
      searchPlaceholder: t("paramcfg.searchLighting"),
      noMatch: (query) => t("paramcfg.noLightingMatch", { query }),
      pickUpTo: (n) => t("paramcfg.lightingPickUpTo", { n }),
      sectionPickUpTo: (section, n) => t("paramcfg.lightingSectionPickUpTo", { section, n }),
      enableSection: (section) => t("paramcfg.enableLightingSection", { section }),
      clickToEnable: (description, section) => t("paramcfg.lightingClickToEnable", { description, section }),
    }),
    [t],
  )
}

/** The Loop Subject picker's strings. */
export function useLoopSubjectPickerCopy(): PickerSearchCopy {
  const t = useT()
  return useMemo<PickerSearchCopy>(
    () => ({
      searchPlaceholder: t("paramcfg.searchLoopSubject"),
      noMatch: (query) => t("paramcfg.noLoopSubjectMatch", { query }),
    }),
    [t],
  )
}

/** The Color/Look picker's strings. */
export function useColorLookPickerCopy(): PickerSearchCopy {
  const t = useT()
  return useMemo<PickerSearchCopy>(
    () => ({
      searchPlaceholder: t("paramcfg.searchColorLook"),
      noMatch: (query) => t("paramcfg.noColorLookMatch", { query }),
    }),
    [t],
  )
}
