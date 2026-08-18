/**
 * Edition/connection gating for node types, frontend half.
 *
 * Single source of truth for the node pickers (via `getNodeOptions()` in
 * `node-options.tsx`) — they used to hand-copy this Set and drifted. The
 * backend keeps a mirrored copy at `backend/src/lib/cloud-only-nodes.ts`;
 * its guard test parses THIS file and fails CI when the two drift, so keep
 * both sets as plain parseable `new Set([...])` literals.
 */

/**
 * The Nodaro-EXCLUSIVE node types (4b): implemented by @nodaroai/cloud-plugins
 * on the cloud; self-hosted editions relay them to the cloud through the
 * nodaro.ai connection. They save everywhere (a workflow is data) and gate at
 * run time on the connection, not on edition.
 *
 * NOTE (PR 3 of 4b): the pickers still filter these out on self-host —
 * surfacing them with the NODARO mark + connect CTA is the next PR. This
 * split is data-only so backend discovery/relay and the frontend land in
 * lockstep without a UI flash of unrunnable nodes.
 */
export const NODARO_EXCLUSIVE_NODE_TYPES: ReadonlySet<string> = new Set([
  "voice-changer-pro",
  "generate-video-pro",
  "edit-video-pro",
  // video-analysis's implementation moved to @nodaroai/cloud-plugins; unlike
  // the three above (born exclusive) it USED to run on community/business
  // self-hosts — the relay restores that, through the nodaro.ai connection.
  "video-analysis",
  // AI Audit ships in the SAME private plugin as video-analysis.
  "video-audit",
])

/**
 * Truly Cloud-only: no relay exists. The Generative Pipeline canvas node
 * drives POST /v1/pipelines, whose every handler is edition-gated
 * (routes/pipelines.ts gateEdition) and whose worker only starts on Cloud —
 * an interactive engine, out of the 4b relay's scope by design. It was
 * addable on community and 403'd on launch (community grind, 2026-08-13).
 */
export const CLOUD_ONLY_NODE_TYPES: ReadonlySet<string> = new Set([
  "generative-pipeline",
])
