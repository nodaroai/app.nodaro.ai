import type { ProposedChange } from "@nodaro/shared"
import { useT, tx, type TFunction } from "@/lib/i18n"

type EditPatch = Extract<ProposedChange, { change_type: "edit_artifact" }>
export type DiffOp = EditPatch["json_patch"][number]

/**
 * Phase 1D.2b — Render an `edit_artifact` JSON Patch as a short list of
 * one-line human-readable descriptions. Designed for the proposed-change
 * disclosure inside the chat panel.
 *
 * The router below pattern-matches on the JSON Pointer path against the
 * Showrunner-plan shape (`scenes/N/...`, `cast/N/...`, etc.). Anything we
 * don't recognize falls through to a generic op/path/value display so a
 * future stage's patch shape (1D.2d) still renders without changes.
 *
 * Note: this is presentational only — the actual patch validation +
 * application happens server-side in `applyStageEdit`.
 */
export function DiffRenderer({ ops }: { ops: DiffOp[] }) {
  const t = useT()
  if (ops.length === 0) {
    return (
      <div className="text-xs text-zinc-500 dark:text-zinc-400 italic">
        {t("pipe.noOperations")}
      </div>
    )
  }
  return (
    <ul
      className="space-y-1 text-xs text-zinc-600 dark:text-zinc-300 font-mono"
      data-testid="diff-renderer"
    >
      {ops.map((op, i) => (
        <li key={i} className="leading-snug">
          {describeOp(op, t)}
        </li>
      ))}
    </ul>
  )
}

/**
 * Human description for a single JSON Patch op. Exported for tests. `t`
 * defaults to the live-locale `tx` so bare calls still resolve.
 */
