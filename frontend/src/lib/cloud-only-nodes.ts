/**
 * Edition/connection gating for node types, frontend half.
 *
 * Single source of truth for the node pickers (via `getNodeOptions()` in
 * `node-options.tsx`) — they used to hand-copy this Set and drifted. The
 * backend keeps a mirrored copy at `backend/src/lib/cloud-only-nodes.ts`;
 * its guard test (backend/src/lib/__tests__/cloud-only-nodes.test.ts) reads
 * BOTH files as text and fails CI when they drift: each hand-written list
 * stays a plain parseable `new Set([...])` literal (wrapped or not), and the
 * two must be equal. A node unit joins the exclusive set by declaring the
 * "edition:nodaro-exclusive" capability — both files compose it with
 * `unitsWith(…, "edition:nodaro-exclusive")`, from the same unit.json
 * manifests, which the guard checks too.
 */
import { UNIT_NODE_DEFINITIONS } from "./unit-definitions"
import { composeSet, unitsWith } from "./unit-compose"
// @registry-enumerates NODARO_EXCLUSIVE_NODE_TYPES carries every node unit with the "edition:nodaro-exclusive" capability

/**
 * The Nodaro-EXCLUSIVE node types (4b): implemented by @nodaroai/cloud-plugins
 * on the cloud; self-hosted editions relay them to the cloud through the
 * nodaro.ai connection. They save everywhere (a workflow is data) and gate at
 * run time on the connection, not on edition.
 *
 * NOTE (PR 3 of 4b): the pickers still filter these out on self-host —
 * surfacing them with the NODARO mark + connect CTA is the next PR. This
 * split is data-only so backend discovery/relay and the frontend land in
 * lockstep without a UI flash of unrunnable nodes. A node unit joins with the
 * "edition:nodaro-exclusive" capability.
 */
export const NODARO_EXCLUSIVE_NODE_TYPES: ReadonlySet<string> = composeSet("NODARO_EXCLUSIVE_NODE_TYPES", new Set([
  "voice-changer-pro",
  "generate-video-pro",
  "edit-video-pro",
  // video-analysis's implementation moved to @nodaroai/cloud-plugins; unlike
  // the three above (born exclusive) it USED to run on community/business
  // self-hosts — the relay restores that, through the nodaro.ai connection.
  "video-analysis",
  // AI Audit ships in the SAME private plugin as video-analysis.
  "video-audit",
  // Edit Plan (podcast editing) is born exclusive — the transcript-driven
  // cut / clip / chapter planner runs in the private cloud plugin.
  "edit-plan",
  "camera-switch",
  // Speaker View (C3.2): the plugin's renderer; relayed from a self-host.
  "speaker-view",
  // Speaker Frames (P3.6): face tracks per camera; detection runs on the cloud
  // worker, a connected self-host relays it (P3-15).
  "speaker-frames",
]), unitsWith(UNIT_NODE_DEFINITIONS, "edition:nodaro-exclusive"))

/**
 * Truly Cloud-only: no relay exists. The Generative Pipeline canvas node
 * drives POST /v1/pipelines, whose every handler is edition-gated
 * (routes/pipelines.ts gateEdition) and whose worker only starts on Cloud —
 * an interactive engine, out of the 4b relay's scope by design. It was
 * addable on community and 403'd on launch (community grind, 2026-08-13).
 */
export const CLOUD_ONLY_NODE_TYPES: ReadonlySet<string> = new Set([
  "generative-pipeline",
  // 3D Render Pro: the operation runs on a hosted private build service that
  // no relay fronts, and it settles credits — a credit-less edition has
  // nothing to charge and nothing to call.
  "pro-3d-render",
  // Telegram account trigger: listens through an account held by a private
  // plugin daemon on the cloud; no relay fronts it.
  "telegram-account-trigger",
  // Content Recipe + Content Ideas ("steal the format"): the prompts are a
  // private plugin's and no relay fronts them yet.
  "content-recipe",
  "content-ideas",
  // Social Search: the search runs in a private plugin and no relay fronts it.
  "social-search",
  // Read Competitor: a tracked brand's scans are served by a private plugin;
  // no relay fronts them.
  "competitor-read",
  // Telegram Reply: sends through an account held by a private plugin daemon
  // on the cloud (or the owner's bot, chosen there); no relay fronts it.
  "telegram-account-send",
  // UGC video nodes: a private plugin serves every route; no relay fronts them.
  "ugc-creator",
  "ugc-script",
  "ugc-clips",
  "ugc-clip",
  "ugc-cards",
  "ugc-finish-clips",
])
