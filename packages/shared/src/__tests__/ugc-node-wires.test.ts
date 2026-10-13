import { describe, expect, it } from "vitest"
import { DEFAULT_TRANSCRIBE_NODE_PROVIDER, FAN_OUT_EACH_HANDLES, UGC_NODE_TYPES, VIDEO_PRODUCER_TYPES, defaultEdgeOutputMode, parseCaptionPlan } from "../index.js"
import {
  UGC_CREATOR_MISSING_MESSAGE, UGC_CREATOR_PICKER_TYPES, UGC_NEWER_APP_MESSAGE, UGC_NOT_SERVED_MESSAGE, UGC_PICK_GONE_MESSAGE, UGC_PRIMARY_HANDLE, UGC_SCREENSHOT_HANDLES,
  UGC_SCRIPT_DEFAULT_TARGET_SEC, UGC_VERSION_MESSAGE, readUgcWire, ugcCardsBody, ugcCardsJobs, ugcCardsOutputs, ugcClipBody, ugcClipOutputs, ugcClipsBody, ugcClipsOutputs,
  ugcAwaitsPick, ugcCreatorBody, ugcCreatorCallsToRender, ugcCreatorCandidate, ugcCreatorCandidates, ugcCreatorOutputs, ugcCreatorPick, ugcFailure,
  ugcKeptOutputs, ugcPipValue, ugcScriptBody, ugcScriptOutputs, ugcScriptResult, type UgcCreatorCandidateCalls,
} from "../ugc-node-wires.js"
import { ugcFinishOutputs, ugcFinishPlan, ugcLaneNeedsFinish } from "../ugc-lane-wires.js"

const ticket = (i: number) => ({ v: 1, index: i, durationSec: 12, video: { tool: "t", args: {} } })

describe("UGC wires", () => {
  it("fan-out only from the clips handle; UGC Clip is a video producer", () => {
    expect(FAN_OUT_EACH_HANDLES["ugc-clips"]).toEqual({ each: ["clips"], primary: "clips" })
    expect(defaultEdgeOutputMode("ugc-clips", "clips")).toBe("each")
    expect(defaultEdgeOutputMode("ugc-clips", "plan-out")).toBe("last")
    expect(defaultEdgeOutputMode("ugc-clips", "transcript")).toBe("last")
    expect(VIDEO_PRODUCER_TYPES.has("ugc-clip")).toBe(true)
  })
  it("refuses a wire from a newer version", () => {
    expect(readUgcWire(JSON.stringify({ v: 2 }))).toEqual({ error: UGC_VERSION_MESSAGE })
    expect(readUgcWire({ v: 1, a: 1 })).toEqual({ value: { v: 1, a: 1 } })
  })
  it("maps a router 404 to the Cloud sentence and forwards a route message", () => {
    expect(ugcFailure(404, "")).toBe(UGC_NOT_SERVED_MESSAGE)
    expect(ugcFailure(422, JSON.stringify({ error: { code: "minor_age_refused", message: "m" } }))).toBe("That age can't be used: UGC creators are adults only.")
    expect(ugcFailure(422, JSON.stringify({ error: { code: "language_not_available", message: "Not yet." } }))).toBe("Not yet.")
  })
  it("creator: sampled needs a category; photo needs a photo; a wired photo wins", () => {
    expect(ugcCreatorBody({ data: { source: "sampled", gender: "woman", keepResult: false } })).toEqual({ error: "Run UGC Script first, or pick a product category." })
    expect(ugcCreatorBody({ data: { source: "photo", gender: "man", keepResult: false } })).toEqual({ error: "Connect or upload a photo of yourself." })
    expect(ugcCreatorBody({ data: { source: "photo", gender: "man", keepResult: false, photoUrl: "https://cdn.example/a.png" }, photoUrl: "https://cdn.example/wired.png" }))
      .toEqual({ body: { source: { kind: "photo", imageUrl: "https://cdn.example/wired.png", gender: "man" } } })
    expect(ugcCreatorBody({ data: { source: "sampled", gender: "woman", keepResult: false, seed: 7 }, category: "saas", pickers: { setting: { setting: "kitchen" } } }))
      .toEqual({ body: { seed: 7, source: { kind: "sampled", gender: "woman", productCategory: "saas", pickers: { setting: { setting: "kitchen" } } } } })
  })
  it("script: slots in order, empty ones dropped, English until the language card", () => {
    expect(ugcScriptBody({ site: "Acme", screenshots: ["https://cdn.example/1.png", undefined, "https://cdn.example/3.png"], targetDurationSec: 20 }))
      .toEqual({ body: { site: "Acme", screenshots: ["https://cdn.example/1.png", "https://cdn.example/3.png"], targetDurationSec: 20, language: "en" } })
    expect(ugcScriptBody({ screenshots: [] })).toEqual({ error: "Add the product name or website." })
  })
  it("script outputs: the plan gets v: 1, the category is text", () => {
    expect(ugcScriptOutputs({ plan: { hook: "h" }, productCategory: "saas" })).toEqual({ plan: JSON.stringify({ v: 1, hook: "h" }), category: "saas" })
  })
  it("clips: canvas body, invalid plan message, outputs", () => {
    const body = ugcClipsBody({ planWire: JSON.stringify({ v: 1, hook: "h" }), creatorWire: JSON.stringify({ v: 1, gender: "woman", identityImages: ["https://cdn.example/c.png"], traits: null }), voiceId: "voice-1" })
    expect(body).toEqual({ body: { plan: { v: 1, hook: "h" }, gender: "woman", traits: null, identityImages: ["https://cdn.example/c.png"], surface: "canvas", voiceId: "voice-1" } })
    expect(ugcClipsOutputs({ errors: [{ message: "Too long.", fix: "Trim it." }] })).toEqual({ error: "The script needs changes: Too long. Trim it." })
    const ok = ugcClipsOutputs({ errors: [], tickets: [ticket(0), ticket(1)], sizedPlan: { p: 1 }, transcript: "a b", speechCheckCall: { tool: "transcribe", args: { language: "he" } }, hasCards: true })
    expect("tickets" in ok && ok.tickets).toEqual([JSON.stringify(ticket(0)), JSON.stringify(ticket(1))])
    expect("outputs" in ok && JSON.parse(ok.outputs["plan-out"]!)).toEqual({ v: 1, plan: { p: 1 }, transcribeArgs: { language: "he" } })
    const old = ugcClipsOutputs({ errors: [], tickets: [ticket(0)], sizedPlan: {}, transcript: "" })
    expect("outputs" in old && JSON.parse(old.outputs["plan-out"]!).transcribeArgs).toEqual({})
  })
  it("clip: the nonce is the clip's re-render count", () => {
    expect(ugcClipBody({ ticketWire: JSON.stringify(ticket(1)), rerender: { "2": 3 } })).toMatchObject({ body: { ticket: ticket(1), nonce: 3 }, clipNumber: 2, durationSec: 12 })
    expect(ugcClipBody({ ticketWire: JSON.stringify(ticket(0)), runKey: "exec-1" })).toMatchObject({ body: { ticket: ticket(0), nonce: 0, runKey: "exec-1" } })
  })
  it("cards: the two timing bodies, the node's fields last", () => {
    const planOut = JSON.stringify({ v: 1, plan: { p: 1 }, transcribeArgs: { language: "he", provider: "x", wordTimestamps: false } })
    const jobs = ugcCardsJobs({ planOutWire: planOut, videoUrl: "https://cdn.example/v.mp4", transcript: "a b" })
    expect("transcribe" in jobs && jobs.transcribe.body).toEqual({ language: "he", audioUrl: "https://cdn.example/v.mp4", provider: DEFAULT_TRANSCRIBE_NODE_PROVIDER, wordTimestamps: true })
    expect("alignment" in jobs && jobs.alignment.body).toEqual({ audioUrl: "https://cdn.example/v.mp4", transcript: "a b" })
    const en = ugcCardsJobs({ planOutWire: JSON.stringify({ v: 1, plan: {}, transcribeArgs: {} }), videoUrl: "https://cdn.example/v.mp4", transcript: "a" })
    expect("transcribe" in en && en.transcribe.body).toEqual({ audioUrl: "https://cdn.example/v.mp4", provider: DEFAULT_TRANSCRIBE_NODE_PROVIDER, wordTimestamps: true })
    expect(ugcCardsJobs({ planOutWire: JSON.stringify({ v: 1, hook: "a bare plan" }), videoUrl: "https://cdn.example/v.mp4", transcript: "a" })).toEqual({ error: "Connect the Script (sized) output of UGC Clips." })
  })
  it("cards outputs: an empty timing becomes the empty caption plan", () => {
    const o = ugcCardsOutputs({ layerPlan: [], captionTiming: null, report: { lines: ["No cards or captions: the speech could not be timed."] } })
    expect(JSON.parse(o.captionPlan!)).toEqual({ v: 1, hookText: "", hookEndMs: 0, bodyEndMs: 0, captions: [] })
    expect(o.layerPlan).toBe("[]")
    expect(o.report).toBe("No cards or captions: the speech could not be timed.")
  })
})

