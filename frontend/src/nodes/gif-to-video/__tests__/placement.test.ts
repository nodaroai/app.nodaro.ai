// @test-watches frontend/src/nodes/**
// (It reads no file: G4 wants this declaration because it reads composed registries — NODE_OPTIONS,
// the families, TARGET_HANDLE_ACCEPTS — that every unit joins, so a change to any unit must select it.)
//
// Where gif-to-video sits since it became a unit, as decided for its migration (decided 2026-10-18).
import { describe, it, expect } from "vitest"
import { NODE_OPTIONS } from "@/lib/node-options"
import { NODE_FAMILIES } from "@/lib/node-families"
import { TARGET_HANDLE_ACCEPTS, getTargetHandlesAccepting } from "@/lib/target-handle-registry"
import { isValidWorkflowConnection, resolveEffectiveSourceType } from "@/lib/connection-validation"
import { NODE_DEFINITIONS } from "@/types/nodes"
import { chooseSmartConnection, enumerateConnectionOptionsCore, staticOutputHandles } from "@/lib/enumerate-connection-options"

const GIF = "gif-to-video"
const types = NODE_OPTIONS.map((o) => o.type as string)

describe("decision 3: one picker anchor, the family order kept", () => {
  it("it stays last in its family, after Transcode Video", () => {
    const family = NODE_FAMILIES.find((f) => f.types.includes(GIF))!
    expect(family.id).toBe("video-format-export")
    expect(family.types.slice(-2)).toEqual(["transcode-video", GIF])
  })

  it("in the flat NODE_OPTIONS order (the edge-drop Direct list's) it follows transcode-video, no longer resize-video", () => {
    expect(types[types.indexOf(GIF) - 1]).toBe("transcode-video")
    expect(types[types.indexOf("resize-video") + 1]).not.toBe(GIF)
  })
})

describe("decision 1: the handle popover offers it", () => {
  it("its one input is a popover candidate, placed after loop-video (its position.after: transcode-video has no entry)", () => {
    const keys = Object.keys(TARGET_HANDLE_ACCEPTS)
    expect(keys[keys.indexOf(GIF) - 1]).toBe("loop-video")
    expect(TARGET_HANDLE_ACCEPTS[GIF]!.map((e) => [e.handleId, e.label])).toEqual([["image", "GIF"]])
  })

  it("a source's popover offers it exactly when the canvas lets that source into its GIF pip", () => {
    const sources = NODE_DEFINITIONS.map((d) => d.type as string)
    const offered = sources.filter((s) => getTargetHandlesAccepting(s).some((m) => m.nodeType === GIF && m.handleId === "image"))
    const accepted = sources.filter((s) => isValidWorkflowConnection({ source: "s", target: "t", sourceHandle: null, targetHandle: "image" }, (id) => (id === "s" ? s : id === "t" ? GIF : undefined)))
    expect(offered.length).toBeGreaterThan(10)
    expect(offered).toEqual(accepted)
  })

  // The popover resolves the source by the dragged PIP (handle-popover.tsx: resolveEffectiveSourceType),
  // so a pip that emits a plain image offers gif-to-video even where its node type does not, then
  // re-validates each candidate with the real sourceHandle. Keyed by (node type, handle id).
  const offeredFromPip = (type: string, handle: string): boolean =>
    getTargetHandlesAccepting(resolveEffectiveSourceType(type, handle)).some((m) => m.nodeType === GIF && m.handleId === "image")
      && isValidWorkflowConnection({ source: "s", target: "t", sourceHandle: handle, targetHandle: "image" }, (id) => (id === "s" ? type : id === "t" ? GIF : undefined))

  it.each([
    ["character", "image"], ["object", "image"], ["creature", "image"], ["location", "image"],
    ["site-capture", "image"], ["ugc-creator", "image"], ["meta-ads-scrape", "image"], ["instagram-scrape", "image"],
    ["group", "out-image"], ["collect", "out-image"],
  ])("a %s's %s pip offers it (an image pip, resolved to upload-image)", (type, handle) => {
    expect(resolveEffectiveSourceType(type, handle)).toBe("upload-image")
    expect(offeredFromPip(type, handle)).toBe(true)
  })

  it.each([["group", "out-video"], ["collect", "out-audio"], ["character", "characterRef"], ["face", "faceRef"]])("a %s's %s pip does not offer it", (type, handle) => {
    expect(offeredFromPip(type, handle)).toBe(false)
  })

  it("over every declared output pip, the popover offers it exactly where the canvas accepts that pip's wire", () => {
    for (const d of NODE_DEFINITIONS) for (const h of d.outputs) {
      const accepted = isValidWorkflowConnection({ source: "s", target: "t", sourceHandle: h, targetHandle: "image" }, (id) => (id === "s" ? d.type : id === "t" ? GIF : undefined))
      expect(offeredFromPip(d.type, h), `${d.type}:${h}`).toBe(accepted)
    }
  })
})

describe("decision 6: its input is named \"GIF\" (its handle's own label), not the fallback \"Image\" (decided 2026-10-19)", () => {
  const imageOut = staticOutputHandles("upload-image")[0]!

  it("the Connect dialog / search connector strip name the new node's input GIF", () => {
    const options = enumerateConnectionOptionsCore({ focusedType: "upload-image", newType: GIF, focusedSourceHandles: [imageOut], focusedTargetHandles: [], missingRefNames: [] })
    expect(options.handles.filter((o) => o.direction === "source" && o.nHandle === "image").map((o) => o.label)).toEqual(["GIF"])
  })

  it("on a focused Gif to Video, an upstream connection is named GIF — Smart Connect's upstream default name too", () => {
    const options = enumerateConnectionOptionsCore({ focusedType: GIF, newType: "upload-image", focusedSourceHandles: [], focusedTargetHandles: ["image"], missingRefNames: [] })
    expect(options.handles.filter((o) => o.direction === "target" && o.fHandle === "image").map((o) => o.label)).toEqual(["GIF"])
    const choice = chooseSmartConnection({ direction: "upstream", options, focusedType: GIF, connectedTargetHandles: new Set(), defaultName: "Upload Image" })
    expect(choice.name).toBe("GIF")
  })
})
