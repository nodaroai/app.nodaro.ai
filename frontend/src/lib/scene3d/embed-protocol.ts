/**
 * The `/embed/scene3d` postMessage contract — a VERSIONED, documented endpoint.
 *
 * The embed is a stateless viewer: it holds no session, makes no API call, and
 * owns no scene. A parent page (studio.nodaro.ai and friends) keeps the whole
 * state and pushes one validated snapshot per revision; the child paints it and
 * reports back what the user did. Nothing else crosses the frame — no token, no
 * cookie, no workflow id, no nested-frame privilege.
 *
 * Three checks, in this order, decide whether a message is ours:
 *
 * 1. **Transport** — `event.source` must be the window we were framed by and
 *    `event.origin` must equal the `parentOrigin` we were handed in the URL,
 *    string-for-string. A mismatch is IGNORED silently: another frame's traffic
 *    is not an error the user should see.
 * 2. **Addressing** — `type` and `channel` must match. A stale frame from a
 *    previous dialog shares our origin and would otherwise repaint us, so the
 *    channel (a random UUID minted per mount by the parent) is what makes two
 *    embeds on one page independent. A mismatch is likewise IGNORED.
 * 3. **Content** — everything else is a REJECT with a sentence the user sees.
 *    An unknown `version`, a malformed envelope, an oversized list, a scene that
 *    fails `scene3DPlanSchema`: the frame says so and keeps the last snapshot it
 *    accepted, because blanking a scene the user is looking at is worse than
 *    telling them the newest push was refused.
 *
 * Everything outbound is posted to the EXACT `parentOrigin`. There is no `"*"`
 * target anywhere in this feature.
 */
import { z } from "zod"
import { SCENE3D_LIMITS } from "@nodaro/shared"
import type { Scene3DRevisionEntry } from "@/types/nodes"
import type { Scene3DV2EditOperation } from "@nodaro/shared"
import { validateScene3DAnyPlan } from "./validate-plan"

/** The route this contract belongs to. Quoted by the router and the docs. */
export const SCENE3D_EMBED_PATH = "/embed/scene3d"

/**
 * The BASELINE version — every frame speaks it and every `ready` still declares
 * it, so a parent written against version 1 keeps working unchanged.
 *
 * Bumped only for a BREAKING change. Version 2 is not one: it is a superset
 * that adds v2 scenes and the asset transport they need
 * (`embed-asset-transport.ts`). A frame handed a version it does not implement
 * refuses the payload rather than guessing.
 */
export const SCENE3D_EMBED_PROTOCOL_VERSION = 1

/** Adds: v2 (`schemaVersion: 2`) scenes, asset requests, `edit-operations`. */
export const SCENE3D_EMBED_PROTOCOL_VERSION_2 = 2

/** Everything this frame accepts on an inbound `state`, newest last. */
export const SCENE3D_EMBED_PROTOCOL_VERSIONS = [
  SCENE3D_EMBED_PROTOCOL_VERSION,
  SCENE3D_EMBED_PROTOCOL_VERSION_2,
] as const

export type Scene3DEmbedProtocolVersion = (typeof SCENE3D_EMBED_PROTOCOL_VERSIONS)[number]

/** Scene schema versions this build can draw. Advertised in the handshake. */
export const SCENE3D_EMBED_SCENE_SCHEMA_VERSIONS = [1, 2] as const

export const SCENE3D_EMBED_STATE_TYPE = "nodaro:scene3d:state"
export const SCENE3D_EMBED_READY_TYPE = "nodaro:scene3d:ready"
export const SCENE3D_EMBED_EVENT_TYPE = "nodaro:scene3d:event"

/**
 * Bounds that belong to the TRANSPORT rather than to a scene. Scene-shaped
 * limits (object count, keyframes, id length, summary length) are quoted from
 * `SCENE3D_LIMITS` so this file can never drift from the wire contract.
 */