const imageCall = (m: string) => ({ tool: "generate_image", args: { prompt: "p", model: m, aspect_ratio: "3:4" } })
const FALLBACK = imageCall("image-model-c")
const SAMPLED = {
  kind: "sampled", seed: 7, gender: "woman", traits: { t: 1 }, identityImages: [], promptsVersion: "1.0.0", productCategory: "saas",
  image: { ...imageCall("image-model-a"), fallback: FALLBACK },
  candidates: [{ model: "image-model-a", ...imageCall("image-model-a") }, { model: "image-model-b", ...imageCall("image-model-b") }],
  fallback: FALLBACK,
  pick: { how: "user" },
  realismPass: null, secondFrame: null, photoCheck: null,
  genderCheck: { tool: "image_to_text", args: { custom_prompt: "q" }, passToken: "PASS", refusal: "R" },
}
const read = (a: Record<string, unknown>): UgcCreatorCandidateCalls => {
  const r = ugcCreatorCandidates(a)
  if ("error" in r) throw new Error(r.error)
  return r
}

describe("UGC Creator candidates", () => {
  it("two candidates: tool and args only, the primary first and equal to `image`, which is not run as well", () => {
    const r = read(SAMPLED)
    expect(r).toEqual({ calls: [imageCall("image-model-a"), imageCall("image-model-b")], fallback: FALLBACK, pick: "user" })
    expect(r.calls[0]).toEqual({ tool: SAMPLED.image.tool, args: SAMPLED.image.args })
    for (const c of r.calls) expect(Object.keys(c).sort()).toEqual(["args", "tool"])
  })
  it("one candidate is the primary: nothing to pick", () => {
    expect(read({ ...SAMPLED, candidates: [SAMPLED.candidates[0]], pick: { how: "primary" } }))
      .toEqual({ calls: [imageCall("image-model-a")], fallback: FALLBACK, pick: "primary" })
    // A builder that says "user" over one call, or names no pick over two, still renders the primary alone.
    expect(read({ ...SAMPLED, candidates: [SAMPLED.candidates[0]] }).pick).toBe("primary")
    expect(read({ ...SAMPLED, pick: null }).pick).toBe("primary")
  })
  it("an answer from before candidates renders `image` with its own fallback, as today", () => {
    const { candidates: _c, fallback: _f, pick: _p, ...older } = SAMPLED
    expect(read(older)).toEqual({ calls: [imageCall("image-model-a")], fallback: FALLBACK, pick: "primary" })
    expect(read({ ...older, candidates: [] })).toEqual({ calls: [imageCall("image-model-a")], fallback: FALLBACK, pick: "primary" })
  })
  it("a photo renders nothing", () => {
    expect(read({ kind: "photo", image: null, candidates: [], fallback: null, pick: null })).toEqual({ calls: [], fallback: null, pick: null })
  })
  it("a shape the app cannot read → the newer-app message", () => {
    expect(ugcCreatorCandidates({ ...SAMPLED, candidates: [{ model: "image-model-a" }] })).toEqual({ error: UGC_NEWER_APP_MESSAGE })
    expect(ugcCreatorCandidates({ ...SAMPLED, candidates: "two" })).toEqual({ error: UGC_NEWER_APP_MESSAGE })
    expect(ugcCreatorCandidates({ ...SAMPLED, candidates: undefined, image: { tool: 1, args: {} } })).toEqual({ error: UGC_NEWER_APP_MESSAGE })
  })
  it("every candidate is rendered only where a person picks", () => {
    const r = read(SAMPLED)
    expect(ugcCreatorCallsToRender(r, { personPicks: true })).toEqual(r.calls)
    expect(ugcCreatorCallsToRender(r, { personPicks: false })).toEqual([r.calls[0]])
    const one = read({ ...SAMPLED, candidates: [SAMPLED.candidates[0]] })
    expect(ugcCreatorCallsToRender(one, { personPicks: true })).toEqual([one.calls[0]])
  })
  it("the record is built from the picked image and never carries the round", () => {
    const o = ugcCreatorOutputs(SAMPLED, ["https://cdn.example/b.png"])
    expect(o.record).toEqual({ v: 1, kind: "sampled", gender: "woman", identityImages: ["https://cdn.example/b.png"], traits: { t: 1 }, seed: 7, promptsVersion: "1.0.0", productCategory: "saas" })
    expect(o.outputs).toEqual({ creator: JSON.stringify(o.record), image: "https://cdn.example/b.png" })
    expect(o.imageUrl).toBe("https://cdn.example/b.png")
  })
  it("a candidate keeps its image and record; the pick hands the picked one on", () => {
    const a = ugcCreatorCandidate(SAMPLED, ["https://cdn.example/a.png"])
    const b = ugcCreatorCandidate(SAMPLED, ["https://cdn.example/b.png"])
    expect(a).toEqual({ imageUrl: "https://cdn.example/a.png", record: ugcCreatorOutputs(SAMPLED, ["https://cdn.example/a.png"]).record })
    expect(ugcCreatorPick([a, b], 1)).toEqual({ result: b.record, outputs: { creator: JSON.stringify(b.record), image: "https://cdn.example/b.png" }, imageUrl: "https://cdn.example/b.png" })
  })
  it("a pick of a stale or foreign list is refused, never guessed", () => {
    const a = ugcCreatorCandidate(SAMPLED, ["https://cdn.example/a.png"])
    expect(ugcCreatorPick([a], 1)).toEqual({ error: UGC_PICK_GONE_MESSAGE })
    expect(ugcCreatorPick(undefined, 0)).toEqual({ error: UGC_PICK_GONE_MESSAGE })
    expect(ugcCreatorPick([a], -1)).toEqual({ error: UGC_PICK_GONE_MESSAGE })
    expect(ugcCreatorPick([{ imageUrl: "https://cdn.example/x.png", record: { v: 2, identityImages: ["https://cdn.example/x.png"] } }], 0)).toEqual({ error: UGC_VERSION_MESSAGE })
    expect(ugcCreatorPick([{ imageUrl: "https://cdn.example/x.png", record: { v: 1, identityImages: ["https://cdn.example/y.png"] } }], 0)).toEqual({ error: UGC_PICK_GONE_MESSAGE })
  })
})

