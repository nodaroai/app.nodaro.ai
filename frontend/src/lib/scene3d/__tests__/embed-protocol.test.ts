import { describe, it, expect } from "vitest"
import { FAKE_DIGEST, makePlan, makeV2Plan, REV_A, REV_B, REV_V2 } from "./fixture"
import {
  SCENE3D_EMBED_EVENT_TYPE,
  SCENE3D_EMBED_LIMITS,
  SCENE3D_EMBED_PROTOCOL_VERSION,
  SCENE3D_EMBED_READY_TYPE,
  SCENE3D_EMBED_STATE_TYPE,
  buildScene3DEventMessage,
  buildScene3DReadyMessage,
  classifyScene3DEmbedMessage,
  isScene3DEmbedMutation,
  parseScene3DEmbedParams,
  type Scene3DEmbedTransport,
} from "../embed-protocol"

const PARENT = "https://studio.nodaro.ai"
const CHANNEL = "3f1c9a2e-7b4d-4c8f-9a11-5d6e7f801234"
/** Stand-in for `window.parent`; identity is all the classifier compares. */
const PARENT_WINDOW = { name: "parent" }

function state(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: SCENE3D_EMBED_STATE_TYPE,
    version: SCENE3D_EMBED_PROTOCOL_VERSION,
    channel: CHANNEL,
    scenePlan: makePlan(),
    ...overrides,
  }
}

function inbound(data: unknown, overrides: Partial<Scene3DEmbedTransport> = {}) {
  return classifyScene3DEmbedMessage(
    { data, origin: PARENT, source: PARENT_WINDOW, ...overrides },
    { parentOrigin: PARENT, channel: CHANNEL, expectedSource: PARENT_WINDOW },
  )
}

function historyEntry(overrides: Record<string, unknown> = {}) {
  return {
    revisionId: REV_A,
    scenePlan: makePlan(),
    source: "generate",
    createdAt: "2026-09-07T10:00:00.000Z",
    ...overrides,
  }
}

describe("parseScene3DEmbedParams", () => {
  it("accepts an exact http(s) origin and a UUID channel", () => {
    const parsed = parseScene3DEmbedParams(
      `parentOrigin=${encodeURIComponent(PARENT)}&channel=${CHANNEL}`,
    )
    expect(parsed).toEqual({ ok: true, parentOrigin: PARENT, channel: CHANNEL })
  })

  it("accepts a dev origin with an explicit port", () => {
    const parsed = parseScene3DEmbedParams(
      `parentOrigin=${encodeURIComponent("http://localhost:5173")}&channel=${CHANNEL}`,
    )
    expect(parsed).toEqual({ ok: true, parentOrigin: "http://localhost:5173", channel: CHANNEL })
  })

  it.each([
    ["missing entirely", `channel=${CHANNEL}`],
    ["the literal string null (a sandboxed/opaque origin)", `parentOrigin=null&channel=${CHANNEL}`],
    ["an empty value", `parentOrigin=&channel=${CHANNEL}`],
    ["not a URL at all", `parentOrigin=studio.nodaro.ai&channel=${CHANNEL}`],
    ["a non-http scheme", `parentOrigin=${encodeURIComponent("file:///tmp/x")}&channel=${CHANNEL}`],
    ["a javascript: URL", `parentOrigin=${encodeURIComponent("javascript:alert(1)")}&channel=${CHANNEL}`],
  ])("refuses a parentOrigin that is %s", (_label, search) => {
    expect(parseScene3DEmbedParams(search).ok).toBe(false)
  })

  it.each([
    ["a trailing slash", "https://studio.nodaro.ai/"],
    ["a path", "https://studio.nodaro.ai/embed"],
    ["a query", "https://studio.nodaro.ai?x=1"],
    ["userinfo", "https://user:pw@studio.nodaro.ai"],
  ])("refuses a parentOrigin carrying %s — MessageEvent.origin is normalized, so === must be sound", (_label, raw) => {
    const parsed = parseScene3DEmbedParams(
      `parentOrigin=${encodeURIComponent(raw)}&channel=${CHANNEL}`,
    )
    expect(parsed.ok).toBe(false)
  })

  it("refuses an over-long parentOrigin before it is even parsed", () => {
    const long = `https://${"a".repeat(SCENE3D_EMBED_LIMITS.maxParentOriginLength)}.example.com`
    const parsed = parseScene3DEmbedParams(
      `parentOrigin=${encodeURIComponent(long)}&channel=${CHANNEL}`,
    )
    expect(parsed).toEqual({ ok: false, error: "parentOrigin is too long" })
  })

  it.each([
    ["missing", `parentOrigin=${encodeURIComponent(PARENT)}`],
    ["not a UUID", `parentOrigin=${encodeURIComponent(PARENT)}&channel=scene3d`],
    ["a truncated UUID", `parentOrigin=${encodeURIComponent(PARENT)}&channel=3f1c9a2e-7b4d-4c8f`],
  ])("refuses a channel that is %s", (_label, search) => {
    expect(parseScene3DEmbedParams(search).ok).toBe(false)
  })
})

