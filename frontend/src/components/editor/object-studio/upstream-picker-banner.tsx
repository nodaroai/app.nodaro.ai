import { getAnimal, getFurniture, getVehicle, getWeapon } from "@nodaro/shared"
import { useT, type MessageKey } from "@/lib/i18n"

/**
 * UpstreamPickerBanner — NEW component (no location equivalent).
 *
 * Reads `stagedData.legacyPickerSelection` (set by Phase E1's loadWorkflow
 * migration when an inline-picker selection was detected on a legacy object
 * node). Shows a non-blocking banner with a Dismiss button that calls
 * `patch({ legacyPickerSelection: null })`.
 *
 * The migration is one-way + non-destructive: the original `*Id` fields are
 * cleared from `data` once migrated, but the breadcrumb stays so the Studio
 * can show this nudge until the user dismisses it. Re-migration is gated on
 * `legacyPickerSelection === undefined` so an explicit `null` (user dismissed
 * banner) is preserved across loads.
 *
 * `kind` can only be one of 4 values (animal / vehicle / furniture / weapon).
 * Material picker is intentionally NOT a kind — material was a parameter
 * picker node, never an inline `*Id` field on ObjectNodeData, so the legacy
 * shape has nothing to migrate.
 */
export interface LegacyPickerSelection {
  readonly kind: "animal" | "vehicle" | "furniture" | "weapon"
  readonly id: string
}

interface UpstreamPickerBannerProps {
  readonly selection: LegacyPickerSelection
  readonly onDismiss: () => void
}

function getCatalogLabel(selection: LegacyPickerSelection): string {
  switch (selection.kind) {
    case "animal":
      return getAnimal(selection.id)?.label ?? selection.id
    case "vehicle":
      return getVehicle(selection.id)?.label ?? selection.id
    case "furniture":
      return getFurniture(selection.id)?.label ?? selection.id
    case "weapon":
      return getWeapon(selection.id)?.label ?? selection.id
  }
}

function getKindLabelKey(kind: LegacyPickerSelection["kind"]): MessageKey {
  switch (kind) {
    case "animal":
      return "paramcfg.animal"
    case "vehicle":
      return "paramcfg.vehicle"
    case "furniture":
      return "paramcfg.furniture"
    case "weapon":
      return "paramcfg.weapon"
  }
}

export function UpstreamPickerBanner({ selection, onDismiss }: UpstreamPickerBannerProps) {
  const t = useT()
  const label = getCatalogLabel(selection)
  const kindLabel = t(getKindLabelKey(selection.kind))
  return (
    <div
      role="note"
      aria-label={t("studio.legacyPickerDetected")}
      className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs"
    >
      <span className="mt-0.5 text-amber-500" aria-hidden="true">🔗</span>
      <div className="flex-1">
        <div className="font-medium text-amber-700 dark:text-amber-400">
          {t("studio.legacyPickerDetected")}
        </div>
        <p className="mt-0.5 text-muted-foreground leading-relaxed text-slate-400">
          {t("studio.legacyPickerCreatedWith")} <span className="font-medium text-slate-300">{kindLabel}</span> {t("studio.legacyPickerSelectionColon")}{" "}
          <span className="text-slate-200 font-medium">{label}</span>. {t("studio.legacyPickerWirePre", { kind: kindLabel })}
          <code className="font-mono mx-0.5">type</code> {t("studio.legacyPickerWirePost")}{" "}
          {t("studio.legacyPickerMetadataStays")}
        </p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={t("studio.dismiss")}
        className="shrink-0 h-6 w-6 rounded text-slate-400 hover:bg-[#1e293b] hover:text-slate-200 flex items-center justify-center text-[14px]"
      >
        ✕
      </button>
    </div>
  )
}

export default UpstreamPickerBanner