// The edge cases the cases above leave open. Placeholders only.
describe("UGC wires: the module surface", () => {
  it("is re-exported from the package index", async () => {
    const shared: Record<string, unknown> = await import("../index.js")
    for (const name of ["readUgcWire", "ugcFailure", "ugcCreatorBody", "ugcCreatorOutputs", "ugcCreatorCandidates", "ugcCreatorCallsToRender", "ugcCreatorCandidate", "ugcCreatorPick", "ugcScriptBody", "ugcScriptOutputs", "ugcClipsBody", "ugcClipsOutputs", "ugcClipBody", "ugcClipOutputs", "ugcCardsJobs", "ugcCardsBody", "ugcCardsOutputs"]) {
      expect(typeof shared[name], name).toBe("function")
    }
    expect(shared.UGC_NEWER_APP_MESSAGE).toBe("This step needs a newer app version.")
    expect(shared.UGC_PICK_GONE_MESSAGE).toBe(UGC_PICK_GONE_MESSAGE)
    expect(shared.UGC_CREATOR_MISSING_MESSAGE).toBe("UGC Creator has no creator yet. Run it, or pick one of its options.")
    expect(shared.UGC_SCRIPT_DEFAULT_TARGET_SEC).toBe(UGC_SCRIPT_DEFAULT_TARGET_SEC)
    expect(shared.UGC_PRIMARY_HANDLE).toBe(UGC_PRIMARY_HANDLE)
  })
  it("names a primary handle for exactly the UGC types", () => {
    expect(Object.keys(UGC_PRIMARY_HANDLE).sort()).toEqual([...UGC_NODE_TYPES].sort())
    expect(UGC_PRIMARY_HANDLE).toEqual({ "ugc-creator": "creator", "ugc-script": "plan", "ugc-clips": "clips", "ugc-clip": "video-out", "ugc-cards": "layerPlan", "ugc-finish-clips": "video-out" })
  })
  it("lists the eight screenshot slots in card order", () => {
    expect(UGC_SCREENSHOT_HANDLES).toEqual(["screenshot", "screenshot2", "screenshot3", "screenshot4", "screenshot5", "screenshot6", "screenshot7", "screenshot8"])
  })
  it("names the four pickers UGC Creator's look input takes, from the index too", async () => {
    expect([...UGC_CREATOR_PICKER_TYPES].sort()).toEqual(["lighting", "person", "setting", "styling"])
    const shared: Record<string, unknown> = await import("../index.js")
    expect(shared.UGC_CREATOR_PICKER_TYPES).toBe(UGC_CREATOR_PICKER_TYPES)
  })
})

describe("ugcPipValue: what an edge from a UGC node reads", () => {
  const outputs = { clips: "t0", "plan-out": "p", transcript: "" }
  it("the pip the edge leaves; no pip reads the node's primary output", () => {
    expect(ugcPipValue(outputs, "ugc-clips", "plan-out")).toBe("p")
    expect(ugcPipValue(outputs, "ugc-clips", null)).toBe("t0")
    expect(ugcPipValue(outputs, "ugc-clips", undefined)).toBe("t0")
    expect(ugcPipValue(outputs, "ugc-clips", "")).toBe("t0")
  })
  it("an empty string is a value; a pip the node does not hold is none", () => {
    expect(ugcPipValue(outputs, "ugc-clips", "transcript")).toBe("")
    expect(ugcPipValue({ creator: "{}" }, "ugc-creator", "image")).toBeUndefined()
  })
  it("never reads an inherited key, a non-string or something that is not outputs", () => {
    expect(ugcPipValue(outputs, "ugc-clips", "constructor")).toBeUndefined()
    expect(ugcPipValue({ clips: 3 }, "ugc-clips", "clips")).toBeUndefined()
    for (const raw of [undefined, null, "x", ["t0"]]) expect(ugcPipValue(raw, "ugc-clips", "clips")).toBeUndefined()
    expect(ugcPipValue(outputs, "constructor", null)).toBeUndefined()
  })
})

describe("readUgcWire", () => {
  it("anything that is not a UGC wire gets the caller's message (the version message by default); another v gets the version message", () => {
    for (const raw of [undefined, null, "", "not json", "[1]", [1], 3, { hook: "h" }]) {
      expect(readUgcWire(raw), String(raw)).toEqual({ error: UGC_VERSION_MESSAGE })
      expect(readUgcWire(raw, "Connect it."), String(raw)).toEqual({ error: "Connect it." })
    }
    expect(readUgcWire({ v: "1" }, "Connect it.")).toEqual({ error: UGC_VERSION_MESSAGE })
    expect(readUgcWire(JSON.stringify({ v: 1, a: [1] }))).toEqual({ value: { v: 1, a: [1] } })
  })
})

describe("ugcFailure", () => {
  it("only the router's 404 (no error code) is the Cloud sentence; a route's own 404 keeps its message", () => {
    expect(ugcFailure(404, JSON.stringify({ message: "Route POST:/v1/ugc/clip not found", error: "Not Found", statusCode: 404 }))).toBe(UGC_NOT_SERVED_MESSAGE)
    expect(ugcFailure(404, "<html>not found</html>")).toBe(UGC_NOT_SERVED_MESSAGE)
    expect(ugcFailure(404, JSON.stringify({ error: { code: "not_found", message: "That image is gone." } }))).toBe("That image is gone.")
  })
  it("forwards a 4xx or 503 message; any other failure names its status", () => {
    expect(ugcFailure(400, JSON.stringify({ error: { code: "validation_error", message: "source.imageUrl: Invalid url", issues: [] } }))).toBe("source.imageUrl: Invalid url")
    expect(ugcFailure(402, JSON.stringify({ error: { code: "insufficient_credits", message: "Not enough credits." } }))).toBe("Not enough credits.")
    expect(ugcFailure(429, JSON.stringify({ statusCode: 429, error: { code: "rate_limit_exceeded", message: "Too many requests. Retry in 9s." } }))).toBe("Too many requests. Retry in 9s.")
    expect(ugcFailure(413, JSON.stringify({ statusCode: 413, error: "Payload Too Large", message: "Request body is too large" }))).toBe("Request body is too large")
    expect(ugcFailure(503, JSON.stringify({ error: { code: "x", message: "UGC clips need a newer app version" } }))).toBe("UGC clips need a newer app version")
    expect(ugcFailure(503, "")).toBe("UGC step failed (503)")
    expect(ugcFailure(500, JSON.stringify({ error: { code: "internal", message: "stack details" } }))).toBe("UGC step failed (500)")
    expect(ugcFailure(400, "not json")).toBe("UGC step failed (400)")
    expect(ugcFailure(422, JSON.stringify({ error: { code: "x", message: "   " } }))).toBe("UGC step failed (422)")
  })
})

