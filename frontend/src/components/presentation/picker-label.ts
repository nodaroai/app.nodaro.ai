import type { ParameterPickerMeta } from "@/lib/picker-ui"
import { useLocalizeHandleLabel } from "@/lib/i18n/labels"

/**
 * A parameter picker's name in the interface language, for the sentences that
 * name it ("Search era / period…", "Restrict Mood"). The registry label is the
 * picker's source-pip name on the canvas, so it localizes through the same
 * handle table the pip reads (`handle-labels-coverage` keeps every registry
 * label in it). English passes through unchanged.
 */
export function usePickerLabel(meta: Pick<ParameterPickerMeta, "label">): string {
  const localizeHandle = useLocalizeHandleLabel()
  return localizeHandle(meta.label)
}
