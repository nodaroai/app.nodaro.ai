import { getAnimal, getFurniture, getVehicle, getWeapon } from "@nodaro/shared"

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

function getKindLabel(kind: LegacyPickerSelection["kind"]): string {
  switch (kind) {
    case "animal":
      return "Animal"
    case "vehicle":
      return "Vehicle"
    case "furniture":
      return "Furniture"
    case "weapon":
      return "Weapon"
  }
}

export function UpstreamPickerBanner({ selection, onDismiss }: UpstreamPickerBannerProps) {
  const label = getCatalogLabel(selection)
  const kindLabel = getKindLabel(selection.kind)
  return (
    <div
      role="note"
      aria-label="Legacy picker selection detected"
      className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs"
    >
      <span className="mt-0.5 text-amber-500" aria-hidden="true">🔗</span>
      <div className="flex-1">
        <div className="font-medium text-amber-700 dark:text-amber-400">
          Legacy picker selection detected
        </div>
        <p className="mt-0.5 text-muted-foreground leading-relaxed text-slate-400">
          This object was created with a <span className="font-medium text-slate-300">{kindLabel}</span> picker selection:{" "}
          <span className="text-slate-200 font-medium">{label}</span>. Wire a {kindLabel} picker node to the
          <span className="font-mono mx-0.5">type</span> input handle for prompt-hint integration. The original
          selection metadata stays here until you dismiss.
        </p>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="shrink-0 h-6 w-6 rounded text-slate-400 hover:bg-[#1e293b] hover:text-slate-200 flex items-center justify-center text-[14px]"
      >
        ✕
      </button>
    </div>
  )
}

export default UpstreamPickerBanner
