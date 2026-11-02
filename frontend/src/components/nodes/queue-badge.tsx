"use client"

import { Hourglass } from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import type { LocaleId } from "@nodaro/shared/i18n"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { useLocaleStore } from "@/lib/locale-store"
import { translate } from "@/lib/i18n"
import { DICTS } from "@/lib/i18n/dicts"
import type { MessageKey } from "@/lib/i18n/en"
import type { JobQueueInfo } from "@/lib/api"
import { isNodesJob, type NodeQueueInfo } from "@/components/editor/workflow-editor/node-queue-info"

/** The dict key of each ordinal category (Intl.PluralRules `type: "ordinal"`). */
const ORDINAL_KEYS: Record<Intl.LDMLPluralRule, MessageKey> = {
  zero: "node.queue.ordinalOther",
  one: "node.queue.ordinalOne",
  two: "node.queue.ordinalTwo",
  few: "node.queue.ordinalFew",
  many: "node.queue.ordinalOther",
  other: "node.queue.ordinalOther",
}

/**
 * `n` as an ordinal in `locale` ("3rd", "מקום 3", "3 番目"). The category comes
 * from Intl's ordinal rules of the language the words come from: a locale whose
 * dict has no ordinal of its own shows the English words, so English rules
 * pick them (Spanish rules would make every English ordinal "th").
 */
export function queueOrdinal(locale: LocaleId, n: number): string {
  const rulesLocale = DICTS[locale]?.["node.queue.ordinalOther"] !== undefined ? locale : "en"
  const category = new Intl.PluralRules(rulesLocale, { type: "ordinal" }).select(n)
  return translate(locale, ORDINAL_KEYS[category], { n })
}

/**
 * What the badge says about a job waiting for a free slot: why it waits and
 * where it stands, then — only when the server says so (`upgradeHint`, set
 * only when the payer's own line is full) — what would shorten the wait.
 *
 * - its own line is full: the plan's limit ("your plan runs 4 at once"), or,
 *   for a whole run, the runs it allows;
 * - a provider ceiling or the server's share: "busy across the platform",
 *   whatever the lane — that limit is not the plan's, so it is never named.
 */
export function queueBadgeText(locale: LocaleId, queue: JobQueueInfo): { line: string; upgrade: string | null } {
  const ordinal = queueOrdinal(locale, queue.position)
  // A limit of 1 takes the `…One` sentence, which writes the 1 itself ("allows
  // 1 run at once"): the dicts' way of agreeing a sentence with its count.
  const one = queue.limit === 1
  const line =
    queue.reason !== "user_lane"
      ? translate(locale, "node.queue.busy", { ordinal })
      : queue.lane === "run"
        ? translate(locale, one ? "node.queue.runWaitingOne" : "node.queue.runWaiting", { ordinal, limit: queue.limit })
        : translate(locale, one ? "node.queue.waitingOne" : "node.queue.waiting", { ordinal, limit: queue.limit })
  const upgrade =
    queue.upgradeHint === "plan"
      ? translate(locale, "node.queue.upgradePlan")
      : queue.upgradeHint === "workspace"
        ? translate(locale, "node.queue.upgradeWorkspace")
        : null
  return { line, upgrade }
}

/**
 * "Waiting — 3rd in line, your plan runs 4 at once" on a node whose job waits
 * for a free concurrency slot (`data.queueInfo`, kept by the poll funnel).
 *
 * Like <NodeConnectionBadge>, it is mounted once by BaseNode and reads the
 * store by node id, so every node card shows it without a prop. It renders
 * only while the node is running or pending (a restored job that waits is
 * `pending`) AND the place in line is its own job's (`queueInfo.jobId` is the
 * node's `currentJobId`, or any job of a running List fan-out) — so one left
 * behind by a run that has ended, or by a job the node moved on from, never
 * sits on the card; and not while the node's job cannot be read, when its
 * place in line is no longer known ("Reconnecting…" shows instead).
 *
 * The upgrade line is the server's word only: "plan" links to the pricing page
 * (in a new tab, so the editor and its run stay open); "workspace" asks the
 * owner. It sits along the card's top edge, clear of the bottom badge.
 */
export function QueueBadge({ nodeId }: { readonly nodeId: string }) {
  const locale = useLocaleStore((s) => s.locale)
  const queue = useWorkflowStore(
    useShallow((s: { nodes: Array<{ id: string; data?: unknown }> }) => {
      const d = s.nodes.find((n) => n.id === nodeId)?.data as Record<string, unknown> | undefined
      const q = d?.queueInfo as NodeQueueInfo | undefined
      const live = d?.executionStatus === "running" || d?.executionStatus === "pending"
      return q && live && d?.jobConnectionLost !== true && isNodesJob(d, q.jobId) ? q : undefined
    }),
  )

  if (!queue) return null
  const { line, upgrade } = queueBadgeText(locale, queue)

  return (
    <div
      role="status"
      className="absolute left-2 right-2 top-9 z-20 flex flex-col items-center gap-0.5 rounded-lg border border-sky-500/60 bg-sky-950/85 px-2.5 py-1 text-center text-[11px] font-medium leading-snug text-sky-100 backdrop-blur-[2px]"
    >
      <span className="flex items-center gap-1.5">
        <Hourglass className="h-3.5 w-3.5 shrink-0 text-sky-300" aria-hidden />
        <span>{line}</span>
      </span>
      {upgrade !== null &&
        (queue.upgradeHint === "plan" ? (
          <a
            href="/pricing"
            target="_blank"
            rel="noopener noreferrer"
            // Not a click on the node: no select, no drag, no pan.
            className="nodrag nopan text-sky-300 underline underline-offset-2 hover:text-sky-200"
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {upgrade}
          </a>
        ) : (
          <span className="text-sky-300">{upgrade}</span>
        ))}
    </div>
  )
}
