// The shot list step's setting (`steps.shotList`, pure): the clip described
// shot by shot, per style — Precise off until turned on, Flex always on.
// The server's rules in backend/src/lib/cast-swap-steps.ts.

import type { ShotListSetting } from "@/lib/api"

/** Whether the shot list as set needs an engine that runs it: Precise on, or an LLM of its own (the server's `shotListNeedsEngine`). */
export function shotListNeedsEngine(s: ShotListSetting | undefined): boolean {
  if (!s) return false
  return s.precise?.mode === "on" || s.precise?.llm !== undefined || s.flex?.llm !== undefined || (s.flex !== undefined && s.flex.mode !== "on")
}

/** The setting with each style at its defaults left out (Precise off, Flex on, no LLM); undefined when nothing is left. */
export function normaliseShotList(s: ShotListSetting | undefined): ShotListSetting | undefined {
  if (!s) return undefined
  const out: ShotListSetting = {}
  if (s.precise && (s.precise.mode === "on" || s.precise.llm)) out.precise = s.precise
  if (s.flex && (s.flex.mode !== "on" || s.flex.llm)) out.flex = s.flex
  return Object.keys(out).length > 0 ? out : undefined
}
