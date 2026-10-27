// Admin → Nodaro Motion's form model (pure): the per-engine drafts as they are saved.

import type { AdminTrendFaceMasking, NodaroMotionEngine, NodaroMotionEngineSupports, NodaroMotionMasking, NodaroMotionMotion, NodaroMotionMotionEntry } from "@/lib/api"
import { clipPreparationIssues, clipPreparationOf } from "../trends/clip-preparation"
import { FULL_DEPTH_SCENES, sceneOf } from "../trends/prompt-style"
import { cleanMasking, maskingIssues } from "../trends/model"

/** The setting as it is saved: each engine's cleaned setting; an engine left Off with nothing else set is left out. */
export function toSaved(draft: NodaroMotionMasking): NodaroMotionMasking {
  const out: NodaroMotionMasking = {}
  for (const [id, m] of Object.entries(draft) as Array<[NodaroMotionEngine, AdminTrendFaceMasking | undefined]>) {
    if (m) out[id] = cleanMasking(m)
  }
  return out
}

/**
 * The Motion setting as it is saved: each engine's masking cleaned and its
 * prompt style, an engine with neither left out (the defaults: the Precise
 * masking, the Flexible prompt).
 */
export function motionToSaved(draft: NodaroMotionMotion): NodaroMotionMotion {
  const out: NodaroMotionMotion = {}
  for (const [id, entry] of Object.entries(draft) as Array<[NodaroMotionEngine, NodaroMotionMotionEntry | undefined]>) {
    const kept: NodaroMotionMotionEntry = {
      ...(entry?.masking ? { masking: cleanMasking(entry.masking) } : {}),
      ...(entry?.promptStyle ? { promptStyle: entry.promptStyle } : {}),
    }
    if (Object.keys(kept).length > 0) out[id] = kept
  }
  return out
}

/** What the server would refuse in an engine's Motion masking, as sentences (Save is held on any). */
export function motionIssues(entry: NodaroMotionMotionEntry | undefined): string[] {
  const m = entry?.masking
  return m ? [...clipPreparationIssues(m), ...maskingIssues(m)].map((i) => `Motion: ${i}`) : []
}

/**
 * What this environment's Cast Swap engine cannot do yet of an engine's Motion
 * setting, as phrases (`supports` from GET /v1/admin/nodaro-motion/motion;
 * unknown when left out: nothing is said). The Motion style itself
 * (`styles`), Full depth (`sourceModes`), its scene (`fullDepthScenes`;
 * absent = the original only) and a prompt style other than Flexible
 * (`promptStyles`; an engine without them words every Motion run Flexible).
 */
export function motionEngineGaps(entry: NodaroMotionMotionEntry | undefined, supports: NodaroMotionEngineSupports | undefined): string[] {
  if (!supports) return []
  const out: string[] = []
  if (!(supports.styles ?? []).includes("motion")) out.push("the Motion style")
  const m = entry?.masking
  if (m && m.mode !== "off" && clipPreparationOf(m) === "full-depth") {
    if (!(supports.sourceModes ?? []).includes("full-depth")) out.push("Full depth")
    const scene = sceneOf(m)
    if (!(supports.fullDepthScenes ?? ["original"]).includes(scene)) {
      out.push(`the scene "${FULL_DEPTH_SCENES.find((s) => s.value === scene)?.label ?? scene}"`)
    }
  }
  const style = entry?.promptStyle ?? "flexible"
  if (style !== "flexible" && !(supports.promptStyles ?? []).includes(style)) out.push("the Precise prompt style")
  return out
}
