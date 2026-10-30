// backend/src/lib/concurrency-lanes/leaf-lanes.ts — the one closed list of
// leaf lanes. No imports, so any module can read it without a cycle (the job
// lane registry imports unit-descriptors.ts, which needs it too), and kept out
// of types.ts so that file stays type-only: a value import of it would make
// every test that reaches a unit descriptor depend on the whole vocabulary.

/**
 * The lanes a leaf job holds one slot of while it runs (`run` is held only by
 * a top-level coordinator). The unit lane reader and the job lane registry
 * both admit exactly these.
 */
export const LEAF_LANES = ["provider", "llm", "local"] as const

/** A lane a leaf job holds one slot of while it runs. */
export type LeafLane = (typeof LEAF_LANES)[number]

/** Whether `lane` is one of LEAF_LANES. */
export function isLeafLane(lane: unknown): lane is LeafLane {
  return (LEAF_LANES as readonly unknown[]).includes(lane)
}
