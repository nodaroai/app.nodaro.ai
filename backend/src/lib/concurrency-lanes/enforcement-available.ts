// backend/src/lib/concurrency-lanes/enforcement-available.ts — whether
// concurrency limits may be turned on at all in this release.
//
// Not yet (decided 2026-10-31). Jobs can already wait for a slot, but what
// waiting needs around it — a resumed run adopting its waiting children,
// workflow and coordinator clocks that grow by the time spent waiting, plugin
// jobs that declare their lanes and wait for a child queue-aware, and the
// clients' polling deadlines — lands in later releases. Until then:
//   - the Admin switch refuses to turn limits on (409 `not_available_yet`),
//     with or without a confirmation of unmet preconditions;
//   - the enforcement mirror copies "off" into the gate whatever the stored
//     setting or LANES_ENFORCED says (and an on → off edge wakes any waiter);
//   - measuring is unaffected: every job is still counted in its lane, and one
//     over its limit runs as an over-limit lease, recorded as "would have waited".
// Turning limits off is always allowed. A later release flips this constant.
// No imports.

/** Whether concurrency limits may be turned on in this release. */
export const LANES_ENFORCEMENT_AVAILABLE = false
