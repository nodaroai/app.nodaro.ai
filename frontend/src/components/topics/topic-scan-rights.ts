import type { TrackedTopic } from "@nodaro/shared/social"
import type { useT } from "@/lib/i18n"

/**
 * Which topics the plan lets scan now, decided the way the server decides it
 * (`POST /v1/topic-scan` refuses the rest with 403 `topic_limit`): none on a
 * plan without topics; after a downgrade to fewer topics than the person
 * follows, only the oldest ones the plan allows, oldest by creation and then
 * by id.
 */

/** Why a topic cannot scan: the plan has no topics, or it follows more than the plan allows and this is not among the oldest. */
export type ScanBlock = "locked" | "overCap"

/** The topics that cannot scan now, each with why; empty when every topic can. `limit` null or absent: no cap. */
export function scanBlocks(topics: readonly Pick<TrackedTopic, "id" | "createdAt">[], limit: number | null | undefined): ReadonlyMap<string, ScanBlock> {
  if (limit === null || limit === undefined || topics.length <= limit) return new Map()
  if (limit <= 0) return new Map(topics.map((topic) => [topic.id, "locked" as const]))
  const oldestFirst = [...topics].sort(oldestFirstOrder)
  return new Map(oldestFirst.slice(limit).map((topic) => [topic.id, "overCap" as const]))
}

/** Created first, then the smaller id (character by character: for lowercase hex ids, the database's own order). */
function oldestFirstOrder(a: Pick<TrackedTopic, "id" | "createdAt">, b: Pick<TrackedTopic, "id" | "createdAt">): number {
  const byTime = Date.parse(a.createdAt) - Date.parse(b.createdAt)
  if (byTime !== 0 && Number.isFinite(byTime)) return byTime
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

/** Why a topic cannot scan, in the reader's words. */
export function scanBlockText(block: ScanBlock, limit: number | null | undefined, t: ReturnType<typeof useT>): string {
  if (block === "locked") return t("topics.scanBlockedLocked")
  return limit === 1 ? t("topics.scanBlockedOverCapOne") : t("topics.scanBlockedOverCap", { n: limit ?? 0 })
}
