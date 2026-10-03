"use client"

import { memo } from "react"
import { AlertCircle, SlidersHorizontal } from "lucide-react"
import { getModel, type WiredSetting } from "@nodaro/shared"
import { labelOf, useT, type MessageKey } from "@/lib/i18n"
import { useLocalizeNodeLabel } from "@/lib/i18n/labels"
import type { WiredSettingsView } from "@/hooks/use-wired-settings"

/** Motion's three steps, as its own panel names them. */
const MOTION_LABELS: Readonly<Record<"subtle" | "moderate" | "dynamic", MessageKey>> = {
  subtle: "vidcfg.subtle",
  moderate: "vidcfg.moderate",
  dynamic: "vidcfg.dynamic",
}

/** A wired setting as the node's chip and settings panel print it: the value the node runs with. */
export function wiredSettingText(w: WiredSetting, data: Readonly<Record<string, unknown>>): string {
  const value = (w.field ? data[w.field] : undefined) ?? w.value
  if (w.sourceType === "duration") return `${String(value ?? "")}s`
  if (w.sourceType === "provider") {
    const id = String(value ?? "")
    return getModel(id)?.label ?? id
  }
  return String(value ?? "")
}

/**
 * The values wired into a node's Settings input, as chips inside the node:
 * each one shows what the node runs with (a Duration fitted to the model, the
 * model's name), and a Provider the node cannot run shows in red with why.
 */
export const SettingsChips = memo(function SettingsChips({
  view,
  className,
}: {
  readonly view: WiredSettingsView
  readonly className?: string
}) {
  const t = useT()
  const localizeNode = useLocalizeNodeLabel()
  if (view.wired.length === 0) return null
  return (
    <div data-testid="settings-chips" className={`flex flex-wrap items-center gap-1 ${className ?? ""}`}>
      <span className="flex items-center rounded-md border border-white/10 bg-black/55 px-1 py-0.5 text-white/90 backdrop-blur-sm" title={t("node.settingsInputTitle")}>
        <SlidersHorizontal className="size-3" aria-hidden />
        <span className="sr-only">{t("node.settingsInputTitle")}</span>
      </span>
      {view.wired.map((w) => {
        const source = localizeNode(view.labels[w.sourceId] ?? w.sourceType)
        const text = w.sourceType === "motion" ? labelOf(MOTION_LABELS, String(w.value ?? ""), t) : wiredSettingText(w, view.data)
        const refused = view.problem?.sourceId === w.sourceId
        return (
          <span
            key={w.sourceId}
            data-testid={`settings-chip-${w.sourceType}`}
            title={refused ? t("node.settingsProviderRefused", { model: text, source }) : t("node.fromSource", { source })}
            className={`flex max-w-[140px] items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-medium backdrop-blur-sm ${
              refused ? "border-red-400/60 bg-red-600/85 text-white" : "border-white/10 bg-black/55 text-white/90"
            }`}
          >
            {refused && <AlertCircle className="size-2.5 shrink-0" aria-hidden />}
            <span className="truncate">{text}</span>
          </span>
        )
      })}
    </div>
  )
})

/** The note under the Run button of a node whose Settings input is wired. */
export function SettingsPriceNote() {
  const t = useT()
  return <p className="mt-1 text-center text-[10px] text-neutral-600 dark:text-white/60">{t("node.settingsPriceNote")}</p>
}
