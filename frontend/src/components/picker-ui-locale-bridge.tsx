import type { ReactNode } from "react"
import { PickerUiProvider } from "@/lib/picker-ui"
import { useUserLocale } from "@/lib/locale-store"
import { useLocalizePickerLabel } from "@/lib/i18n/labels"

/**
 * Feeds the app's locale into the picker-ui seam.
 *
 * In the RICH lane the private package's components read locale from the
 * package's own context (they cannot reach the app's locale store), so this
 * bridge must wrap the tree or non-English picker labels silently fall back
 * to English. In the STUB lane the provider is a passthrough (the stub's
 * hooks read the app store directly) — mounting it is free.
 */
export function PickerUiLocaleBridge({ children }: { children: ReactNode }) {
  const locale = useUserLocale()
  // The pickers render English section, group and field names from the
  // catalogs; the host's tables translate them (labels.<locale>.ts `picker`).
  const localizeLabel = useLocalizePickerLabel()
  return <PickerUiProvider locale={locale} localizeLabel={localizeLabel}>{children}</PickerUiProvider>
}
