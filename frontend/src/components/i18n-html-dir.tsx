import { useEffect, type ReactNode } from "react"
import { DirectionProvider } from "@radix-ui/react-direction"
import { watchSavedLocale } from "virtual:site-locale"
import { useLocaleStore } from "@/lib/locale-store"

/**
 * Puts the store's locale on `<html lang dir>`. The entry module calls it
 * before React renders, so a right-to-left page is right-to-left from the
 * first frame; `I18nHtmlDir` keeps it in step afterwards.
 */
export function applyDocumentLocale(): void {
  const { locale, dir } = useLocaleStore.getState()
  const el = document.documentElement
  el.setAttribute("lang", locale)
  el.setAttribute("dir", dir)
}

/**
 * Mirrors the chosen locale into `<html lang>` and `<html dir>`, so RTL
 * locales flip the whole chrome. Mounted once at the app root; renders
 * nothing. Two regions deliberately do NOT follow it: every React Flow
 * canvas (pinned by the `.react-flow` rule in globals.css — a workflow is
 * shared content, not chrome) and picker tile grids (pinned through
 * `usePickerDir()`).
 *
 * It also follows the language every Nodaro product shares: coming back to
 * the tab after another product changed it, the page switches without a
 * reload (and writes nothing back).
 */
export function I18nHtmlDir(): null {
  const locale = useLocaleStore((s) => s.locale)
  const dir = useLocaleStore((s) => s.dir)
  useEffect(() => {
    const el = document.documentElement
    el.setAttribute("lang", locale)
    el.setAttribute("dir", dir)
  }, [locale, dir])
  useEffect(
    () =>
      watchSavedLocale(
        (shared) => useLocaleStore.getState().followLocale(shared),
        () => useLocaleStore.getState().locale,
      ),
    [],
  )
  return null
}

/**
 * Radix primitives read direction from React context, never from
 * `<html dir>`. Without this, dropdowns/selects/menus keep LTR keyboard
 * order and submenu side inside an RTL page.
 */
export function AppDirectionProvider({ children }: { children: ReactNode }) {
  const dir = useLocaleStore((s) => s.dir)
  return <DirectionProvider dir={dir}>{children}</DirectionProvider>
}
