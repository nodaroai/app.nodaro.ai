/**
 * `@nodaro/shared/ugc` — UGC run state, call bodies, node wires and lane wires.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/shared`.
 */
// UGC run state: which node-data keys are a run's state (stripped on publish) and which a runner may override.
export * from "../ugc-run-state.js"
// UGC builder call → the REST body of the public route it dispatches to (the canvas and the app run the builder's calls through it).
export * from "../ugc-call-body.js"
// UGC node wires: every UGC node's request body and outputs, one implementation for the orchestrator and the editor.
export * from "../ugc-node-wires.js"
export * from "../ugc-lane-wires.js"
