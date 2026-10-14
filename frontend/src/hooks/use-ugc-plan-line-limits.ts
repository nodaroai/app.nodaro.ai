import { useMemo } from "react"
import { useQuery } from "@tanstack/react-query"
import { UGC_SCRIPT_DEFAULT_TARGET_SEC } from "@nodaro/shared/ugc"
import { hasCredits } from "@/lib/edition"
import { ugcRunEstimateQuery } from "@/components/editor/workflow-editor/ugc-run-estimate"
import type { ScriptLineLimits } from "@/lib/ugc-script-edit"

/** Every estimate answer carries the same limits, whatever the video asked: one request for every script panel. */
const ANY_VIDEO = { targetDurationSec: UGC_SCRIPT_DEFAULT_TARGET_SEC, screenshotCount: 0, source: "sampled" } as const

/** A limit as the server hands it: a whole number of characters, at least one. */
const isLimit = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x > 0

/** The limits as the server hands them, read untrusted: all three, or none. */
export function readUgcPlanLineLimits(raw: unknown): ScriptLineLimits | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined
  const { hook, beatLine, closerLine } = raw as Record<string, unknown>
  return isLimit(hook) && isLimit(beatLine) && isLimit(closerLine) ? { hook, beatLine, closerLine } : undefined
}

/**
 * The plan's line limits — the most characters the opening line, a beat's line and the closing line
 * take — as the server hands them with a UGC estimate (`/v1/ugc/quote`): the plugin's own plan
 * schema, so the app holds no copy. Undefined until that answer is in, where no estimate is served,
 * and where the server has none to give (an older plugin): the script editor then sets no limit, and
 * UGC Clips refuses an over-long line as before.
 */
export function useUgcPlanLineLimits(): ScriptLineLimits | undefined {
  const { data } = useQuery({ ...ugcRunEstimateQuery(ANY_VIDEO), enabled: hasCredits() })
  return useMemo(() => readUgcPlanLineLimits(data?.limits), [data])
}