describe("ugcCreatorBody: the remaining rules", () => {
  it("needs woman or man, on either source", () => {
    expect(ugcCreatorBody({ data: { source: "sampled" }, category: "saas" })).toEqual({ error: "Choose woman or man." })
    expect(ugcCreatorBody({ data: { source: "photo", gender: "other" }, photoUrl: "https://cdn.example/p.png" })).toEqual({ error: "Choose woman or man." })
  })
  it("no source is a sampled creator; the override wins over the wired category; an empty one is absent", () => {
    expect(ugcCreatorBody({ data: { gender: "man", categoryOverride: "beauty" }, category: "saas" }))
      .toEqual({ body: { source: { kind: "sampled", gender: "man", productCategory: "beauty" } } })
    expect(ugcCreatorBody({ data: { gender: "man", categoryOverride: "" }, category: "saas" }))
      .toEqual({ body: { source: { kind: "sampled", gender: "man", productCategory: "saas" } } })
    expect(ugcCreatorBody({ data: { gender: "man", categoryOverride: " " }, category: " " })).toEqual({ error: "Run UGC Script first, or pick a product category." })
  })
  it("a re-roll sends the last sampled traits as previous; a kept result, a photo result or a photo source sends none", () => {
    const result = { v: 1, kind: "sampled", gender: "woman", identityImages: ["https://cdn.example/c.png"], traits: { t: 1 } }
    expect(ugcCreatorBody({ data: { gender: "woman", keepResult: false, result }, category: "saas" }))
      .toEqual({ body: { source: { kind: "sampled", gender: "woman", productCategory: "saas", previous: { t: 1 } } } })
    expect(ugcCreatorBody({ data: { gender: "woman", keepResult: true, result }, category: "saas" }))
      .toEqual({ body: { source: { kind: "sampled", gender: "woman", productCategory: "saas" } } })
    expect(ugcCreatorBody({ data: { gender: "woman", result: { ...result, kind: "photo", traits: null } }, category: "saas" }))
      .toEqual({ body: { source: { kind: "sampled", gender: "woman", productCategory: "saas" } } })
    expect(ugcCreatorBody({ data: { source: "photo", gender: "woman", photoUrl: "https://cdn.example/p.png", seed: 3, result }, category: "saas", pickers: { person: { age: "a" } } }))
      .toEqual({ body: { source: { kind: "photo", imageUrl: "https://cdn.example/p.png", gender: "woman" } } })
  })
  it("sends only the pickers that set a field", () => {
    expect(ugcCreatorBody({ data: { gender: "woman" }, category: "saas", pickers: { person: {}, setting: { setting: "s" } } }))
      .toEqual({ body: { source: { kind: "sampled", gender: "woman", productCategory: "saas", pickers: { setting: { setting: "s" } } } } })
    expect(ugcCreatorBody({ data: { gender: "woman" }, category: "saas", pickers: { person: {} } }))
      .toEqual({ body: { source: { kind: "sampled", gender: "woman", productCategory: "saas" } } })
  })
  it("uses the node's photo when none is wired, and passes the URL on for the route to check", () => {
    expect(ugcCreatorBody({ data: { source: "photo", gender: "man", photoUrl: "https://cdn.example/typed.png" }, photoUrl: "" }))
      .toEqual({ body: { source: { kind: "photo", imageUrl: "https://cdn.example/typed.png", gender: "man" } } })
    expect(ugcCreatorBody({ data: { source: "photo", gender: "man", photoUrl: "file:///etc/x.png" } }))
      .toEqual({ body: { source: { kind: "photo", imageUrl: "file:///etc/x.png", gender: "man" } } })
  })
})

describe("ugcCreatorOutputs: a photo", () => {
  it("keeps the photo as the identity image; the missing sampled fields are null", () => {
    const answer = { kind: "photo", gender: "man", traits: null, identityImages: ["https://cdn.example/p.png"], seed: 4, promptsVersion: "1.0.0", image: null, candidates: [], fallback: null, pick: null, photoCheck: { tool: "image_to_text", args: {} } }
    const o = ugcCreatorOutputs(answer, ["https://cdn.example/p.png"])
    expect(o.record).toEqual({ v: 1, kind: "photo", gender: "man", identityImages: ["https://cdn.example/p.png"], traits: null, seed: 4, promptsVersion: "1.0.0", productCategory: null })
    expect(o.outputs.image).toBe("https://cdn.example/p.png")
  })
  it("copies the images it is given", () => {
    const images = ["https://cdn.example/a.png", "https://cdn.example/a2.png"]
    const o = ugcCreatorOutputs(SAMPLED, images)
    expect(o.record.identityImages).toEqual(images)
    expect(o.record.identityImages).not.toBe(images)
    expect(o.imageUrl).toBe("https://cdn.example/a.png")
  })
})

describe("ugcScriptBody / ugcScriptOutputs: the remaining rules", () => {
  it("trims the site, refuses a blank one, and sends a product image only when there is one", () => {
    expect(ugcScriptBody({ site: "  https://acme.example\n", screenshots: ["", "https://cdn.example/2.png"], productImage: "https://cdn.example/p.png", targetDurationSec: 30 }))
      .toEqual({ body: { site: "https://acme.example", screenshots: ["https://cdn.example/2.png"], productImage: "https://cdn.example/p.png", targetDurationSec: 30, language: "en" } })
    expect(ugcScriptBody({ site: " \n", screenshots: ["https://cdn.example/1.png"] })).toEqual({ error: "Add the product name or website." })
  })
  it("always sends a length: a node with no number gets the default, which is the node's own default", () => {
    // The node's default length and the length the run sends for a node without one are this one constant.
    expect(UGC_SCRIPT_DEFAULT_TARGET_SEC).toBe(15)
    const length = (targetDurationSec: unknown) => {
      const r = ugcScriptBody({ site: "Acme", screenshots: [], targetDurationSec: targetDurationSec as number | undefined })
      return "body" in r ? r.body.targetDurationSec : r.error
    }
    expect(length(undefined)).toBe(UGC_SCRIPT_DEFAULT_TARGET_SEC)
    expect(length(null)).toBe(UGC_SCRIPT_DEFAULT_TARGET_SEC)
    expect(length("20")).toBe(UGC_SCRIPT_DEFAULT_TARGET_SEC)
    expect(length(20)).toBe(20)
    // A number outside the route's range is sent as set, so the route names it.
    expect(length(2)).toBe(2)
  })
  it("an answer without a plan or a category hands nothing on for it", () => {
    expect(ugcScriptOutputs({ productCategory: "saas" })).toEqual({ category: "saas" })
    expect(ugcScriptOutputs({ plan: { hook: "h" } })).toEqual({ plan: JSON.stringify({ v: 1, hook: "h" }) })
  })
})