export const SCENE3D_EMBED_LIMITS = {
  /** Longest `parentOrigin` we will even try to parse. */
  maxParentOriginLength: 255,
  /** Revisions a parent may push. The panel shows a scrollback, not an archive. */
  maxHistoryEntries: 12,
  /** Ceiling on `selectedObjectIds` / `lockedObjectIds`. One more than the
   *  scene's own object ceiling would already be nonsense. */
  maxObjectIdList: 100,
  /** ISO-8601 is ~24 chars; this is slack, not a format. */
  maxCreatedAtLength: 64,
  /** Both the revision summary and the retained context prompt. */
  maxTextLength: SCENE3D_LIMITS.maxChangeSummaryLength,
} as const

// ---------------------------------------------------------------------------
// URL parameters
// ---------------------------------------------------------------------------

/** RFC-4122 shape. `crypto.randomUUID()` (what the parent must use) is v4. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

export type Scene3DEmbedParams =
  | { ok: true; parentOrigin: string; channel: string }
  | { ok: false; error: string }

/**
 * Read `?parentOrigin=…&channel=…`.
 *
 * `parentOrigin` must ALREADY be in normalized origin form — `new URL(raw).origin`
 * has to equal `raw` exactly. That is not pedantry: `MessageEvent.origin` is
 * browser-normalized (lowercased host, no trailing slash, no default port), so
 * demanding the same spelling here is what makes the later `===` comparison a
 * sound identity check instead of a string coincidence. `"null"`, an opaque
 * origin, a `file:`/`data:` URL and anything carrying a path are all refused.
 */
export function parseScene3DEmbedParams(search: string): Scene3DEmbedParams {
  const params = new URLSearchParams(search)
  const rawOrigin = params.get("parentOrigin")
  const channel = params.get("channel")

  if (!rawOrigin) return { ok: false, error: "missing parentOrigin" }
  if (rawOrigin.length > SCENE3D_EMBED_LIMITS.maxParentOriginLength) {
    return { ok: false, error: "parentOrigin is too long" }
  }
  let url: URL
  try {
    url = new URL(rawOrigin)
  } catch {
    return { ok: false, error: "parentOrigin must be an absolute http(s) origin" }
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "parentOrigin must be an absolute http(s) origin" }
  }
  if (url.origin !== rawOrigin) {
    return { ok: false, error: "parentOrigin must be an exact origin with no path, query or trailing slash" }
  }
  if (!channel) return { ok: false, error: "missing channel" }
  if (!UUID.test(channel)) return { ok: false, error: "channel must be a random UUID" }

  return { ok: true, parentOrigin: rawOrigin, channel }
}

// ---------------------------------------------------------------------------
// Inbound: parent → embed
// ---------------------------------------------------------------------------

/** The snapshot the embed renders. Every field is already validated. */
export interface Scene3DEmbedState {
  scenePlan: Record<string, unknown>
  selectedObjectIds: string[]
  lockedObjectIds: string[]
  history: Scene3DRevisionEntry[]
  pendingPlan?: Record<string, unknown>
  isGenerating: boolean
  /** DEFAULTS TO TRUE. A parent that forgets to say gets the safe answer. */
  readOnly: boolean
  /** The version the PARENT declared on this push. What the frame may ask of
   *  it — asset bytes, v2 edits — is bounded by this, not by what the frame can
   *  do: a version-1 parent has no handler for either. */
  protocolVersion: Scene3DEmbedProtocolVersion
  /** The scene's own schema version. Decides which panel is rendered. */
  planVersion: 1 | 2
  /** The revision the accepted scene carries. Stamped on outbound events and
   *  used to scope asset requests to the scene actually on screen. */
  revisionId: string
}

export type Scene3DEmbedVerdict =
  /** Not addressed to us. No UI, no error — this is another frame's traffic. */
  | { kind: "ignore" }
  /** Ours, and wrong. The frame shows `reason` and keeps its last good state. */
  | { kind: "reject"; reason: string }
  | { kind: "accept"; state: Scene3DEmbedState }

const idListSchema = z
  .array(z.string().min(1).max(SCENE3D_LIMITS.maxIdLength))
  .max(SCENE3D_EMBED_LIMITS.maxObjectIdList)

