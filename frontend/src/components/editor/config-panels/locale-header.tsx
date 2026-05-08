import { LocalePicker } from "@/components/editor/locale-picker"

/**
 * Compact header row that mounts the locale picker at the top of each
 * parameter-node config panel. Lets the user switch the picker language
 * (English ↔ localized) for every i18n-aware picker in the panel below.
 */
export function LocaleHeader() {
  return (
    <div className="flex items-center justify-end -mt-1 -mb-2">
      <LocalePicker />
    </div>
  )
}
