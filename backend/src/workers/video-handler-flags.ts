/**
 * What the video worker reads off its handlers, by job type: the flags a
 * handler declares on itself (`HandlerFn` — the background scrapes declare
 * all four), derived from the complete handler map rather than hand-listed,
 * so a new handler that declares one is covered with no list to update.
 */
import type { HandlerFn, JobContext } from "./shared.js"
import type { CapacityGroupName } from "./worker-capacity.js"

export interface VideoHandlerFlags {
  /** The job types whose output is data, not media (`HandlerFn.outputIsData`). */
  readonly dataOutput: ReadonlySet<string>
  /** The job types whose handler re-attaches to its row's provider task itself (`HandlerFn.resumesProviderTask`). */
  readonly resuming: ReadonlySet<string>
  /** The job types a quietly stopped account still runs (`HandlerFn.ignoresQuietStop`). */
  readonly quietStopExempt: ReadonlySet<string>
  /** Each job type's per-process capacity group (`HandlerFn.capacityGroup`). */
  readonly capacityGroups: ReadonlyMap<string, CapacityGroupName>
}

/** The flags of `handlers` — read once the map is complete. */
export function videoHandlerFlags(handlers: Readonly<Record<string, HandlerFn>>): VideoHandlerFlags {
  const entries = Object.entries(handlers)
  const flagged = (flag: (h: HandlerFn) => boolean): ReadonlySet<string> => new Set(entries.filter(([, h]) => flag(h)).map(([name]) => name))
  return {
    dataOutput: flagged((h) => h.outputIsData === true),
    resuming: flagged((h) => h.resumesProviderTask === true),
    quietStopExempt: flagged((h) => h.ignoresQuietStop === true),
    capacityGroups: new Map(entries.flatMap(([name, h]): Array<[string, CapacityGroupName]> => (h.capacityGroup ? [[name, h.capacityGroup]] : []))),
  }
}

/** The task a re-attaching handler waits on instead of starting one: its row's saved provider task, if any. */
export function savedProviderTaskOf(
  resumesTask: boolean,
  row: { provider_task_id?: unknown; provider_kind?: unknown } | null | undefined,
): JobContext["providerTask"] {
  return resumesTask && typeof row?.provider_task_id === "string" && row.provider_task_id
    ? { kind: (row.provider_kind as string | null) ?? null, id: row.provider_task_id }
    : undefined
}