describe("ugcClipsBody / ugcClipsOutputs: the remaining rules", () => {
  const PLAN = JSON.stringify({ v: 1, hook: "h" })
  const CREATOR = JSON.stringify({ v: 1, gender: "man", identityImages: ["https://cdn.example/c.png"] })
  it("names the missing input; refuses a newer wire", () => {
    expect(ugcClipsBody({ planWire: undefined, creatorWire: CREATOR })).toEqual({ error: "Connect the Script output of UGC Script." })
    expect(ugcClipsBody({ planWire: PLAN, creatorWire: JSON.stringify({ v: 2, gender: "man" }) })).toEqual({ error: UGC_VERSION_MESSAGE })
  })
  it("no creator on the creator input, or one it cannot read, is the one creator-missing message", () => {
    for (const creatorWire of [undefined, null, "", "not json", JSON.stringify({ gender: "man" })]) {
      expect(ugcClipsBody({ planWire: PLAN, creatorWire }), String(creatorWire)).toEqual({ error: UGC_CREATOR_MISSING_MESSAGE })
    }
  })
  it("no voice, no voiceId; a record without traits sends null", () => {
    expect(ugcClipsBody({ planWire: PLAN, creatorWire: CREATOR, voiceId: "" }))
      .toEqual({ body: { plan: { v: 1, hook: "h" }, gender: "man", traits: null, identityImages: ["https://cdn.example/c.png"], surface: "canvas" } })
  })
  it("joins every error with its fix", () => {
    expect(ugcClipsOutputs({ errors: [{ code: "A", message: "One.", fix: "Fix one." }, { code: "B", message: "Two." }] }))
      .toEqual({ error: "The script needs changes: One. Fix one. Two." })
  })
  it("a valid answer the app cannot use fails before any clip renders", () => {
    const ok = { errors: [], tickets: [ticket(0)], sizedPlan: {}, transcript: "a" }
    expect(ugcClipsOutputs({ ...ok, tickets: undefined })).toEqual({ error: UGC_NEWER_APP_MESSAGE })
    expect(ugcClipsOutputs({ ...ok, tickets: [] })).toEqual({ error: UGC_NEWER_APP_MESSAGE })
    expect(ugcClipsOutputs({ ...ok, tickets: ["t"] })).toEqual({ error: UGC_NEWER_APP_MESSAGE })
    expect(ugcClipsOutputs({ ...ok, sizedPlan: undefined })).toEqual({ error: UGC_NEWER_APP_MESSAGE })
    expect(ugcClipsOutputs({ ...ok, transcript: undefined })).toEqual({ error: UGC_NEWER_APP_MESSAGE })
    expect(ugcClipsOutputs({ errors: [{}] })).toEqual({ error: UGC_NEWER_APP_MESSAGE })
  })
  it("hands on the first ticket, the plan-out, the transcript, whether there are cards and whether the clips go through UGC Finish's job", () => {
    const ok = ugcClipsOutputs({ errors: [], tickets: [ticket(0), ticket(1)], sizedPlan: { p: 1 }, transcript: "a b", hasCards: true })
    expect(ok).toEqual({
      outputs: { clips: JSON.stringify(ticket(0)), "plan-out": JSON.stringify({ v: 1, plan: { p: 1 }, transcribeArgs: {} }), transcript: "a b" },
      tickets: [JSON.stringify(ticket(0)), JSON.stringify(ticket(1))],
      hasCards: true,
      finishes: false,
    })
    const none = ugcClipsOutputs({ tickets: [ticket(0)], sizedPlan: {}, transcript: "a", speechCheckCall: { tool: "transcribe", args: null } })
    expect("hasCards" in none && none.hasCards).toBe(false)
    expect("outputs" in none && JSON.parse(none.outputs["plan-out"]!).transcribeArgs).toEqual({})
  })
})

describe("ugcClipBody / ugcClipOutputs: the remaining rules", () => {
  it("names the missing ticket, a ticket without its index or length, and a newer ticket", () => {
    expect(ugcClipBody({ ticketWire: undefined })).toEqual({ error: "Connect the Clips output of UGC Clips." })
    expect(ugcClipBody({ ticketWire: JSON.stringify({ v: 1, hook: "a plan" }) })).toEqual({ error: "Connect the Clips output of UGC Clips." })
    expect(ugcClipBody({ ticketWire: JSON.stringify({ ...ticket(0), index: -1 }) })).toEqual({ error: "Connect the Clips output of UGC Clips." })
    expect(ugcClipBody({ ticketWire: JSON.stringify({ ...ticket(0), durationSec: 0 }) })).toEqual({ error: "Connect the Clips output of UGC Clips." })
    expect(ugcClipBody({ ticketWire: JSON.stringify({ ...ticket(0), v: 2 }) })).toEqual({ error: UGC_VERSION_MESSAGE })
  })
  it("no re-render of this clip, or an unreadable count, is nonce 0; no runKey without one", () => {
    expect(ugcClipBody({ ticketWire: JSON.stringify(ticket(0)), rerender: { "2": 4 } })).toEqual({ body: { ticket: ticket(0), nonce: 0 }, clipNumber: 1, durationSec: 12 })
    expect(ugcClipBody({ ticketWire: JSON.stringify(ticket(0)), rerender: { "1": "2" } as never })).toEqual({ body: { ticket: ticket(0), nonce: 0 }, clipNumber: 1, durationSec: 12 })
    expect(ugcClipBody({ ticketWire: ticket(2), runKey: "" })).toEqual({ body: { ticket: ticket(2), nonce: 0 }, clipNumber: 3, durationSec: 12 })
  })
  it("the finished clip: its video, its real length and its warnings", () => {
    expect(ugcClipOutputs({ videoUrl: "https://cdn.example/c1.mp4", durationSec: 13, clipWarnings: ["clip_lengthened:13", 7], frameCheck: { passed: true } }))
      .toEqual({ outputs: { "video-out": "https://cdn.example/c1.mp4" }, videoUrl: "https://cdn.example/c1.mp4", durationSec: 13, clipWarnings: ["clip_lengthened:13"] })
    expect(ugcClipOutputs({ videoUrl: "https://cdn.example/c1.mp4", durationSec: "13" })).toMatchObject({ durationSec: null, clipWarnings: [] })
    expect(ugcClipOutputs({})).toEqual({ outputs: {}, videoUrl: "", durationSec: null, clipWarnings: [] })
  })
  it("reads the clip job's completion exactly as the plugin writes it: clipWarnings, never warnings", () => {
    // The clip job completes with { durationSec, clipWarnings, frameCheck, videoUrl }.
    const completed = { durationSec: 16, clipWarnings: ["clip_lengthened:16", "frame_check_failed"], frameCheck: { passed: false, rerendered: true }, videoUrl: "https://cdn.example/c2.mp4" }
    expect(ugcClipOutputs(completed)).toEqual({
      outputs: { "video-out": "https://cdn.example/c2.mp4" },
      videoUrl: "https://cdn.example/c2.mp4",
      durationSec: 16,
      clipWarnings: ["clip_lengthened:16", "frame_check_failed"],
    })
    expect(ugcClipOutputs({ ...completed, clipWarnings: [] }).clipWarnings).toEqual([])
    const { clipWarnings: _w, ...noWarnings } = completed
    expect(ugcClipOutputs(noWarnings).clipWarnings).toEqual([])
    expect(ugcClipOutputs({ ...noWarnings, warnings: ["frame_check_failed"] }).clipWarnings).toEqual([])
  })
})

