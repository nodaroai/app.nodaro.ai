/**
 * Video-analysis node — shared data contract.
 *
 * Single source of truth for the video-analysis node: the backend worker, the
 * frontend, and a future generator all import from here. Two schema layers:
 *   - `windowAnalysisSchema` — what the LLM emits per analysis window
 *     (strict-JSON footer). `scenes` has NO min (a quiet window returning zero
 *     scenes is a VALID result). Model-emitted `oversized`/`slotRefs` are
 *     STRIPPED here — they are validator-computed later (z.object drops unknown
 *     keys by default).
 *   - `videoAnalysisResultSchema` — the merged, validator-computed result across
 *     all windows; requires >=1 scene overall.
 *
 * Entity slots are referenced in scene `visual` text via `{slot:<id>}` tokens
 * (`SLOT_TOKEN_RE`) — a grammar distinct from `NODE_REF_PATTERN` and the
 * `{image:N}` reference tokens. Unresolved tokens UNWRAP to their literal id
 * text, never delete (spec invariant), so a downstream prompt never carries a
 * dangling `{slot:…}` placeholder.
 */
import { z } from "zod"

export const VIDEO_ANALYSIS_MAX_SCENE_SEC = 8
export const VIDEO_ANALYSIS_ENTITY_SOURCES = ["wired-character", "wired-object", "wired-location", "wired-creature"] as const
export type VideoAnalysisEntitySource = (typeof VIDEO_ANALYSIS_ENTITY_SOURCES)[number]
/** Matches {slot:<id>} tokens. Distinct from NODE_REF_PATTERN / {image:N} grammars. */
export const SLOT_TOKEN_RE = /\{slot:([a-z0-9-]+)\}/g

export const entitySlotSchema = z.object({
  slotId: z.string().min(1).regex(/^[a-z0-9-]+$/),
  label: z.string().min(1),
  source: z.enum(VIDEO_ANALYSIS_ENTITY_SOURCES),
  role: z.string().min(1),
  description: z.string().min(1),
})
export type EntitySlot = z.infer<typeof entitySlotSchema>

const audioSchema = z.object({
  mode: z.enum(["speech", "music", "sfx", "silence"]),
  content: z.string(), // speech: verbatim quote; music/sfx: gen-ready description; silence: "" allowed
  voice: z.string().optional(),
})

const windowSceneBase = z.object({
  startSec: z.number().min(0),
  endSec: z.number().min(0),
  label: z.string().min(1),
  shotType: z.string().min(1),
  camera: z.string(),
  visual: z.string().min(1),
  transitionOut: z.enum(["cut", "fade", "wipe", "whip"]).optional(),
  audio: audioSchema,
})
// .strip() (default) drops model-emitted oversized/slotRefs — validator-computed only.
const windowSceneSchema = windowSceneBase.refine((s) => s.endSec > s.startSec, { message: "endSec must be > startSec" })
export type WindowScene = z.infer<typeof windowSceneSchema>

/** What the MODEL emits per window (strict-JSON footer schema). scenes has NO min. */
export const windowAnalysisSchema = z.object({
  language: z.string().optional(),
  slots: z.array(entitySlotSchema),
  scenes: z.array(windowSceneSchema),
})
export type WindowAnalysis = z.infer<typeof windowAnalysisSchema>

export const analyzedSceneSchema = windowSceneBase.extend({
  sceneNumber: z.number().int().min(1),
  visualResolved: z.string().min(1),
  oversized: z.boolean().optional(),
  slotRefs: z.array(z.string()),
}).refine((s) => s.endSec > s.startSec, { message: "endSec must be > startSec" })
export type AnalyzedScene = z.infer<typeof analyzedSceneSchema>

export const videoAnalysisResultSchema = z.object({
  meta: z.object({
    durationSec: z.number().positive(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    aspectRatio: z.string(),
    title: z.string().optional(),
    language: z.string().optional(),
  }),
  slots: z.array(entitySlotSchema),
  scenes: z.array(analyzedSceneSchema).min(1),
})
export type VideoAnalysisResult = z.infer<typeof videoAnalysisResultSchema>

export function deriveSlotRefs(visual: string): string[] {
  const out: string[] = []
  for (const m of visual.matchAll(SLOT_TOKEN_RE)) if (!out.includes(m[1])) out.push(m[1])
  return out
}

export function rewriteSlotTokens(visual: string, renames: Record<string, string>): string {
  return visual.replace(SLOT_TOKEN_RE, (whole, id: string) => (renames[id] ? `{slot:${renames[id]}}` : whole))
}

/** Unresolved tokens unwrap to their literal id text — never deleted (spec invariant). */
export function unwrapUnresolvedTokens(text: string, validIds: Set<string>): { text: string; unresolved: string[] } {
  const unresolved: string[] = []
  const out = text.replace(SLOT_TOKEN_RE, (whole, id: string) => {
    if (validIds.has(id)) return whole
    if (!unresolved.includes(id)) unresolved.push(id)
    return id
  })
  return { text: out, unresolved }
}

/** Substitute {slot:x}: castMap binding wins, else the slot's description, else literal id. */
export function renderAnalyzedScene(scene: { visual: string }, slots: EntitySlot[], castMap?: Record<string, string>): string {
  const byId = new Map(slots.map((s) => [s.slotId, s]))
  return scene.visual.replace(SLOT_TOKEN_RE, (_whole, id: string) => castMap?.[id] ?? byId.get(id)?.description ?? id)
}

export function isOversizedScene(startSec: number, endSec: number): boolean {
  return endSec - startSec > VIDEO_ANALYSIS_MAX_SCENE_SEC
}

const STANDARD_RATIOS: Array<[string, number]> = [
  ["16:9", 16 / 9], ["9:16", 9 / 16], ["1:1", 1], ["4:3", 4 / 3], ["3:4", 3 / 4], ["21:9", 21 / 9],
]
export function aspectRatioFromDims(w: number, h: number): string {
  const r = w / h
  for (const [label, v] of STANDARD_RATIOS) if (Math.abs(r - v) / v < 0.03) return label
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b))
  const g = gcd(Math.round(w), Math.round(h))
  return `${Math.round(w) / g}:${Math.round(h) / g}`
}
