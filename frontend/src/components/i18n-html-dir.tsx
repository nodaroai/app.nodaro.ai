import { useEffect, type ReactNode } from "react"
import { DirectionProvider } from "@radix-ui/react-direction"
import { useLocaleStore } from "@/lib/locale-store"

/**
 * Mirrors the chosen locale into `<html lang>` and `<html dir>`, so RTL
 * locales flip the whole chrome. Mounted once at the app root; renders
 * nothing. Two regions deliberately do NOT follow it: every React Flow
 * canvas (pinned by the `.react-flow` rule in globals.css — a workflow is
 * shared content, not chrome) and picker tile grids (pinned through
 * `usePickerDir()`).
 */
export function I18nHtmlDir(): null {
  const locale = useLocaleStore((s) => s.locale)
  const dir = useLocaleStore((s) => s.dir)
  useEffect(() => {
    const el = document.documentElement
    el.setAttribute("lang", locale)
    el.setAttribute("dir", dir)
  }, [locale, dir])
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
