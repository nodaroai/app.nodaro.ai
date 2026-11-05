import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

// The box of a node whose own link a run hands on (the Dubbing node's Source
// link): session state keyed by node and link, the pre-run gate's finder, and
// the confirmations a server run carries in its overrides.

const confirmLink = vi.hoisted(() => vi.fn())
vi.mock("@/lib/content-rights", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/content-rights")>()),
  confirmLink: (...args: unknown[]) => confirmLink(...args),
}))

import { DeclarationChangedError } from "@/lib/content-rights"
import { declarationChanged } from "@/lib/declaration-changes"
import {
  clearNodeLinkRights,
  confirmNodeLink,
  findUnconfirmedNodeLink,
  hasOwnLinkBox,
  isNodeLinkRightsTicked,
  nodeLinkOf,
  subscribeNodeLinkRights,
  tickNodeLinkRights,
  untickNodeLinkRights,
  withNodeLinkRightsConfirmations,
} from "../node-link-rights"

const LINK = "https://example.com/talks/keynote"
const dub = (id: string, data: Record<string, unknown> = { sourceUrl: LINK }) => ({ id, type: "dubbing", data })

beforeEach(() => {
  confirmLink.mockReset()
  confirmLink.mockImplementation(async (url: string) => ({ id: `conf-${url.slice(-4)}`, declarationVersion: 1, expiresAt: "2026-11-04T12:00:00Z" }))
})
afterEach(() => clearNodeLinkRights())

describe("the box", () => {
  it("is ticked for exactly the link it was ticked for, on that node", () => {
    tickNodeLinkRights("d1", ` ${LINK} `)
    expect(isNodeLinkRightsTicked("d1", LINK)).toBe(true)
    expect(isNodeLinkRightsTicked("d1", "https://example.com/another")).toBe(false)
    expect(isNodeLinkRightsTicked("d2", LINK)).toBe(false)
    expect(isNodeLinkRightsTicked("d1", "")).toBe(false)
  })

  it("an empty link, an untick or a clear leaves it unticked; listeners hear each change", () => {
    const heard = vi.fn()
    const stop = subscribeNodeLinkRights(heard)
    tickNodeLinkRights("d1", LINK)
    tickNodeLinkRights("d1", LINK)
    expect(heard).toHaveBeenCalledTimes(1)
    tickNodeLinkRights("d1", "  ")
    expect(isNodeLinkRightsTicked("d1", LINK)).toBe(false)
    tickNodeLinkRights("d1", LINK)
    untickNodeLinkRights("d1")
    expect(isNodeLinkRightsTicked("d1", LINK)).toBe(false)
    tickNodeLinkRights("d2", LINK)
    clearNodeLinkRights()
    expect(isNodeLinkRightsTicked("d2", LINK)).toBe(false)
    stop()
  })

  it("the link a run hands on is the Dubbing node's Source link, and no other node's", () => {
    expect(nodeLinkOf(dub("d1", { sourceUrl: ` ${LINK} ` }))).toBe(LINK)
    expect(nodeLinkOf(dub("d1", {}))).toBe("")
    expect(nodeLinkOf({ id: "v1", type: "video-to-video", data: { sourceUrl: LINK } })).toBe("")
    expect(nodeLinkOf({ id: "x", type: "constructor", data: { sourceUrl: LINK } })).toBe("")
  })
})

describe("findUnconfirmedNodeLink — what the pre-run gate stops on", () => {
  it("names the first node about to run whose box is not ticked for its link", () => {
    const nodes = [dub("d1", { label: "French dub", sourceUrl: LINK }), dub("d2")]
    expect(findUnconfirmedNodeLink(nodes, null)).toEqual({ nodeId: "d1", label: "French dub" })
    tickNodeLinkRights("d1", LINK)
    expect(findUnconfirmedNodeLink(nodes, null)).toEqual({ nodeId: "d2", label: "Dubbing" })
  })

  it("a node outside the run, or with no link of its own, stops nothing", () => {
    expect(findUnconfirmedNodeLink([dub("d1"), dub("d2", {})], ["d2"])).toBeNull()
  })
})