describe("ugcCardsJobs / ugcCardsBody / ugcCardsOutputs: the remaining rules", () => {
  const PLAN_OUT = JSON.stringify({ v: 1, plan: { hook: "h" }, transcribeArgs: {} })
  const NOT_PLAN_OUT = "Connect the Script (sized) output of UGC Clips."
  it("refuses before any job: no plan-out, a plan-out without its parts, a newer one, no video, no transcript", () => {
    const at = { videoUrl: "https://cdn.example/v.mp4", transcript: "a" }
    expect(ugcCardsJobs({ planOutWire: undefined, ...at })).toEqual({ error: NOT_PLAN_OUT })
    expect(ugcCardsJobs({ planOutWire: "not json", ...at })).toEqual({ error: NOT_PLAN_OUT })
    expect(ugcCardsJobs({ planOutWire: JSON.stringify({ v: 1, plan: {}, transcribeArgs: [] }), ...at })).toEqual({ error: NOT_PLAN_OUT })
    expect(ugcCardsJobs({ planOutWire: JSON.stringify({ v: 2, plan: {}, transcribeArgs: {} }), ...at })).toEqual({ error: UGC_VERSION_MESSAGE })
    expect(ugcCardsJobs({ planOutWire: PLAN_OUT, transcript: "a" })).toEqual({ error: "Connect the joined video." })
    expect(ugcCardsJobs({ planOutWire: PLAN_OUT, videoUrl: "https://cdn.example/v.mp4" })).toEqual({ error: "Connect the Transcript output of UGC Clips." })
  })
  it("an empty transcript is UGC Clips' answer, not a missing input: it goes on as it came", () => {
    for (const transcript of ["", " "]) {
      const jobs = ugcCardsJobs({ planOutWire: PLAN_OUT, videoUrl: "https://cdn.example/v.mp4", transcript })
      expect("alignment" in jobs && jobs.alignment.body, JSON.stringify(transcript)).toEqual({ audioUrl: "https://cdn.example/v.mp4", transcript })
    }
  })
  it("hands the wrapper's plan on, never the wrapper", () => {
    const jobs = ugcCardsJobs({ planOutWire: PLAN_OUT, videoUrl: "https://cdn.example/v.mp4", transcript: "a b" })
    expect(jobs).toMatchObject({ alignment: { path: "/v1/forced-alignment" }, transcribe: { path: "/v1/transcribe" }, plan: { hook: "h" } })
  })
  it("the cards body: canvas, the timing sources that are lists, the failures and the notes always", () => {
    const base = { plan: { hook: "h" }, videoUrl: "https://cdn.example/v.mp4", failed: [] as const, clipNotes: [] }
    expect(ugcCardsBody({ ...base, alignment: [{ word: "a", start: 0, end: 0.3 }], words: [{ text: "a", startMs: 0, endMs: 300 }] }))
      .toEqual({ surface: "canvas", plan: { hook: "h" }, videoUrl: "https://cdn.example/v.mp4", alignment: [{ word: "a", start: 0, end: 0.3 }], words: [{ text: "a", startMs: 0, endMs: 300 }], failed: [], clipNotes: [] })
    expect(ugcCardsBody({ ...base, alignment: undefined, words: { not: "a list" }, failed: ["alignment"], clipNotes: [{ clip: 1, warnings: ["w"], durationSec: 12 }] }))
      .toEqual({ surface: "canvas", plan: { hook: "h" }, videoUrl: "https://cdn.example/v.mp4", failed: ["alignment"], clipNotes: [{ clip: 1, warnings: ["w"], durationSec: 12 }] })
  })
  it("a timing becomes a caption plan Add Captions reads; the report lines are joined", () => {
    const timing = { hookText: "h", hookEndMs: 900, bodyEndMs: 4000, captions: [{ text: "a", startMs: 1000, endMs: 1300 }], videoDurationMs: 4200, language: "en" }
    const o = ugcCardsOutputs({ layerPlan: [{ imageUrl: "https://cdn.example/1.png", start: 1, end: 2 }], captionTiming: timing, report: { lines: ["One.", "Two."] } })
    expect(JSON.parse(o.captionPlan!)).toEqual({ v: 1, ...timing })
    expect(parseCaptionPlan(o.captionPlan)).toEqual({ plan: { v: 1, ...timing } })
    expect(JSON.parse(o.layerPlan!)).toEqual([{ imageUrl: "https://cdn.example/1.png", start: 1, end: 2 }])
    expect(o.report).toBe("One.\nTwo.")
    const empty = ugcCardsOutputs({})
    expect(empty).toEqual({ layerPlan: "[]", captionPlan: JSON.stringify({ v: 1, hookText: "", hookEndMs: 0, bodyEndMs: 0, captions: [] }), report: "" })
    expect("plan" in parseCaptionPlan(empty.captionPlan)).toBe(true)
  })
})