export function describeOp(op: DiffOp, t: TFunction = tx): string {
  const { op: kind, path } = op
  const value = "value" in op ? op.value : undefined

  // Scenes
  const sceneSummary = path.match(/^\/scenes\/(\d+)\/summary$/)
  if (sceneSummary) {
    return t("pipe.diffSceneSummary", { n: Number(sceneSummary[1]) + 1, value: truncate(value) })
  }
  const sceneTitle = path.match(/^\/scenes\/(\d+)\/title$/)
  if (sceneTitle) {
    return t("pipe.diffSceneRetitle", { n: Number(sceneTitle[1]) + 1, value: truncate(value) })
  }
  const sceneDuration = path.match(/^\/scenes\/(\d+)\/duration_seconds$/)
  if (sceneDuration) {
    return t("pipe.diffSceneDuration", { n: Number(sceneDuration[1]) + 1, value: String(value) })
  }
  const sceneMood = path.match(/^\/scenes\/(\d+)\/mood$/)
  if (sceneMood) {
    return t("pipe.diffSceneMood", { n: Number(sceneMood[1]) + 1, value: truncate(value) })
  }
  const sceneAdd = path.match(/^\/scenes\/-$/) || path.match(/^\/scenes\/(\d+)$/)
  if (sceneAdd && kind === "add") {
    const idx = path.endsWith("/-") ? t("pipe.diffAtEnd") : t("pipe.diffAtIndex", { n: path.split("/")[2] ?? "" })
  return t("pipe.diffInsertSceneAt", { position: idx })
  }
  const sceneRemove = path.match(/^\/scenes\/(\d+)$/)
  if (sceneRemove && kind === "remove") {
    return t("pipe.diffRemoveScene", { n: Number(sceneRemove[1]) + 1 })
  }
  const sceneFallback = path.match(/^\/scenes\/(\d+)\/(.+)$/)
  if (sceneFallback) {
    return t("pipe.diffSceneField", {
      n: Number(sceneFallback[1]) + 1,
      op: kind,
      field: sceneFallback[2] ?? "",
      tail: kind !== "remove" ? t("pipe.diffArrowValue", { value: truncate(value) }) : "",
    })
  }

  // Cast
  const castName = path.match(/^\/cast\/(\d+)\/name$/)
  if (castName) {
    return t("pipe.diffCastRename", { n: Number(castName[1]) + 1, value: truncate(value) })
  }
  const castVisual = path.match(/^\/cast\/(\d+)\/visual_description$/)
  if (castVisual) {
    return t("pipe.diffCastVisual", { n: Number(castVisual[1]) + 1 })
  }
  const castVoice = path.match(/^\/cast\/(\d+)\/voice_profile$/)
  if (castVoice) {
    return t("pipe.diffCastVoice", { n: Number(castVoice[1]) + 1 })
  }
  const castAdd = path === "/cast/-" || /^\/cast\/\d+$/.test(path)
  if (castAdd && kind === "add") {
    return t("pipe.diffAddCast")
  }
  const castRemoveMatch = path.match(/^\/cast\/(\d+)$/)
  if (castRemoveMatch && kind === "remove") {
    return t("pipe.diffRemoveCast", { n: Number(castRemoveMatch[1]) + 1 })
  }
  const castFallback = path.match(/^\/cast\/(\d+)\/(.+)$/)
  if (castFallback) {
    return t("pipe.diffCastField", {
      n: Number(castFallback[1]) + 1,
      op: kind,
      field: castFallback[2] ?? "",
      tail: kind !== "remove" ? t("pipe.diffArrowValue", { value: truncate(value) }) : "",
    })
  }

  // Locations
  const locName = path.match(/^\/locations\/(\d+)\/name$/)
  if (locName) {
    return t("pipe.diffLocationRename", { n: Number(locName[1]) + 1, value: truncate(value) })
  }
  const locVisual = path.match(/^\/locations\/(\d+)\/visual_description$/)
  if (locVisual) {
    return t("pipe.diffLocationVisual", { n: Number(locVisual[1]) + 1 })
  }
  const locAddRoot = path === "/locations/-"
  if (locAddRoot && kind === "add") {
    return t("pipe.diffAddLocation")
  }
  const locRemoveMatch = path.match(/^\/locations\/(\d+)$/)
  if (locRemoveMatch && kind === "remove") {
    return t("pipe.diffRemoveLocation", { n: Number(locRemoveMatch[1]) + 1 })
  }
  const locFallback = path.match(/^\/locations\/(\d+)\/(.+)$/)
  if (locFallback) {
    return t("pipe.diffLocationField", {
      n: Number(locFallback[1]) + 1,
      op: kind,
      field: locFallback[2] ?? "",
      tail: kind !== "remove" ? t("pipe.diffArrowValue", { value: truncate(value) }) : "",
    })
  }

  // Objects
  const objName = path.match(/^\/objects\/(\d+)\/name$/)
  if (objName) {
    return t("pipe.diffObjectRename", { n: Number(objName[1]) + 1, value: truncate(value) })
  }
  const objAddRoot = path === "/objects/-"
  if (objAddRoot && kind === "add") {
    return t("pipe.diffAddObject")
  }
  const objRemoveMatch = path.match(/^\/objects\/(\d+)$/)
  if (objRemoveMatch && kind === "remove") {
    return t("pipe.diffRemoveObject", { n: Number(objRemoveMatch[1]) + 1 })
  }
  const objFallback = path.match(/^\/objects\/(\d+)\/(.+)$/)
  if (objFallback) {
    return t("pipe.diffObjectField", {
      n: Number(objFallback[1]) + 1,
      op: kind,
      field: objFallback[2] ?? "",
      tail: kind !== "remove" ? t("pipe.diffArrowValue", { value: truncate(value) }) : "",
    })
  }

  // Top-level Showrunner-plan fields
  if (path === "/title") return t("pipe.diffRetitlePlan", { value: truncate(value) })
  if (path === "/logline") return t("pipe.diffRewriteLogline", { value: truncate(value) })
  if (path === "/has_narrator") {
    return t("pipe.diffNarrator", { state: value ? t("pipe.diffEnabled") : t("pipe.diffDisabled") })
  }
  if (path === "/narrator_profile") {
    return t("pipe.diffNarratorProfile", { value: truncate(value) })
  }
  if (path.startsWith("/music_plan/")) {
    return t("pipe.diffMusic", { field: path.replace(/^\/music_plan\//, ""), value: truncate(value) })
  }
  if (path.startsWith("/global_style/")) {
    return t("pipe.diffStyle", { field: path.replace(/^\/global_style\//, ""), value: truncate(value) })
  }
  if (path === "/total_duration_seconds") {
    return t("pipe.diffTotalDuration", { value: String(value) })
  }

  // Generic fallback for unknown paths
  return kind === "remove"
    ? `${kind} ${path}`
    : `${kind} ${path} → ${truncate(value)}`
}

function truncate(v: unknown, max = 80): string {
  if (v === undefined || v === null) return String(v)
  if (typeof v === "string") {
    return v.length > max ? `"${v.slice(0, max - 1)}…"` : `"${v}"`
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v)
  try {
    const s = JSON.stringify(v)
    return s.length > max ? `${s.slice(0, max - 1)}…` : s
  } catch {
    return "[object]"
  }
}