describe("withNodeLinkRightsConfirmations — a server run's overrides", () => {
  it("one confirmation per ticked node about to run, as its rightsConfirmationId, beside the other overrides", async () => {
    tickNodeLinkRights("d1", LINK)
    const out = await withNodeLinkRightsConfirmations([dub("d1"), dub("d2")], ["d1"], { other: { text: "x" }, d1: { targetLanguage: "de" } })
    expect(out).toEqual({ other: { text: "x" }, d1: { targetLanguage: "de", rightsConfirmationId: "conf-note" } })
    expect(confirmLink).toHaveBeenCalledTimes(1)
    expect(confirmLink).toHaveBeenCalledWith(LINK)
  })

  it("the link the run's own overrides set is the one confirmed", async () => {
    const swapped = "https://example.com/talks/closing"
    tickNodeLinkRights("d1", swapped)
    const out = await withNodeLinkRightsConfirmations([dub("d1")], null, { d1: { sourceUrl: swapped } })
    expect(confirmLink).toHaveBeenCalledWith(swapped)
    expect(out).toEqual({ d1: { sourceUrl: swapped, rightsConfirmationId: "conf-sing" } })
  })

  it("nothing to confirm: the overrides come back as they were", async () => {
    const overrides = { other: { text: "x" } }
    // d1 (unticked) is not about to run; d2 has no link of its own.
    expect(await withNodeLinkRightsConfirmations([dub("d1"), dub("d2", {})], ["d2"], overrides)).toBe(overrides)
    expect(await withNodeLinkRightsConfirmations([], null, undefined)).toBeUndefined()
    expect(confirmLink).not.toHaveBeenCalled()
  })

  it("a link about to be handed on with its box not ticked stops the run, naming the node, before any confirmation", async () => {
    tickNodeLinkRights("d2", LINK)
    await expect(
      withNodeLinkRightsConfirmations([dub("d2"), dub("d1", { label: "French dub", sourceUrl: LINK })], null, undefined),
    ).rejects.toThrow(/French dub/)
    // Not even d2's, whose box is ticked: a run that stops leaves no confirmation behind.
    expect(confirmLink).not.toHaveBeenCalled()
  })

  it("a frozen node, or a sub-workflow's node, is neither stopped on nor confirmed: the run never hands its link on from here", async () => {
    const frozen = dub("f1", { sourceUrl: LINK, skipped: true })
    const child = dub("__sub_parent_d1")
    expect(findUnconfirmedNodeLink([frozen, child], null)).toBeNull()
    const overrides = { other: { text: "x" } }
    expect(await withNodeLinkRightsConfirmations([frozen, child], null, overrides)).toBe(overrides)
    expect(confirmLink).not.toHaveBeenCalled()
    expect(hasOwnLinkBox(dub("d1"))).toBe(true)
    expect(hasOwnLinkBox(dub("d1", { sourceUrl: LINK, skipped: false }))).toBe(true)
  })

  it("the run's own override of the link needs its own tick: the saved link's does not cover it", async () => {
    tickNodeLinkRights("d1", LINK)
    await expect(
      withNodeLinkRightsConfirmations([dub("d1")], null, { d1: { sourceUrl: "https://example.com/talks/closing" } }),
    ).rejects.toThrow(/Dubbing/)
    expect(confirmLink).not.toHaveBeenCalled()
  })

  it("a changed declaration unticks the box and the run does not start", async () => {
    tickNodeLinkRights("d1", LINK)
    confirmLink.mockRejectedValueOnce(new DeclarationChangedError())
    await expect(withNodeLinkRightsConfirmations([dub("d1")], null, undefined)).rejects.toBeInstanceOf(DeclarationChangedError)
    expect(isNodeLinkRightsTicked("d1", LINK)).toBe(false)
  })

  it("a changed declaration unticks every box, not only the one whose confirmation found out", () => {
    const heard = vi.fn()
    const stop = subscribeNodeLinkRights(heard)
    tickNodeLinkRights("d1", LINK)
    tickNodeLinkRights("d2", "https://example.com/talks/closing")
    heard.mockClear()
    declarationChanged()
    expect(isNodeLinkRightsTicked("d1", LINK)).toBe(false)
    expect(isNodeLinkRightsTicked("d2", "https://example.com/talks/closing")).toBe(false)
    expect(heard).toHaveBeenCalledTimes(1)
    stop()
  })

  it("any other refusal throws and keeps the box", async () => {
    tickNodeLinkRights("d1", LINK)
    confirmLink.mockRejectedValueOnce(new Error("network"))
    await expect(confirmNodeLink("d1", LINK)).rejects.toThrow("network")
    expect(isNodeLinkRightsTicked("d1", LINK)).toBe(true)
  })
})