describe("a kept result is handed on without a run", () => {
  const record = { v: 1, kind: "sampled", gender: "woman", identityImages: ["https://cdn.example/c.png"], traits: { t: 1 }, seed: 7, promptsVersion: "1.0.0", productCategory: "saas" }
  const scriptResult = { plan: { hook: "h" }, productCategory: "saas", warnings: [], notes: [], rounds: 1 }
  it("a kept creator hands on its record and its first image", () => {
    expect(ugcKeptOutputs("ugc-creator", { keepResult: true, result: record })).toEqual({ creator: JSON.stringify(record), image: "https://cdn.example/c.png" })
  })
  it("a kept script hands on its result's outputs", () => {
    expect(ugcKeptOutputs("ugc-script", { keepResult: true, result: scriptResult })).toEqual(ugcScriptOutputs(scriptResult))
  })
  it("not kept: nothing, so the node runs", () => {
    expect(ugcKeptOutputs("ugc-creator", { keepResult: false, result: record })).toBeNull()
    expect(ugcKeptOutputs("ugc-script", { result: scriptResult })).toBeNull()
    expect(ugcKeptOutputs("ugc-creator", { keepResult: "true", result: record })).toBeNull()
  })
  it("Keep on with nothing to hand on runs the node: no result, a creator with no image, a script with no plan", () => {
    expect(ugcKeptOutputs("ugc-creator", { keepResult: true })).toBeNull()
    expect(ugcKeptOutputs("ugc-creator", { keepResult: true, result: "a record" })).toBeNull()
    expect(ugcKeptOutputs("ugc-creator", { keepResult: true, result: { ...record, identityImages: [] } })).toBeNull()
    expect(ugcKeptOutputs("ugc-creator", { keepResult: true, result: { ...record, identityImages: [" "] } })).toBeNull()
    expect(ugcKeptOutputs("ugc-script", { keepResult: true, result: { productCategory: "saas" } })).toBeNull()
    expect(ugcKeptOutputs("ugc-script", { keepResult: true, result: [scriptResult] })).toBeNull()
  })
  it("the kept record goes on unread: one from another version is refused where it is read", () => {
    const newer = ugcKeptOutputs("ugc-creator", { keepResult: true, result: { ...record, v: 2 } })
    expect(newer?.creator).toBe(JSON.stringify({ ...record, v: 2 }))
    expect(ugcClipsBody({ planWire: JSON.stringify({ v: 1, hook: "h" }), creatorWire: newer?.creator })).toEqual({ error: UGC_VERSION_MESSAGE })
  })
  it("only UGC Creator and UGC Script keep a result", () => {
    for (const type of ["ugc-clips", "ugc-clip", "ugc-cards"]) {
      expect(ugcKeptOutputs(type as "ugc-script", { keepResult: true, result: scriptResult }), type).toBeNull()
    }
  })
  it("is re-exported from the package index", async () => {
    const shared: Record<string, unknown> = await import("../index.js")
    expect(shared.ugcKeptOutputs).toBe(ugcKeptOutputs)
    expect(shared.ugcScriptResult).toBe(ugcScriptResult)
  })
})

describe("UGC Script's result, the same on both engines", () => {
  it("takes the plan, the category, the warnings, the notes and the rounds; nothing else", () => {
    expect(ugcScriptResult({ plan: { hook: "h" }, productCategory: "saas", warnings: [{ code: "w" }], notes: ["n", 3], rounds: 2, extra: 1 }))
      .toEqual({ plan: { hook: "h" }, productCategory: "saas", warnings: [{ code: "w" }], notes: ["n"], rounds: 2 })
  })
  it("a row without a plan has no result", () => {
    expect(ugcScriptResult({ productCategory: "saas" })).toBeUndefined()
  })
  it("fills what the row leaves out, and copies the lists it keeps", () => {
    expect(ugcScriptResult({ plan: { hook: "h" }, productCategory: " ", rounds: Number.NaN })).toEqual({ plan: { hook: "h" }, productCategory: "", warnings: [], notes: [], rounds: 0 })
    const warnings = [{ code: "w" }]
    expect(ugcScriptResult({ plan: { hook: "h" }, warnings })?.warnings).not.toBe(warnings)
    expect(ugcScriptResult({ plan: [{ hook: "h" }] })).toBeUndefined()
  })
})

describe("a creator waiting for a pick hands nothing on", () => {
  const record = { v: 1, gender: "woman", identityImages: ["https://cdn.example/old.png"] }
  it("ugcKeptOutputs is null while options wait, whatever keepResult says", () => {
    const kept = { keepResult: true, result: record }
    expect(ugcKeptOutputs("ugc-creator", kept)).not.toBeNull()
    expect(ugcKeptOutputs("ugc-creator", { ...kept, candidates: [{ imageUrl: "https://cdn.example/a.png", record }] })).toBeNull()
  })
})

describe("a UGC Creator waiting for a pick", () => {
  const cand = (url: string, traits: Record<string, unknown>) => ({ imageUrl: url, record: { v: 1, gender: "woman", identityImages: [url], traits } })
  it("two or more options on a run's output wait; one, none or a creator does not", () => {
    expect(ugcAwaitsPick({ ugcCandidates: [cand("https://cdn.example/a.png", {}), cand("https://cdn.example/b.png", {})] })).toBe(true)
    expect(ugcAwaitsPick({ ugcCandidates: [cand("https://cdn.example/a.png", {})] })).toBe(false)
    expect(ugcAwaitsPick({ ugcOutputs: { creator: "{}" } })).toBe(false)
    expect(ugcAwaitsPick(undefined)).toBe(false)
  })
  it("a re-draw takes `previous` from the latest creator the person saw: the waiting options, else the result", () => {
    const data = { source: "sampled", gender: "woman", keepResult: false, result: { v: 1, traits: { t: 1 } }, candidates: [cand("https://cdn.example/a.png", { t: 2 }), cand("https://cdn.example/b.png", { t: 2 })] }
    expect(ugcCreatorBody({ data, category: "saas" })).toEqual({ body: { source: { kind: "sampled", gender: "woman", productCategory: "saas", previous: { t: 2 } } } })
    const { candidates: _c, ...picked } = data
    expect(ugcCreatorBody({ data: picked, category: "saas" })).toEqual({ body: { source: { kind: "sampled", gender: "woman", productCategory: "saas", previous: { t: 1 } } } })
  })
  it("waiting options name `previous` even with Keep on, and an option without traits names none", () => {
    const kept = { source: "sampled", gender: "woman", keepResult: true, result: { v: 1, traits: { t: 1 } }, candidates: [cand("https://cdn.example/a.png", { t: 3 })] }
    expect(ugcCreatorBody({ data: kept, category: "saas" })).toEqual({ body: { source: { kind: "sampled", gender: "woman", productCategory: "saas", previous: { t: 3 } } } })
    const bare = { ...kept, candidates: [{ imageUrl: "https://cdn.example/a.png", record: { v: 1 } }] }
    expect(ugcCreatorBody({ data: bare, category: "saas" })).toEqual({ body: { source: { kind: "sampled", gender: "woman", productCategory: "saas" } } })
  })
  it("a run output that is not an object, or a list that is not one, never waits", () => {
    expect(ugcAwaitsPick("two")).toBe(false)
    expect(ugcAwaitsPick({ ugcCandidates: "two" })).toBe(false)
    expect(ugcAwaitsPick({ ugcCandidates: { length: 2 } })).toBe(false)
  })
})

