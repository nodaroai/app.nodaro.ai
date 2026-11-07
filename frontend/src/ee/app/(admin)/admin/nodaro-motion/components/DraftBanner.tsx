// The banner over a loaded stored set or imported file (SettingsSetsManager.tsx):
// the page now holds its values, unsaved; nothing is live until Save all,
// which saves each section that differs through its own route and reports
// each one. Discard puts every section back to its live setting.

import { CheckCircle2, FileWarning, Loader2, XCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import type { MotionSettingsWarning } from "@/ee/lib/nodaro-motion-settings-sets-api"
import type { SectionSaveResult } from "../settings-sets-model"
import { WarningList } from "./SettingsSetDialogs"

export interface MotionDraftOrigin {
  name: string
  kind: "set" | "file"
  /** The stored set it was loaded from. */
  setId?: string
  warnings: MotionSettingsWarning[]
  notes: string[]
}

export function DraftBanner({
  origin,
  changed,
  labelOf,
  saving,
  results,
  onSaveAll,
  onDiscard,
}: {
  readonly origin: MotionDraftOrigin
  /** The labels of the sections that differ from live. */
  readonly changed: readonly string[]
  readonly labelOf: (key: string) => string
  readonly saving: boolean
  readonly results: readonly SectionSaveResult[] | null
  readonly onSaveAll: () => void
  readonly onDiscard: () => void
}) {
  return (
    <section
      role="region"
      aria-label="Draft"
      data-draft-banner
      className="mb-6 rounded-lg border-2 border-amber-500/60 bg-amber-50 p-4 text-amber-950 dark:bg-amber-500/10 dark:text-amber-100"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 font-semibold">
            <FileWarning className="size-4 shrink-0" aria-hidden />
            Draft from {origin.kind === "set" ? "stored set" : "file"} “{origin.name}” — not live
          </p>
          <p className="mt-1 text-sm">
            The page below holds its values, unsaved. Staging and production share these settings: nothing changes until
            you press Save all.
          </p>
          <p className="mt-1 text-sm">
            {changed.length === 0 ? "Every section matches the live settings." : `${changed.length} ${changed.length === 1 ? "section differs" : "sections differ"} from live: ${changed.join(", ")}.`}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="outline" className="min-h-9" disabled={saving} onClick={onDiscard}>
            Discard
          </Button>
          <Button size="sm" className="min-h-9" disabled={saving || changed.length === 0} onClick={onSaveAll}>
            {saving && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
            Save all
          </Button>
        </div>
      </div>
      {origin.warnings.length > 0 && (
        <div className="mt-3">
          <WarningList warnings={origin.warnings} />
        </div>
      )}
      {origin.notes.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-xs opacity-80" aria-label="Notes">
          {origin.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {results && results.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1 text-sm" aria-label="Save results">
          {results.map((r) => (
            <li key={r.key} className="flex items-start gap-1.5">
              {r.ok ? (
                <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-label="Saved" />
              ) : (
                <XCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-label="Not saved" />
              )}
              <span>
                <span className="font-medium">{labelOf(r.key)}</span>
                {r.ok ? " saved." : `: ${r.message}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
