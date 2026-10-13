import { describe, expect, it } from "vitest"
import { ugcAppRunMissesPhoto } from "../ugc-app-run.js"

/**
 * A run whose UGC Creator is set to "My photo" needs the runner's own photo: every value that can
 * flow into the creator's photo input ships empty (the photo influence set), so the runner gives
 * one — the creator's photo field as an input of the run, or a value of theirs given to a node in
 * that creator's set. A value the graph still holds is the author's and never counts. With none,
 * the run is refused before anything is written or spent. Placeholders only.
 */
const creator = (data: Record<string, unknown> = {}) => ({ id: "c", type: "ugc-creator", data: { source: "photo", gender: "woman", ...data } })
const upload = (url = "") => ({ id: "u", type: "upload-image", data: { url } })
const wired = { source: "u", target: "c", targetHandle: "photo" }
const PHOTO = "https://cdn.example/me.png"

describe("a run's UGC Creator set to My photo", () => {
  it("with no photo of the runner's, it misses one", () => {
    expect(ugcAppRunMissesPhoto([creator()], [], undefined)).toBe(true)
    expect(ugcAppRunMissesPhoto([creator()], [], { c: { photoUrl: "" } })).toBe(true)
  })

  it("a photo given as the run's input is a photo; one still on the node is the author's, not the runner's", () => {
    expect(ugcAppRunMissesPhoto([creator()], [], { c: { photoUrl: PHOTO } })).toBe(false)
    expect(ugcAppRunMissesPhoto([creator({ photoUrl: PHOTO })], [], undefined)).toBe(true)
  })

  it("an upload wired into the photo pip gives a photo once the runner fills it; the image it holds is the author's", () => {
    expect(ugcAppRunMissesPhoto([creator(), upload()], [wired], undefined)).toBe(true)
    expect(ugcAppRunMissesPhoto([creator(), upload()], [wired], { u: { url: PHOTO } })).toBe(false)
    expect(ugcAppRunMissesPhoto([creator(), upload(PHOTO)], [wired], undefined)).toBe(true)
  })

  it("a node that makes the image in the run gives no photo of the runner's: refused, unless the runner gives a value to what feeds it", () => {
    const generated = { id: "g", type: "generate-image", data: { prompt: "a portrait" } }
    const brief = { id: "t", type: "text-prompt", data: { text: "a portrait" } }
    const edges = [{ source: "t", target: "g", targetHandle: "prompt" }, { source: "g", target: "c", targetHandle: "photo" }]
    expect(ugcAppRunMissesPhoto([creator(), generated, brief], edges, undefined)).toBe(true)
    expect(ugcAppRunMissesPhoto([creator(), generated, brief], edges, { t: { text: "me, smiling" } })).toBe(false)
    // A setting of the generator is not a value of the runner's.
    expect(ugcAppRunMissesPhoto([creator(), generated, brief], edges, { g: { aspectRatio: "1:1" } })).toBe(true)
  })

  it("a wire into another pip is no photo", () => {
    expect(ugcAppRunMissesPhoto([creator(), upload()], [{ ...wired, targetHandle: "category" }], { u: { url: PHOTO } })).toBe(true)
  })

  it("an AI creator needs no photo, and neither does a run that switches the creator to one", () => {
    expect(ugcAppRunMissesPhoto([creator({ source: "sampled" })], [], undefined)).toBe(false)
    expect(ugcAppRunMissesPhoto([creator()], [], { c: { source: "sampled" } })).toBe(false)
    expect(ugcAppRunMissesPhoto([creator({ source: "sampled" })], [], { c: { source: "photo" } })).toBe(true)
  })

  it("an upload behind a step (an upscale): a photo once the runner fills the upload", () => {
    const step = { id: "s", type: "upscale-image", data: {} }
    const edges = [{ source: "u", target: "s", targetHandle: "image" }, { source: "s", target: "c", targetHandle: "photo" }]
    expect(ugcAppRunMissesPhoto([creator(), upload(), step], edges, undefined)).toBe(true)
    expect(ugcAppRunMissesPhoto([creator(), upload(), step], edges, { u: { url: PHOTO } })).toBe(false)
  })

  it("an upload behind a teleport pair is read the same way", () => {
    const nodes = [creator(), upload(), { id: "ts", type: "teleport-send", data: { channel: "P" } }, { id: "tr", type: "teleport-receive", data: { channel: "P" } }]
    const edges = [{ source: "u", target: "ts", targetHandle: "in" }, { source: "tr", target: "c", targetHandle: "photo" }]
    expect(ugcAppRunMissesPhoto(nodes, edges, undefined)).toBe(true)
    expect(ugcAppRunMissesPhoto(nodes, edges, { u: { url: PHOTO } })).toBe(false)
  })

  it("a Text node handing an upload its link gives no photo, the runner's text included (text is no image); the upload the runner fills does", () => {
    const link = { id: "t", type: "text-prompt", data: { text: "https://cdn.example/elsewhere.png" } }
    const edges = [{ source: "t", target: "u", targetHandle: "in" }, wired]
    expect(ugcAppRunMissesPhoto([creator(), upload(), link], edges, undefined)).toBe(true)
    expect(ugcAppRunMissesPhoto([creator(), upload(), link], edges, { t: { text: PHOTO } })).toBe(true)
    expect(ugcAppRunMissesPhoto([creator(), upload(), link], edges, { u: { url: PHOTO } })).toBe(false)
  })

  it("a List the runner fills, by its rows", () => {
    const list = { id: "l", type: "list", data: { items: [] } }
    const edges = [{ source: "l", target: "c", targetHandle: "photo" }]
    expect(ugcAppRunMissesPhoto([creator(), list], edges, undefined)).toBe(true)
    expect(ugcAppRunMissesPhoto([creator(), list], edges, { l: { rows: [{ photo: PHOTO }] } })).toBe(false)
  })

  it("a value the runner gives to a node that can carry no image — a Text node or a picker setting up a step — is no photo: the step's image is the emptied upload", () => {
    const step = { id: "s", type: "modify-image", data: { prompt: "warmer" } }
    const brief = { id: "t", type: "text-prompt", data: { text: "warmer" } }
    const lens = { id: "l", type: "lens", data: { lens: "85mm" } }
    const byEdge = [{ source: "u", target: "s", targetHandle: "image" }, { source: "t", target: "s", targetHandle: "prompt" }, { source: "l", target: "s", targetHandle: "cinematography" }, { source: "s", target: "c", targetHandle: "photo" }]
    const nodes = [creator(), upload(), step, brief, lens]
    expect(ugcAppRunMissesPhoto(nodes, byEdge, { t: { text: "me" }, l: { lens: "35mm" } })).toBe(true)
    // By a field mapping alone, the same.
    const mapped = { ...step, data: { prompt: "{brief}", fieldMappings: { prompt: { sourceNodeId: "t" } } } }
    expect(ugcAppRunMissesPhoto([creator(), upload(), mapped, brief], [{ source: "u", target: "s", targetHandle: "image" }, { source: "s", target: "c", targetHandle: "photo" }], { t: { text: "me" } })).toBe(true)
    // The runner's upload with the same picker: a photo.
    expect(ugcAppRunMissesPhoto(nodes, byEdge, { u: { url: PHOTO }, l: { lens: "35mm" } })).toBe(false)
  })

  it("a Text node or a port wired straight into the photo carries no image", () => {
    const brief = { id: "t", type: "text-prompt", data: { text: "" } }
    expect(ugcAppRunMissesPhoto([creator(), brief], [{ source: "t", target: "c", targetHandle: "photo" }], { t: { text: PHOTO } })).toBe(true)
  })

  it("a sub-workflow input's port: an image port the runner fills is a photo, a text port is not", () => {
    const port = { id: "in", type: "sub-workflow-input", data: { ports: [{ id: "face", mediaType: "image" }, { id: "brand", mediaType: "text" }] } }
    const edges = [{ source: "in", target: "c", targetHandle: "photo" }]
    expect(ugcAppRunMissesPhoto([creator(), port], edges, { in: { __injectedPortValues: { brand: "Acme" } } })).toBe(true)
    expect(ugcAppRunMissesPhoto([creator(), port], edges, { in: { __injectedPortValues: { face: PHOTO } } })).toBe(false)
  })

  it("a creator the run does not reach is not asked", () => {
    expect(ugcAppRunMissesPhoto([creator()], [], undefined, ["other"])).toBe(false)
    expect(ugcAppRunMissesPhoto([creator()], [], undefined, ["c"])).toBe(true)
  })
})