/**
 * Only `prompt` is kept: it is the one context field the panel renders (as the
 * restore button's tooltip). The rest of `Scene3DRevisionContext` — model,
 * temperature, the resolved reference set — is authoring metadata the viewer
 * has no use for, and the embed never echoes history back, so dropping it costs
 * the parent nothing. Non-strict on purpose: a parent may hand us the whole
 * context object and the extra keys are stripped, not refused.
 */
const contextSchema = z.object({
  prompt: z.string().max(SCENE3D_EMBED_LIMITS.maxTextLength).optional(),
})

const historyEntrySchema = z
  .object({
    revisionId: z.uuid(),
    scenePlan: z.unknown(),
    source: z.enum(["generate", "edit", "manual", "upstream"]),
    changeSummary: z.string().max(SCENE3D_EMBED_LIMITS.maxTextLength).optional(),
    createdAt: z.string().max(SCENE3D_EMBED_LIMITS.maxCreatedAtLength),
    context: contextSchema.optional(),
  })
  .strict()

/**
 * Strict on purpose. Forward compatibility is what `version` is for — a parent
 * that grows a field bumps the version, and a frame that does not know the new
 * version refuses the payload out loud instead of silently ignoring half of it.
 */
const stateEnvelopeSchema = z
  .object({
    type: z.literal(SCENE3D_EMBED_STATE_TYPE),
    version: z.union([
      z.literal(SCENE3D_EMBED_PROTOCOL_VERSION),
      z.literal(SCENE3D_EMBED_PROTOCOL_VERSION_2),
    ]),
    channel: z.string(),
    scenePlan: z.unknown(),
    selectedObjectIds: idListSchema.optional(),
    lockedObjectIds: idListSchema.optional(),
    history: z.array(historyEntrySchema).max(SCENE3D_EMBED_LIMITS.maxHistoryEntries).optional(),
    pendingPlan: z.unknown().optional(),
    isGenerating: z.boolean().optional(),
    readOnly: z.boolean().optional(),
  })
  .strict()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * O(1) size rejections taken BEFORE zod, for the same reason
 * `validate-plan.ts::oversized` exists: zod walks every element of an array
 * before reporting the array is over its `.max()`, so a 100k-entry history
 * would be fully traversed just to be told it is too long. These are the
 * checks where the input SIZE is the attack.
 */
function oversizedList(data: Record<string, unknown>): string | null {
  const history = data.history
  if (Array.isArray(history) && history.length > SCENE3D_EMBED_LIMITS.maxHistoryEntries) {
    return `history has ${history.length} revisions; the limit is ${SCENE3D_EMBED_LIMITS.maxHistoryEntries}`
  }
  for (const key of ["selectedObjectIds", "lockedObjectIds"] as const) {
    const list = data[key]
    if (Array.isArray(list) && list.length > SCENE3D_EMBED_LIMITS.maxObjectIdList) {
      return `${key} has ${list.length} entries; the limit is ${SCENE3D_EMBED_LIMITS.maxObjectIdList}`
    }
  }
  return null
}

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0]
  if (!issue) return "malformed message"
  const path = issue.path.join(".")
  return path ? `${path}: ${issue.message}` : issue.message
}

export interface Scene3DEmbedTransport {
  data: unknown
  origin: string
  /** `MessageEvent.source`. Compared by IDENTITY against `expectedSource`. */
  source: unknown
}

export interface Scene3DEmbedContext {
  parentOrigin: string
  channel: string
  /** `window.parent` at the call site. Passed in so this module stays DOM-free. */
  expectedSource: unknown
}

/**
 * The one funnel every inbound message goes through. DOM-free and pure, so the
 * adversarial cases are unit-testable without a browser.
 */
