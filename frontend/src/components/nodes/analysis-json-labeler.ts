/**
 * Domain summaries for a `VideoAnalysisResult` rendered as a `JsonTree` — the
 * only schema knowledge in play, shared by every node that renders an analysis
 * payload (`video-analysis`, and `video-audit` whose output is the SAME
 * canonical shape after correction).
 *
 * Array items are the rows a user scans, so each gets the identity it is
 * actually looked up by (`#8 · 10.8–16.8s · intimacy`) instead of `[7]`.
 * Everything else falls through to the generic key/value rendering, so the tree
 * still mirrors the payload exactly.
 */

import { useMemo } from "react"
import type { JsonNodeLabeler, JsonValue } from "@/components/ui/json-tree"
import type { VideoAnalysisResult } from "@nodaro/shared/video"

const secs = (n: unknown) => (typeof n === "number" ? n.toFixed(1) : String(n))
const clip = (s: unknown, n = 44) => {
  const t = String(s)
  return t.length > n ? `${t.slice(0, n - 1)}…` : t
}

export function useAnalysisLabeler(result: VideoAnalysisResult | undefined): JsonNodeLabeler {
  return useMemo(() => {
    const slotLabels = new Map((result?.slots ?? []).map((s) => [s.slotId, s.label]))
    return (path, value) => {
      if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined
      const v = value as Record<string, JsonValue>

      // slots[i] / scenes[i]
      if (path.length === 2 && typeof path[1] === "number") {
        if (path[0] === "slots") return `${v.slotId} · ${v.label} · ${String(v.source).replace("wired-", "")}`
        if (path[0] === "scenes") {
          // Surface the cinematography flags that only appear on SOME shots, so a
          // slow-motion beat or a dutch angle is visible without drilling in.
          // eye-level and a clean image are the defaults and stay silent.
          const flags = [
            v.angle && v.angle !== "eye-level" ? String(v.angle) : undefined,
            v.speed,
            Array.isArray(v.effects) && v.effects.length > 0 ? v.effects.join("+") : undefined,
          ].filter(Boolean).join(" · ")
          return `#${v.sceneNumber} · ${secs(v.startSec)}–${secs(v.endSec)}s · ${v.label}${flags ? ` · ${flags}` : ""}`
        }
      }
      if (path.length !== 4 || typeof path[3] !== "number") return undefined

      // scenes[i].audio[j] — where speech attribution surfaces. Falls back to the
      // voice-casting note while the analyzer has no `speakerSlot` to give.
      if (path[0] === "scenes" && path[2] === "audio") {
        const who = typeof v.speakerSlot === "string" ? slotLabels.get(v.speakerSlot) ?? v.speakerSlot : v.voice
        return [String(v.mode), who ? clip(who, 24) : undefined, `“${clip(v.content)}”`].filter(Boolean).join(" · ")
      }
      // slots[i].variations[j]
      if (path[0] === "slots" && path[2] === "variations") return `${v.variationId} · ${v.label}`
      return undefined
    }
  }, [result])
}
