// tools/test-dedup/node-reporter.mjs
// A node:test reporter that prints one JSON line per test event — what
// runners.mjs's createNodeTestRunner reads back from a `node --test` child.
// (The runner spawns a child instead of calling node:test's run(): run() inside
// a test file — the harness's own self-test — refuses to run files.)
// @reads-none it only serializes the events node:test hands it
export default async function* jsonLines(source) {
  for await (const event of source) {
    if (!["test:start", "test:pass", "test:fail"].includes(event.type)) continue
    const d = event.data
    const failureType = d.details?.error?.failureType
    yield `${JSON.stringify({
      type: event.type, name: d.name, nesting: d.nesting, file: d.file,
      suite: d.details?.type === "suite", skip: d.skip !== undefined || d.todo !== undefined,
      // A test its suite's failed hook never let run (node reports it as
      // cancelled), and a hook failure itself: a kill, not a non-event.
      cancelled: failureType === "cancelledByParent",
      hookFailed: failureType === "hookFailed",
      timedOut: /timed out/i.test(String(d.details?.error?.message ?? d.details?.error?.cause?.message ?? "")),
    })}\n`
  }
}
