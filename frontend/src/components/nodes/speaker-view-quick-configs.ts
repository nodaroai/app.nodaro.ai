/**
 * Speaker View's quick-strip controls (U3, SV10): the layout and the switch,
 * listing ONLY what the node can run with — the strip removes a choice the
 * aspect or the speaker count rules out (the panel greys it with its reason),
 * and a stored value that is no longer offered snaps the way the normalizer
 * snaps it (side by side → stacked at 9:16), not to "the first one".
 *
 * Both lists come from the same pure functions the panel and the payload
 * builder read (`@nodaro/render-rules`), fed by the one reader of the wired
 * edit (`speakerViewContextOf`), so the strip can never offer what the run
 * would refuse.
 */
import { ArrowRightLeft, LayoutGrid } from "lucide-react"
import { normalizeSpeakerViewData, validSpeakerLayouts, validSpeakerSwitches, type SpeakerViewNodeSettings } from "@nodaro/render-rules"
import { COMBINE_TRANSITIONS, SPEAKER_SWITCHES } from "@nodaro/shared"
import { tx, type MessageKey } from "@/lib/i18n"
import { speakerViewContextOf } from "@/lib/speaker-view-context"
import type { QuickConfigContext, QuickConfigControl, QuickConfigOption } from "./node-quick-configs"

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

const settingsOf = (data: Record<string, unknown>): SpeakerViewNodeSettings => data as SpeakerViewNodeSettings
const contextOf = (ctx?: QuickConfigContext) => (ctx ? speakerViewContextOf(ctx.nodeId, ctx.nodes, ctx.edges) : undefined)

/** The crossfades, one per `xfade:<combine id>`, labelled by the transition's
 *  own (localized) name, in the catalog's order. */
function crossfadeOptions(): QuickConfigOption[] {
  const byId = new Map(COMBINE_TRANSITIONS.map((t) => [t.id, t.label]))
  return SPEAKER_SWITCHES.filter((s) => s.overlaps).map((s) => ({
    value: s.id,
    label: byId.get(s.id.slice("xfade:".length)) ?? s.id,
    description: tx("speakerView.switch.crossfade"),
  }))
}

export function speakerViewQuickConfigs(): ReadonlyArray<QuickConfigControl> {
  return [
    {
      field: "layout",
      ariaLabel: tx("speakerView.field.layout"),
      icon: LayoutGrid,
      needsGraph: true,
      defaultValue: "auto",
      options: (data, ctx) =>
        validSpeakerLayouts(settingsOf(data), contextOf(ctx))
          .filter((o) => o.allowed)
          .map((o) => ({ value: o.id, label: tx(SPEAKER_LAYOUT_LABEL_KEYS[o.id]!) })),
      snap: (value, data, ctx) => normalizeSpeakerViewData({ ...settingsOf(data), layout: value }, contextOf(ctx)).data.layout as string,
    },
    {
      field: "switchType",
      ariaLabel: tx("speakerView.field.switch"),
      icon: ArrowRightLeft,
      needsGraph: true,
      defaultValue: "cut",
      options: (data, ctx) => [
        ...validSpeakerSwitches(settingsOf(data), contextOf(ctx))
          .filter((o) => o.allowed)
          .map((o) => ({ value: o.id, label: tx(SPEAKER_SWITCH_LABEL_KEYS[o.id]!) })),
        // A crossfade is offered under every layout (SV2: it is used where the
        // layout itself changes, and the plugin writes it only where the master
        // clock jumps — SV21 c), so ruling Pan and Zoom out never hides it.
        ...crossfadeOptions(),
      ],
    },
  ]
}
