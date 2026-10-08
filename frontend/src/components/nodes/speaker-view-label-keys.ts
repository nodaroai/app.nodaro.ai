/**
 * The message keys that name Speaker View's layouts and switches. Their own
 * module so the strip's option lists and the panel's reasons (which name a
 * layout) read them without importing each other.
 */
import type { MessageKey } from "@/lib/i18n"

export const SPEAKER_LAYOUT_LABEL_KEYS: Readonly<Record<string, MessageKey>> = {
  auto: "speakerView.layout.auto",
  single: "speakerView.layout.single",
  "side-by-side": "speakerView.layout.sideBySide",
  stacked: "speakerView.layout.stacked",
  grid: "speakerView.layout.grid",
  pip: "speakerView.layout.pip",
}

export const SPEAKER_SWITCH_LABEL_KEYS: Readonly<Record<string, MessageKey>> = {
  cut: "speakerView.switch.cut",
  pan: "speakerView.switch.pan",
  zoom: "speakerView.switch.zoom",
}
