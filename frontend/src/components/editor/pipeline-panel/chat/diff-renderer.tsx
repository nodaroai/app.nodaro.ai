import type { ProposedChange } from "@nodaro/shared"

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
  if (ops.length === 0) {
    return (
      <div className="text-xs text-zinc-500 dark:text-zinc-400 italic">
        (no operations)
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
          {describeOp(op)}
        </li>
      ))}
    </ul>
  )
}

/**
 * Human description for a single JSON Patch op. Exported for tests.
 */
export function describeOp(op: DiffOp): string {
  const { op: kind, path } = op
  const value = "value" in op ? op.value : undefined

  // Scenes
  const sceneSummary = path.match(/^\/scenes\/(\d+)\/summary$/)
  if (sceneSummary) {
    return `Scene ${Number(sceneSummary[1]) + 1}: rewrite summary → ${truncate(value)}`
  }
  const sceneTitle = path.match(/^\/scenes\/(\d+)\/title$/)
  if (sceneTitle) {
    return `Scene ${Number(sceneTitle[1]) + 1}: retitle → ${truncate(value)}`
  }
  const sceneDuration = path.match(/^\/scenes\/(\d+)\/duration_seconds$/)
  if (sceneDuration) {
    return `Scene ${Number(sceneDuration[1]) + 1}: duration → ${value}s`
  }
  const sceneMood = path.match(/^\/scenes\/(\d+)\/mood$/)
  if (sceneMood) {
    return `Scene ${Number(sceneMood[1]) + 1}: mood → ${truncate(value)}`
  }
  const sceneAdd = path.match(/^\/scenes\/-$/) || path.match(/^\/scenes\/(\d+)$/)
  if (sceneAdd && kind === "add") {
    const idx = path.endsWith("/-") ? "end" : `index ${path.split("/")[2]}`
  return `Insert scene at ${idx}`
  }
  const sceneRemove = path.match(/^\/scenes\/(\d+)$/)
  if (sceneRemove && kind === "remove") {
    return `Remove scene ${Number(sceneRemove[1]) + 1}`
  }
  const sceneFallback = path.match(/^\/scenes\/(\d+)\/(.+)$/)
  if (sceneFallback) {
    return `Scene ${Number(sceneFallback[1]) + 1}: ${kind} ${sceneFallback[2]}${
      kind !== "remove" ? ` → ${truncate(value)}` : ""
    }`
  }

  // Cast
  const castName = path.match(/^\/cast\/(\d+)\/name$/)
  if (castName) {
    return `Cast #${Number(castName[1]) + 1}: rename → ${truncate(value)}`
  }
  const castVisual = path.match(/^\/cast\/(\d+)\/visual_description$/)
  if (castVisual) {
    return `Cast #${Number(castVisual[1]) + 1}: update visual description`
  }
  const castVoice = path.match(/^\/cast\/(\d+)\/voice_profile$/)
  if (castVoice) {
    return `Cast #${Number(castVoice[1]) + 1}: update voice profile`
  }
  const castAdd = path === "/cast/-" || /^\/cast\/\d+$/.test(path)
  if (castAdd && kind === "add") {
    return `Add cast member`
  }
  const castRemoveMatch = path.match(/^\/cast\/(\d+)$/)
  if (castRemoveMatch && kind === "remove") {
    return `Remove cast #${Number(castRemoveMatch[1]) + 1}`
  }
  const castFallback = path.match(/^\/cast\/(\d+)\/(.+)$/)
  if (castFallback) {
    return `Cast #${Number(castFallback[1]) + 1}: ${kind} ${castFallback[2]}${
      kind !== "remove" ? ` → ${truncate(value)}` : ""
    }`
  }

  // Locations
  const locName = path.match(/^\/locations\/(\d+)\/name$/)
  if (locName) {
    return `Location #${Number(locName[1]) + 1}: rename → ${truncate(value)}`
  }
  const locVisual = path.match(/^\/locations\/(\d+)\/visual_description$/)
  if (locVisual) {
    return `Location #${Number(locVisual[1]) + 1}: update visual description`
  }
  const locAddRoot = path === "/locations/-"
  if (locAddRoot && kind === "add") {
    return `Add location`
  }
  const locRemoveMatch = path.match(/^\/locations\/(\d+)$/)
  if (locRemoveMatch && kind === "remove") {
    return `Remove location #${Number(locRemoveMatch[1]) + 1}`
  }
  const locFallback = path.match(/^\/locations\/(\d+)\/(.+)$/)
  if (locFallback) {
    return `Location #${Number(locFallback[1]) + 1}: ${kind} ${locFallback[2]}${
      kind !== "remove" ? ` → ${truncate(value)}` : ""
    }`
  }

  // Objects
  const objName = path.match(/^\/objects\/(\d+)\/name$/)
  if (objName) {
    return `Object #${Number(objName[1]) + 1}: rename → ${truncate(value)}`
  }
  const objAddRoot = path === "/objects/-"
  if (objAddRoot && kind === "add") {
    return `Add object`
  }
  const objRemoveMatch = path.match(/^\/objects\/(\d+)$/)
  if (objRemoveMatch && kind === "remove") {
    return `Remove object #${Number(objRemoveMatch[1]) + 1}`
  }
  const objFallback = path.match(/^\/objects\/(\d+)\/(.+)$/)
  if (objFallback) {
    return `Object #${Number(objFallback[1]) + 1}: ${kind} ${objFallback[2]}${
      kind !== "remove" ? ` → ${truncate(value)}` : ""
    }`
  }

  // Top-level Showrunner-plan fields
  if (path === "/title") return `Retitle plan → ${truncate(value)}`
  if (path === "/logline") return `Rewrite logline → ${truncate(value)}`
  if (path === "/has_narrator") {
    return `Narrator → ${value ? "enabled" : "disabled"}`
  }
  if (path === "/narrator_profile") {
    return `Narrator profile → ${truncate(value)}`
  }
  if (path.startsWith("/music_plan/")) {
    return `Music ${path.replace(/^\/music_plan\//, "")} → ${truncate(value)}`
  }
  if (path.startsWith("/global_style/")) {
    return `Style ${path.replace(/^\/global_style\//, "")} → ${truncate(value)}`
  }
  if (path === "/total_duration_seconds") {
    return `Total duration → ${value}s`
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
