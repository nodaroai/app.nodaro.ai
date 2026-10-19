// @registry-lookup localizes the one option label it is given (the crossfade transition's name)
/**
 * The name a Speaker View switch is shown by in a settings dropdown: its own
 * label (Cut, Pan, Zoom), or "Crossfade: <transition>" for an `xfade:` id,
 * the transition's option label in the interface language. Its own module so
 * a node unit's panel (Clip Pack's) can name its switches without importing
 * the label tables, a registry composer.
 */
import { useCallback } from "react"
import { COMBINE_TRANSITIONS } from "@nodaro/shared/edl"
import { SPEAKER_SWITCH_LABEL_KEYS } from "@/components/nodes/speaker-view-label-keys"
import { useT } from "@/lib/i18n"
import { useLocalizeOptionLabel } from "@/lib/i18n/labels"

const XFADE = "xfade:"

/** The shown name of a switch id, in the interface language. */
export function useSpeakerSwitchLabel(): (id: string) => string {
  const t = useT()
  const localizeOption = useLocalizeOptionLabel()
  return useCallback((id: string): string => {
    const key = SPEAKER_SWITCH_LABEL_KEYS[id]
    if (key) return t(key)
    const transition = id.startsWith(XFADE) ? COMBINE_TRANSITIONS.find((c) => c.id === id.slice(XFADE.length)) : undefined
    return t("speakerView.switch.crossfadeOf", { name: localizeOption(transition?.label ?? id) })
  }, [t, localizeOption])
}
