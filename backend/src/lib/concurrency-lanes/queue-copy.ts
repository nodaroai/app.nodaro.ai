// backend/src/lib/concurrency-lanes/queue-copy.ts — the English sentences the
// server's own text answers (the MCP job tools) use to say why a job waits and
// where it stands in line. The editor says the same in its i18n dicts; an AI
// agent reads English. No imports but a type, so any text answer can use it.
import type { QueueInfo } from "./queue-info.js"

/** `n` as an English ordinal: 1st, 2nd, 3rd, 4th, 11th, 12th, 13th, 21st, 112th… */
export function englishOrdinal(n: number): string {
  const tail = n % 100
  if (tail >= 11 && tail <= 13) return `${n}th`
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`
}

const CALL_AGAIN = "Call wait_for_job again to keep waiting."

/**
 * What an agent is told about a job that waits for a slot, ending with what to
 * do next. A run waits "to start"; the payer's own full line names its plan's
 * limit; a provider ceiling and the server's share are both "busy across the
 * platform" (never naming the provider).
 */
export function mcpQueueLine(q: Pick<QueueInfo, "lane" | "position" | "limit" | "reason">): string {
  const ordinal = englishOrdinal(q.position)
  // A provider ceiling or the server's share is "busy across the platform"
  // whatever the lane: its limit is not the plan's, so it is never named.
  if (q.reason !== "user_lane") return `Waiting — busy across the platform, ${ordinal} in line. ${CALL_AGAIN}`
  if (q.lane === "run") return `Waiting to start — ${ordinal} in line, your plan allows ${q.limit} ${q.limit === 1 ? "run" : "runs"} at once. ${CALL_AGAIN}`
  return `Still waiting — ${ordinal} in line (your plan runs ${q.limit} at once). ${CALL_AGAIN}`
}

/** What would shorten the wait, for a payer whose own line is full; null without a hint. */
export function upgradeHintLine(hint: QueueInfo["upgradeHint"]): string | null {
  switch (hint) {
    case "plan":
      return "Need more at once? Upgrade your plan."
    case "workspace":
      return "Need more at once? Ask your workspace owner to upgrade."
    default:
      return null
  }
}

/** The queue line and, when the queue carries one, its upgrade hint. */
export function mcpQueueText(q: QueueInfo): string {
  const hint = upgradeHintLine(q.upgradeHint)
  return hint ? `${mcpQueueLine(q)} ${hint}` : mcpQueueLine(q)
}