describe("ugcPlanLengthSec: the length a saved plan was written to", () => {
  it("reads the plan's own length, from the plan or its wire", async () => {
    const { ugcPlanLengthSec } = await import("../ugc-node-wires.js")
    const plan = { v: 1, hook: "h", beats: [{ line: "b" }], closer: { line: "c" }, targetDurationSec: 30 }
    expect(ugcPlanLengthSec(plan)).toBe(30)
    expect(ugcPlanLengthSec(JSON.stringify(plan))).toBe(30)
  })
  it("is undefined for a plan with no length, or one outside the script's range, and for anything that is not a plan", async () => {
    const { ugcPlanLengthSec, UGC_SCRIPT_MIN_TARGET_SEC, UGC_SCRIPT_MAX_TARGET_SEC } = await import("../ugc-node-wires.js")
    expect(ugcPlanLengthSec({ v: 1, hook: "h" })).toBeUndefined()
    for (const bad of [UGC_SCRIPT_MIN_TARGET_SEC - 1, UGC_SCRIPT_MAX_TARGET_SEC + 1, 15.5, "15", null, Number.NaN]) {
      expect(ugcPlanLengthSec({ v: 1, targetDurationSec: bad }), String(bad)).toBeUndefined()
    }
    for (const notPlan of [undefined, null, "", "not json", 15, [], "[1]"]) expect(ugcPlanLengthSec(notPlan), String(notPlan)).toBeUndefined()
    expect(ugcPlanLengthSec({ v: 1, targetDurationSec: UGC_SCRIPT_MIN_TARGET_SEC })).toBe(UGC_SCRIPT_MIN_TARGET_SEC)
    expect(ugcPlanLengthSec({ v: 1, targetDurationSec: UGC_SCRIPT_MAX_TARGET_SEC })).toBe(UGC_SCRIPT_MAX_TARGET_SEC)
  })
})

describe("ugcPlanScreenshotCount: the screenshot cards a saved plan was written with", () => {
  // Placeholders: a beat's screenshot names an upload or an asset; only that it is there is read.
  const shot = { url: "https://cdn.example/1.png" }
  it("counts the beats that carry a screenshot, from the plan or its wire", async () => {
    const { ugcPlanScreenshotCount } = await import("../ugc-node-wires.js")
    const plan = { v: 1, hook: "h", beats: [{ line: "a", screenshot: shot }, { line: "b", screenshot: { asset_id: "x" } }, { line: "c", screenshot: shot }], closer: { line: "c" } }
    expect(ugcPlanScreenshotCount(plan)).toBe(3)
    expect(ugcPlanScreenshotCount(JSON.stringify(plan))).toBe(3)
  })
  it("a plan whose beats carry none is a talking-head plan: 0", async () => {
    const { ugcPlanScreenshotCount } = await import("../ugc-node-wires.js")
    expect(ugcPlanScreenshotCount({ v: 1, hook: "h", beats: [{ line: "a" }, { line: "b", screenshot: null }] })).toBe(0)
  })
  it("reads each beat on its own: a beat counts only when its screenshot is an object; a malformed or empty beat counts none and never makes the plan unreadable", async () => {
    const { ugcPlanScreenshotCount } = await import("../ugc-node-wires.js")
    expect(ugcPlanScreenshotCount({ v: 1, beats: [{ line: "a", screenshot: shot }, "b", null, 7, [shot]] })).toBe(1)
    expect(ugcPlanScreenshotCount({ v: 1, beats: [{ line: "a", screenshot: "https://cdn.example/1.png" }, { line: "b", screenshot: shot }] })).toBe(1)
    expect(ugcPlanScreenshotCount({ v: 1, beats: [{ line: "a", screenshot: false }, { line: "b", screenshot: [shot] }, { line: "c", screenshot: 1 }] })).toBe(0)
    expect(ugcPlanScreenshotCount({ v: 1, beats: [] })).toBe(0)
  })
  it("is undefined only for a plan that cannot be read at all: no beats to read, or not a plan", async () => {
    const { ugcPlanScreenshotCount } = await import("../ugc-node-wires.js")
    expect(ugcPlanScreenshotCount({ v: 1, hook: "h" })).toBeUndefined()
    expect(ugcPlanScreenshotCount({ v: 1, beats: "three" })).toBeUndefined()
    for (const notPlan of [undefined, null, "", "not json", 15, [], "[1]"]) expect(ugcPlanScreenshotCount(notPlan), String(notPlan)).toBeUndefined()
  })
})

describe("UGC_NODE_MESSAGES: every fixed sentence a UGC node fails with, by id", () => {
  it("each id is the sentence its refusal answers", async () => {
    const shared: Record<string, unknown> = await import("../index.js")
    const { UGC_NODE_MESSAGES: M, UGC_SCRIPT_NEEDS_CHANGES } = await import("../ugc-node-wires.js")
    expect(shared.UGC_NODE_MESSAGES).toBe(M)
    expect(shared.UGC_SCRIPT_NEEDS_CHANGES).toBe(UGC_SCRIPT_NEEDS_CHANGES)
    expect(Object.isFrozen(M)).toBe(true)

    const CREATOR = JSON.stringify({ v: 1, gender: "man", identityImages: ["https://cdn.example/c.png"] })
    const PLAN_OUT = JSON.stringify({ v: 1, plan: { hook: "h" }, transcribeArgs: {} })
    const answers: Record<keyof typeof M, unknown> = {
      notServed: ugcFailure(404, ""),
      version: readUgcWire(JSON.stringify({ v: 2 })),
      newerApp: ugcClipsOutputs({}),
      pickGone: ugcCreatorPick(undefined, 0),
      creatorMissing: ugcClipsBody({ planWire: JSON.stringify({ v: 1, hook: "h" }), creatorWire: undefined }),
      minorAge: ugcFailure(422, JSON.stringify({ error: { code: "minor_age_refused", message: "m" } })),
      needsGender: ugcCreatorBody({ data: { source: "sampled" }, category: "saas" }),
      needsPhoto: ugcCreatorBody({ data: { source: "photo", gender: "man", keepResult: false } }),
      needsCategory: ugcCreatorBody({ data: { source: "sampled", gender: "woman", keepResult: false } }),
      needsSite: ugcScriptBody({ screenshots: [] }),
      needsPlanOut: ugcCardsJobs({ planOutWire: JSON.stringify({ v: 1, hook: "a bare plan" }), videoUrl: "https://cdn.example/v.mp4", transcript: "a" }),
      needsPlan: ugcClipsBody({ planWire: undefined, creatorWire: CREATOR }),
      needsTicket: ugcClipBody({ ticketWire: undefined }),
      needsVideo: ugcCardsJobs({ planOutWire: PLAN_OUT, transcript: "a" }),
      needsTranscript: ugcCardsJobs({ planOutWire: PLAN_OUT, videoUrl: "https://cdn.example/v.mp4" }),
      needsFinish: ugcLaneNeedsFinish([], [], "clips"),
      finishNeedsClips: ugcFinishPlan({ planOutWire: PLAN_OUT, clipUrls: [] }),
      finishNotReady: ugcFinishOutputs({ ready: false, reroll: [1], failed: [] }),
    }
    for (const [id, answer] of Object.entries(answers)) {
      const said = typeof answer === "string" ? answer : (answer as { error?: unknown }).error
      expect(said, id).toBe(M[id as keyof typeof M])
    }
    expect(new Set(Object.values(M)).size).toBe(Object.keys(M).length)
  })

  it("a refused script opens with UGC_SCRIPT_NEEDS_CHANGES, then the plugin's own words", async () => {
    const { UGC_SCRIPT_NEEDS_CHANGES } = await import("../ugc-node-wires.js")
    expect(ugcClipsOutputs({ errors: [{ message: "Too long.", fix: "Trim it." }] })).toEqual({ error: `${UGC_SCRIPT_NEEDS_CHANGES} Too long. Trim it.` })
  })
})