export function classifyScene3DEmbedMessage(
  transport: Scene3DEmbedTransport,
  context: Scene3DEmbedContext,
): Scene3DEmbedVerdict {
  // 1. Transport. Both halves matter: origin alone would trust ANY frame served
  //    from the parent's origin (an ad slot, a sibling iframe), and source alone
  //    would trust a parent that has since navigated elsewhere.
  if (transport.source !== context.expectedSource) return { kind: "ignore" }
  if (transport.origin !== context.parentOrigin) return { kind: "ignore" }

  // 2. Addressing.
  const data = transport.data
  if (!isRecord(data)) return { kind: "ignore" }
  if (data.type !== SCENE3D_EMBED_STATE_TYPE) return { kind: "ignore" }
  if (data.channel !== context.channel) return { kind: "ignore" }

  // 3. Content. From here on every failure is visible.
  if (!(SCENE3D_EMBED_PROTOCOL_VERSIONS as readonly unknown[]).includes(data.version)) {
    return {
      kind: "reject",
      reason: `unsupported protocol version ${String(data.version)}; this embed speaks version ${SCENE3D_EMBED_PROTOCOL_VERSIONS.join(" and ")}`,
    }
  }
  const tooBig = oversizedList(data)
  if (tooBig) return { kind: "reject", reason: tooBig }

  const parsed = stateEnvelopeSchema.safeParse(data)
  if (!parsed.success) return { kind: "reject", reason: firstIssue(parsed.error) }
  const message = parsed.data

  // Said plainly rather than through the validator, whose "this node holds no
  // scene data" is editor vocabulary — there is no node here.
  if (message.scenePlan === undefined) return { kind: "reject", reason: "scenePlan is required" }
  const scene = validateScene3DAnyPlan(message.scenePlan)
  if (!scene.ok) return { kind: "reject", reason: `scenePlan — ${scene.issue}` }

  // A v2 scene is ids and digests; its geometry and its baked camera only reach
  // the frame through the parent's asset transport, which exists in protocol 2
  // and not in protocol 1. Accepting it from a version-1 parent would mean a
  // frame that is never going to draw, and no message saying why — so the push
  // is refused with the reason instead.
  if (scene.version === 2 && message.version < SCENE3D_EMBED_PROTOCOL_VERSION_2) {
    return {
      kind: "reject",
      reason: `scenePlan — this scene uses schema version 2, which needs embed protocol version ${SCENE3D_EMBED_PROTOCOL_VERSION_2} (asset transport)`,
    }
  }

  const history: Scene3DRevisionEntry[] = []
  for (const [index, entry] of (message.history ?? []).entries()) {
    // EVERY plan is validated, not just the active one: the panel restores from
    // history, so an unchecked entry is an unchecked plan one click away.
    const entryScene = validateScene3DAnyPlan(entry.scenePlan)
    if (!entryScene.ok) {
      return { kind: "reject", reason: `history.${index}.scenePlan — ${entryScene.issue}` }
    }
    if (entryScene.plan.revisionId !== entry.revisionId) {
      return { kind: "reject", reason: `history.${index}.revisionId does not match its scene` }
    }
    history.push({
      revisionId: entry.revisionId,
      scenePlan: entry.scenePlan as Record<string, unknown>,
      source: entry.source,
      changeSummary: entry.changeSummary,
      createdAt: entry.createdAt,
      context: entry.context,
    })
  }

  let pendingPlan: Record<string, unknown> | undefined
  if (message.pendingPlan !== undefined) {
    const pending = validateScene3DAnyPlan(message.pendingPlan)
    if (!pending.ok) return { kind: "reject", reason: `pendingPlan — ${pending.issue}` }
    pendingPlan = message.pendingPlan as Record<string, unknown>
  }

  return {
    kind: "accept",
    state: {
      scenePlan: message.scenePlan as Record<string, unknown>,
      selectedObjectIds: message.selectedObjectIds ?? [],
      lockedObjectIds: message.lockedObjectIds ?? [],
      history,
      pendingPlan,
      isGenerating: message.isGenerating ?? false,
      // The safe default. A parent that wants an editable frame must SAY so.
      readOnly: message.readOnly ?? true,
      protocolVersion: message.version,
      planVersion: scene.version,
      revisionId: scene.plan.revisionId,
    },
  }
}

// ---------------------------------------------------------------------------
// Outbound: embed → parent
// ---------------------------------------------------------------------------