describe("classifyScene3DEmbedMessage — transport and addressing are IGNORED, never surfaced", () => {
  it("ignores a message from a window that is not our parent", () => {
    expect(inbound(state(), { source: { name: "someone-else" } })).toEqual({ kind: "ignore" })
  })

  it("ignores a message whose source is null (a closed or detached window)", () => {
    expect(inbound(state(), { source: null })).toEqual({ kind: "ignore" })
  })

  it("ignores a well-formed message from a different origin", () => {
    expect(inbound(state(), { origin: "https://evil.example" })).toEqual({ kind: "ignore" })
  })

  it("ignores an origin that merely looks like the parent's", () => {
    expect(inbound(state(), { origin: "https://studio.nodaro.ai.evil.example" })).toEqual({ kind: "ignore" })
    expect(inbound(state(), { origin: "http://studio.nodaro.ai" })).toEqual({ kind: "ignore" })
  })

  it("ignores a message on another channel — two embeds on one page stay independent", () => {
    expect(inbound(state({ channel: "00000000-0000-4000-8000-000000000000" }))).toEqual({ kind: "ignore" })
  })

  it("ignores unrelated traffic the parent posts to its own frames", () => {
    expect(inbound({ type: "nodaro:setTheme", theme: "dark" })).toEqual({ kind: "ignore" })
    expect(inbound("hello")).toEqual({ kind: "ignore" })
    expect(inbound(null)).toEqual({ kind: "ignore" })
    expect(inbound([state()])).toEqual({ kind: "ignore" })
  })

  it("ignores our OWN outbound shapes echoed back", () => {
    expect(inbound(buildScene3DReadyMessage(CHANNEL))).toEqual({ kind: "ignore" })
  })
})

