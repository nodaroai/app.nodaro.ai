/**
 * Speaker View's quick-strip controls (U3, SV10): the layout and the switch.
 * The layout list holds ONLY what the node can run with (a choice the aspect or
 * the speaker count rules out is removed); the switch list keeps every switch
 * and GREYS the ones ruled out with their reason (decided 2026-10-08), as the
 * panel does. A stored value that is no longer offered snaps the way the normalizer
 * snaps it (side by side → stacked at 9:16), not to "the first one".
 *
 * Both lists come from the same pure functions the panel and the payload
 * builder read (`@nodaro/render-rules`), fed by the one reader of the wired
 * edit (`speakerViewContextOf`), so the strip can never offer what the run
 * would refuse.
 */
import { ArrowRightLeft, LayoutGrid } from "lucide-react"
import { normalizeSpeakerViewData, validSpeakerCrossfade, validSpeakerLayouts, validSpeakerSwitches, type SpeakerViewNodeSettings } from "@nodaro/render-rules"
import { COMBINE_TRANSITIONS, SPEAKER_SWITCHES } from "@nodaro/shared"
import { tx } from "@/lib/i18n"
import { SPEAKER_LAYOUT_LABEL_KEYS, SPEAKER_SWITCH_LABEL_KEYS } from "./speaker-view-label-keys"
import { speakerViewReasonText } from "@/components/editor/config-panels/speaker-view-reasons"
import { speakerViewContextOf } from "@/lib/speaker-view-context"
import type { QuickConfigContext, QuickConfigControl, QuickConfigOption } from "./node-quick-configs"

export { SPEAKER_LAYOUT_LABEL_KEYS, SPEAKER_SWITCH_LABEL_KEYS }

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

/** A value no setting can hold, for the one greyed Crossfade row. */
const GREYED_CROSSFADE = "__crossfade-unavailable__"

/**
 * The crossfade rows (SV21 c, decided 2026-10-08). Where the shared rule
 * (`validSpeakerCrossfade`, the same answer the panel's tile reads) allows it:
 * every crossfade. Where it does not: ONE greyed row carrying the reason, not a
 * wall of twenty — or, when a crossfade is already stored, that one (greyed), so
 * the value stays resolvable and the strip never rewrites it.
 */
function crossfadeRows(data: Record<string, unknown>, ctx?: QuickConfigContext): QuickConfigOption[] {
  const rule = validSpeakerCrossfade(settingsOf(data), contextOf(ctx))
  if (rule.allowed) return crossfadeOptions()
  const reason = rule.reason ? speakerViewReasonText(rule.reason, tx) : undefined
  const stored = typeof data.switchType === "string" ? crossfadeOptions().find((o) => o.value === data.switchType) : undefined
  return [{ ...(stored ?? { value: GREYED_CROSSFADE, label: tx("speakerView.switch.crossfade") }), disabled: true, ...(reason ? { reason } : {}) }]
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
        // Cut, Pan and Zoom are all listed: one the rule rules out is GREYED
        // with its reason (decided 2026-10-08), like the panel's tile, so the
        // strip never silently drops a choice.
        ...validSpeakerSwitches(settingsOf(data), contextOf(ctx)).map((o) => ({
          value: o.id,
          label: tx(SPEAKER_SWITCH_LABEL_KEYS[o.id]!),
          ...(o.allowed ? {} : { disabled: true, ...(o.reason ? { reason: speakerViewReasonText(o.reason, tx) } : {}) }),
        })),
        // A crossfade is offered under every layout (SV2: it is used where the
        // layout itself changes), so ruling Pan and Zoom out never hides it.
        // The plugin writes it only where the master clock jumps (SV21 c): where
        // none does, it is greyed with the reason (on the panel's tile too).
        ...crossfadeRows(data, ctx),
      ],
    },
  ]
}