/**
 * The handshake. `version` stays 1 — it is the baseline both sides always
 * speak, and a parent written against version 1 checks it. What version 2 adds
 * is ANNOUNCED in additive fields a v1 parent simply does not read.
 *
 * Which is why a parent must match on `type` + `channel` and read
 * `protocolVersions`, never compare the whole message for equality.
 */
export interface Scene3DEmbedReadyMessage {
  type: typeof SCENE3D_EMBED_READY_TYPE
  version: typeof SCENE3D_EMBED_PROTOCOL_VERSION
  channel: string
  /** Every version this frame accepts on a `state` push. */
  protocolVersions: readonly Scene3DEmbedProtocolVersion[]
  capabilities: {
    /** The frame can ask the parent for asset bytes (protocol 2). */
    assetTransport: boolean
    /** Scene `schemaVersion`s this build can draw. */
    sceneSchemaVersions: readonly number[]
  }
}

export type Scene3DEmbedEvent =
  /** A deterministic local edit produced a NEW immutable revision. v1 only. */
  | { kind: "plan"; plan: Record<string, unknown>; changeSummary: string }
  | { kind: "selection"; objectIds: string[] }
  | { kind: "locks"; objectIds: string[] }
  | { kind: "restore"; revisionId: string }
  | { kind: "resolve-pending"; adopt: boolean }
  /**
   * A v2 edit, as OPERATIONS — never as a plan.
   *
   * The frame does not apply them: a v2 revision the server has not retained
   * would render as if it were saved while its assets still belong to the
   * revision it came from. The parent applies them with
   * `applyScene3DV2EditOperations` (which checks both stale fields), publishes
   * the result, and pushes the persisted plan back down.
   */
  | {
      kind: "edit-operations"
      operations: Scene3DV2EditOperation[]
      /** `provenance.contentHash` of the revision the user acted on. The
       *  envelope's `expectedRevisionId` is the other half of the CAS. */
      expectedContentHash: string
    }

/** `edit-operations` exists only in protocol 2; every other kind is original. */
function eventProtocolVersion(event: Scene3DEmbedEvent): Scene3DEmbedProtocolVersion {
  return event.kind === "edit-operations"
    ? SCENE3D_EMBED_PROTOCOL_VERSION_2
    : SCENE3D_EMBED_PROTOCOL_VERSION
}

export interface Scene3DEmbedEventMessage {
  type: typeof SCENE3D_EMBED_EVENT_TYPE
  /** The version the EVENT needs, not the frame's maximum: a v1 parent never
   *  sees a version it does not know on a message it does understand. */
  version: Scene3DEmbedProtocolVersion
  channel: string
  /**
   * The revision the embed was SHOWING when the user acted. The parent adopts
   * the event only if this still matches its own active revision — that is what
   * makes a click on a snapshot the parent has already replaced a no-op instead
   * of a silent rollback. `null` only before any state has been accepted.
   */
  expectedRevisionId: string | null
  event: Scene3DEmbedEvent
}

export function buildScene3DReadyMessage(channel: string): Scene3DEmbedReadyMessage {
  return {
    type: SCENE3D_EMBED_READY_TYPE,
    version: SCENE3D_EMBED_PROTOCOL_VERSION,
    channel,
    protocolVersions: SCENE3D_EMBED_PROTOCOL_VERSIONS,
    capabilities: {
      assetTransport: true,
      sceneSchemaVersions: SCENE3D_EMBED_SCENE_SCHEMA_VERSIONS,
    },
  }
}

export function buildScene3DEventMessage(
  channel: string,
  expectedRevisionId: string | null,
  event: Scene3DEmbedEvent,
): Scene3DEmbedEventMessage {
  return {
    type: SCENE3D_EMBED_EVENT_TYPE,
    version: eventProtocolVersion(event),
    channel,
    expectedRevisionId,
    event,
  }
}

/**
 * Which events a READ-ONLY frame must never emit. Selection is not a mutation:
 * a read-only viewer may still scrub the timeline and click an object, and the
 * parent wants to know which one so its own inspector follows along.
 */
export function isScene3DEmbedMutation(event: Scene3DEmbedEvent): boolean {
  return event.kind !== "selection"
}