describe("classifyScene3DEmbedMessage — content failures are REJECTED out loud", () => {
  it("rejects an unknown protocol version on our channel", () => {
    // 1 and 2 are spoken; 3 is not. The frame says so rather than guessing
    // which half of a future envelope it is safe to read.
    const verdict = inbound(state({ version: 3 }))
    expect(verdict.kind).toBe("reject")
    expect(verdict.kind === "reject" && verdict.reason).toMatch(/unsupported protocol version 3/)
  })

  it("rejects a missing version rather than assuming v1", () => {
    const rest = state()
    delete rest.version
    expect(inbound(rest).kind).toBe("reject")
  })

  it("rejects an unknown envelope key — the version is how this contract grows", () => {
    const verdict = inbound(state({ authToken: "ndr_deadbeef" }))
    expect(verdict.kind).toBe("reject")
  })

  it("rejects a scenePlan that fails the shared schema", () => {
    const verdict = inbound(state({ scenePlan: makePlan({ backgroundColor: "not-a-color" }) }))
    expect(verdict.kind).toBe("reject")
    expect(verdict.kind === "reject" && verdict.reason).toMatch(/^scenePlan —/)
  })

  it("rejects a missing scenePlan", () => {
    const rest = state()
    delete rest.scenePlan
    expect(inbound(rest).kind).toBe("reject")
  })

  it("rejects a scene with a parent cycle (a semantic rule, not just a shape)", () => {
    const plan = makePlan()
    const objects = plan.objects as Array<Record<string, unknown>>
    objects[0].parentId = "hero"
    expect(inbound(state({ scenePlan: plan })).kind).toBe("reject")
  })

  it("rejects an over-long history before parsing any of its plans", () => {
    const history = Array.from({ length: SCENE3D_EMBED_LIMITS.maxHistoryEntries + 1 }, () => historyEntry())
    const verdict = inbound(state({ history }))
    expect(verdict.kind).toBe("reject")
    expect(verdict.kind === "reject" && verdict.reason).toMatch(/history has 13 revisions/)
  })

  it("accepts a history exactly at the limit", () => {
    const history = Array.from({ length: SCENE3D_EMBED_LIMITS.maxHistoryEntries }, () => historyEntry())
    expect(inbound(state({ history })).kind).toBe("accept")
  })

  it("validates EVERY history plan, not only the active one", () => {
    const history = [historyEntry(), historyEntry({ scenePlan: { planType: "3d-scene" } })]
    const verdict = inbound(state({ history }))
    expect(verdict.kind).toBe("reject")
    expect(verdict.kind === "reject" && verdict.reason).toMatch(/^history\.1\.scenePlan —/)
  })

  it("rejects a history entry with a non-UUID revision id or an unknown source", () => {
    expect(inbound(state({ history: [historyEntry({ revisionId: "rev-1" })] })).kind).toBe("reject")
    expect(inbound(state({ history: [historyEntry({ source: "hacked" })] })).kind).toBe("reject")
  })

  it("rejects a history label that identifies a different immutable scene", () => {
    const verdict = inbound(state({ history: [historyEntry({ revisionId: REV_B })] }))
    expect(verdict.kind).toBe("reject")
    expect(verdict.kind === "reject" && verdict.reason).toContain("does not match")
  })

  it("rejects an unbounded changeSummary", () => {
    const long = "x".repeat(SCENE3D_EMBED_LIMITS.maxTextLength + 1)
    expect(inbound(state({ history: [historyEntry({ changeSummary: long })] })).kind).toBe("reject")
  })

  it("rejects an unbounded context prompt", () => {
    const long = "x".repeat(SCENE3D_EMBED_LIMITS.maxTextLength + 1)
    expect(inbound(state({ history: [historyEntry({ context: { prompt: long } })] })).kind).toBe("reject")
  })

  it("rejects an unbounded createdAt", () => {
    const long = "2".repeat(SCENE3D_EMBED_LIMITS.maxCreatedAtLength + 1)
    expect(inbound(state({ history: [historyEntry({ createdAt: long })] })).kind).toBe("reject")
  })

  it.each(["selectedObjectIds", "lockedObjectIds"])("rejects an over-long %s", (field) => {
    const ids = Array.from({ length: SCENE3D_EMBED_LIMITS.maxObjectIdList + 1 }, (_, i) => `o${i}`)
    const verdict = inbound(state({ [field]: ids }))
    expect(verdict.kind).toBe("reject")
    expect(verdict.kind === "reject" && verdict.reason).toMatch(new RegExp(`^${field} has 101 entries`))
  })

  it.each(["selectedObjectIds", "lockedObjectIds"])("rejects an over-long id string in %s", (field) => {
    expect(inbound(state({ [field]: ["a".repeat(200)] })).kind).toBe("reject")
    expect(inbound(state({ [field]: [42] })).kind).toBe("reject")
  })

  it("rejects a pendingPlan that fails the shared schema", () => {
    const verdict = inbound(state({ pendingPlan: { nope: true } }))
    expect(verdict.kind).toBe("reject")
    expect(verdict.kind === "reject" && verdict.reason).toMatch(/^pendingPlan —/)
  })

  it("rejects non-boolean flags", () => {
    expect(inbound(state({ readOnly: "false" })).kind).toBe("reject")
    expect(inbound(state({ isGenerating: 1 })).kind).toBe("reject")
  })
})

describe("classifyScene3DEmbedMessage — a good push", () => {
  it("accepts a minimal snapshot and fills the safe defaults", () => {
    const verdict = inbound(state())
    expect(verdict.kind).toBe("accept")
    if (verdict.kind !== "accept") return
    expect(verdict.state.selectedObjectIds).toEqual([])
    expect(verdict.state.lockedObjectIds).toEqual([])
    expect(verdict.state.history).toEqual([])
    expect(verdict.state.pendingPlan).toBeUndefined()
    expect(verdict.state.isGenerating).toBe(false)
    // The point of the whole default: silence means look-don't-touch.
    expect(verdict.state.readOnly).toBe(true)
  })

  it("only an explicit readOnly:false opens the frame for editing", () => {
    const verdict = inbound(state({ readOnly: false }))
    expect(verdict.kind === "accept" && verdict.state.readOnly).toBe(false)
  })

  it("carries selection, locks, pending plan and the generating flag through", () => {
    const pending = makePlan({ revisionId: REV_B })
    const verdict = inbound(
      state({
        selectedObjectIds: ["hero"],
        lockedObjectIds: ["ground"],
        pendingPlan: pending,
        isGenerating: true,
      }),
    )
    expect(verdict.kind).toBe("accept")
    if (verdict.kind !== "accept") return
    expect(verdict.state.selectedObjectIds).toEqual(["hero"])
    expect(verdict.state.lockedObjectIds).toEqual(["ground"])
    expect(verdict.state.pendingPlan).toBe(pending)
    expect(verdict.state.isGenerating).toBe(true)
  })

  it("keeps only `prompt` from a revision context and drops the authoring metadata", () => {
    const verdict = inbound(
      state({
        history: [
          historyEntry({
            changeSummary: "moved the hero",
            context: { prompt: "a lone figure", llmModel: "some-model", temperature: 0.7 },
          }),
        ],
      }),
    )
    expect(verdict.kind).toBe("accept")
    if (verdict.kind !== "accept") return
    expect(verdict.state.history[0].changeSummary).toBe("moved the hero")
    expect(verdict.state.history[0].context).toEqual({ prompt: "a lone figure" })
  })
})

describe("outbound messages", () => {
  it("stamps ready with the BASELINE version, the channel, and what else it can do", () => {
    // `version` stays 1 forever: it is what a parent written against version 1
    // checks. Everything version 2 adds is announced in fields such a parent
    // does not read — which is what makes the handshake additive.
    expect(buildScene3DReadyMessage(CHANNEL)).toEqual({
      type: SCENE3D_EMBED_READY_TYPE,
      version: SCENE3D_EMBED_PROTOCOL_VERSION,
      channel: CHANNEL,
      protocolVersions: [1, 2],
      capabilities: { assetTransport: true, sceneSchemaVersions: [1, 2] },
    })
  })

  it("stamps every event with the revision it was computed from", () => {
    const message = buildScene3DEventMessage(CHANNEL, REV_A, { kind: "restore", revisionId: REV_B })
    expect(message).toEqual({
      type: SCENE3D_EMBED_EVENT_TYPE,
      version: SCENE3D_EMBED_PROTOCOL_VERSION,
      channel: CHANNEL,
      expectedRevisionId: REV_A,
      event: { kind: "restore", revisionId: REV_B },
    })
  })

  it("allows a null expectedRevisionId only before any state is held", () => {
    expect(
      buildScene3DEventMessage(CHANNEL, null, { kind: "selection", objectIds: [] }).expectedRevisionId,
    ).toBeNull()
  })

  it("counts everything but selection as a mutation a read-only frame withholds", () => {
    expect(isScene3DEmbedMutation({ kind: "selection", objectIds: ["hero"] })).toBe(false)
    expect(isScene3DEmbedMutation({ kind: "plan", plan: makePlan(), changeSummary: "x" })).toBe(true)
    expect(isScene3DEmbedMutation({ kind: "locks", objectIds: ["hero"] })).toBe(true)
    expect(isScene3DEmbedMutation({ kind: "restore", revisionId: REV_A })).toBe(true)
    expect(isScene3DEmbedMutation({ kind: "resolve-pending", adopt: true })).toBe(true)
  })
})

describe("classifyScene3DEmbedMessage — schema version negotiation", () => {
  it("accepts a v2 scene on a version-2 push and reports both versions", () => {
    const verdict = inbound(state({ version: 2, scenePlan: makeV2Plan() }))
    expect(verdict.kind).toBe("accept")
    if (verdict.kind !== "accept") return
    expect(verdict.state.planVersion).toBe(2)
    expect(verdict.state.protocolVersion).toBe(2)
    expect(verdict.state.revisionId).toBe(REV_V2)
    // The safe default still applies: an editable v2 frame must be asked for.
    expect(verdict.state.readOnly).toBe(true)
  })

  it("refuses a v2 scene on a version-1 push — that parent cannot serve its bytes", () => {
    const verdict = inbound(state({ scenePlan: makeV2Plan() }))
    expect(verdict.kind).toBe("reject")
    expect(verdict.kind === "reject" && verdict.reason).toMatch(/schema version 2.*protocol version 2/)
  })

  it("still accepts a v1 scene on either version", () => {
    expect(inbound(state()).kind).toBe("accept")
    const upgraded = inbound(state({ version: 2 }))
    expect(upgraded.kind).toBe("accept")
    if (upgraded.kind !== "accept") return
    expect(upgraded.state.planVersion).toBe(1)
  })

  it("validates v2 history entries with the same union validator", () => {
    const accepted = inbound(
      state({
        version: 2,
        scenePlan: makeV2Plan(),
        history: [historyEntry({ revisionId: REV_V2, scenePlan: makeV2Plan() })],
      }),
    )
    expect(accepted.kind).toBe("accept")

    // …and still refuses a broken one, one click from being restored.
    const broken = inbound(
      state({
        version: 2,
        scenePlan: makeV2Plan(),
        history: [historyEntry({ revisionId: REV_V2, scenePlan: makeV2Plan({ shots: [] }) })],
      }),
    )
    expect(broken.kind).toBe("reject")
    expect(broken.kind === "reject" && broken.reason).toMatch(/history\.0\.scenePlan/)
  })

  it("treats a v2 edit as a mutation, so a read-only frame cannot emit one", () => {
    expect(
      isScene3DEmbedMutation({ kind: "edit-operations", operations: [], expectedContentHash: FAKE_DIGEST }),
    ).toBe(true)
  })
})
