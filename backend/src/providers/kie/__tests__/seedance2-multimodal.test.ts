import { describe, it, expect } from "vitest"
import { applySeedance2Params } from "../video.js"
import { buildPayload } from "../../../services/workflow-engine/payload-builder.js"
import type { SimpleNode, SimpleEdge, ResolvedInputs } from "../../../services/workflow-engine/types.js"

// applySeedance2Params now delegates to the shared `resolveSeedance2Inputs`
// resolver and routes the frame keys itself (it returns void). Any reference
// (image, video, OR audio) switches Seedance 2 into multimodal Reference mode,
// where the frames are MOVED into `reference_image_urls` (after the user's own
// images) instead of being rejected or left as `first_frame_url`.
//
// Lip-sync intent is preserved: a face image (→ first_frame_url) PLUS reference
// audio (the voice line) keeps the face — it just rides along as a reference
// image with a "use as opening frame" suffix, so the model still has its subject
// and the audio is still forwarded.
describe("applySeedance2Params — Seedance 2 multimodal input routing", () => {
  it("reference AUDIO + first frame → reference mode: face moved into reference_image_urls, audio forwarded, frame suffix appended", () => {
    const input: Record<string, unknown> = { prompt: "talk", first_frame_url: "https://cdn.example/face.png" }
    applySeedance2Params(input, {
      referenceAudioUrls: ["https://cdn.example/voice.mp3"],
    } as never)
    // The face frame is preserved as a reference image (lip-sync subject kept)…
    expect(input.first_frame_url).toBeUndefined()
    expect(input.reference_image_urls).toEqual(["https://cdn.example/face.png"])
    // …the audio is still forwarded to KIE…
    expect(input.reference_audio_urls).toEqual(["https://cdn.example/voice.mp3"])
    // …and the frame is named in the prompt suffix.
    expect(input.prompt).toBe("talk\n\nUse Image 1 as the opening (first) frame of the video.")
  })

  it("reference VIDEO + frames → reference mode: frames moved into reference_image_urls, video forwarded (no throw)", () => {
    const input: Record<string, unknown> = { first_frame_url: "https://cdn.example/f.png", last_frame_url: "https://cdn.example/l.png" }
    expect(() =>
      applySeedance2Params(input, {
        referenceVideoUrls: ["https://cdn.example/clip.mp4"],
      } as never),
    ).not.toThrow()
    expect(input.first_frame_url).toBeUndefined()
    expect(input.last_frame_url).toBeUndefined()
    expect(input.reference_video_urls).toEqual(["https://cdn.example/clip.mp4"])
    expect(input.reference_image_urls).toEqual(["https://cdn.example/f.png", "https://cdn.example/l.png"])
  })

  it("reference IMAGE alone (no frames) → reference mode: image forwarded, no frame keys, no suffix", () => {
    const input: Record<string, unknown> = { prompt: "p" }
    applySeedance2Params(input, {
      referenceImageUrls: ["https://cdn.example/ref.png"],
    } as never)
    expect(input.reference_image_urls).toEqual(["https://cdn.example/ref.png"])
    expect(input.first_frame_url).toBeUndefined()
    expect(input.last_frame_url).toBeUndefined()
    expect(input.prompt).toBe("p")
  })

  it("generate_audio is NO LONGER owned by applySeedance2Params (set by applyVideoAudioToggle at the call site)", () => {
    const input: Record<string, unknown> = { first_frame_url: "https://cdn.example/face.png" }
    applySeedance2Params(input, {
      referenceAudioUrls: ["https://cdn.example/voice.mp3"],
      generateAudio: false,
    } as never)
    expect(input.generate_audio).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// COMBINED-CASE numbering consistency: a @-mentioned character whose image
// ALSO fills the i2v start frame, WHILE separate references are present, in
// Seedance 2 reference mode.
//
// Two numbering authorities write `Image N` tokens into the SAME prompt:
//   • `resolveVideoPromptMentions` (payload-builder) numbers the character /
//     extra identity bullets against the FRONT of the reference list.
//   • `resolveSeedance2Inputs` (video.ts) numbers the first/last frame against
//     the FINAL `reference_image_urls`, appending the frame to the TAIL.
//
// These agree in the common case (refs first, a distinct frame appended last).
// They desynced ONLY when a @-mentioned character auto-filled the empty start
// frame: the mention bullet froze it at `Image 1`, but the resolver moved that
// same URL to the tail and emitted "Use Image <tail> as the opening frame" —
// double-numbering `Image 1`/`Image 2`. The payload-builder guard now keeps
// such a mention front-of-list as a plain reference (no frame promotion) when
// other refs are present, so reference mode carries it at its bullet's number
// and no contradictory frame suffix is emitted.
//
// This exercises the FULL seam: buildPayload (mention resolution + merge) →
// applySeedance2Params (resolver) → final KIE prompt + reference_image_urls.
// ---------------------------------------------------------------------------
describe("Seedance 2 combined case — frame-as-mention numbering stays consistent", () => {
  function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
    return { id, type, data }
  }
  function edge(source: string, target: string): SimpleEdge {
    return { id: `${source}->${target}`, source, target, sourceHandle: null, targetHandle: null }
  }
  function charNode(id: string): SimpleNode {
    return node(id, "character", {
      label: "Kira",
      characterName: "Kira",
      sourceImageUrl: "https://r2/kira-source.png",
      description: "young woman",
      canonicalDescription: "young woman, brown eyes, auburn hair",
      defaultAssetUrl: "https://r2/kira-portrait.png",
      expressions: [{ name: "smile", url: "https://r2/kira-smile.png" }],
      poses: [], motions: [], angles: [], bodyAngles: [], lightingVariations: [],
    })
  }

  // Run buildPayload for the i2v node, then push its imageUrl/referenceImageUrls
  // through the SAME provider seam the worker uses (first_frame_url + options).
  function runSeam(i2vData: Record<string, unknown>, inputs: ResolvedInputs) {
    const character = charNode("char-1")
    const i2v = node("i2v-1", "image-to-video", { provider: "seedance-2", ...i2vData })
    const result = buildPayload(
      i2v,
      "job-1",
      inputs,
      undefined,
      { nodes: [character, i2v], edges: [edge("char-1", "i2v-1")], nodeStates: {} },
    )
    const prompt = result.payload.prompt as string
    const input: Record<string, unknown> = { prompt, first_frame_url: result.payload.imageUrl }
    applySeedance2Params(input, { referenceImageUrls: result.payload.referenceImageUrls } as never)
    const finalRefs = (input.reference_image_urls as string[] | undefined) ?? []
    const firstFrameUrl = input.first_frame_url as string | undefined
    const lastFrameUrl = input.last_frame_url as string | undefined
    // The ordered list of images the KIE model actually receives + indexes as
    // `Image N`: reference mode hands ONLY `reference_image_urls`; strict
    // first/last-frame mode hands the frame URL(s) in slot order instead.
    const modelImages = finalRefs.length > 0
      ? finalRefs
      : [firstFrameUrl, lastFrameUrl].filter((u): u is string => Boolean(u))
    return {
      finalRefs,
      finalPrompt: input.prompt as string,
      firstFrameUrl,
      modelImages,
    }
  }

  // Asserts that every `Image N` ordinal in the prompt addresses exactly one
  // image, and the frame suffix's ordinal points at the slot that truly holds
  // the frame. `modelImages` is the ordered list the model is handed (refs in
  // reference mode; frame slots in strict mode). The desync bug manifested as a
  // frame suffix reusing an ordinal already bound to an earlier identity bullet
  // for a DIFFERENT image — caught here by requiring the suffix ordinal to map
  // to `frameUrl` within `modelImages`.
  function assertConsistent(
    finalPrompt: string,
    modelImages: string[],
    frameUrl: string | undefined,
  ) {
    // Every ordinal must be a valid 1-based index into the images the model sees.
    const allOrdinals = Array.from(finalPrompt.matchAll(/Image (\d+)/g)).map((m) => parseInt(m[1], 10))
    for (const n of allOrdinals) {
      expect(n).toBeGreaterThanOrEqual(1)
      expect(n).toBeLessThanOrEqual(modelImages.length)
    }
    // If a frame suffix is present, its ordinal must address the slot holding
    // the frame URL (not a different reference image).
    const frameMatch = finalPrompt.match(/Use Image (\d+) as the (opening|closing)/)
    if (frameMatch) {
      expect(frameUrl).toBeDefined()
      const ordinal = parseInt(frameMatch[1], 10)
      expect(modelImages[ordinal - 1]).toBe(frameUrl)
    }
  }

  it("char-as-start-frame + extra reference: mention stays Image 1, NO contradictory frame suffix", () => {
    const { finalRefs, finalPrompt, firstFrameUrl, modelImages } = runSeam(
      {
        prompt: "@kira:1:smile dances",
        extraRefs: [{ url: "https://r2/sep-ref.png", description: "a backdrop" }],
      },
      {}, // no upstream start frame — Kira would otherwise be promoted into it
    )

    // Kira is NOT promoted into first_frame_url; she stays a front-of-list ref.
    expect(firstFrameUrl).toBeUndefined()
    expect(finalRefs).toEqual(["https://r2/kira-smile.png", "https://r2/sep-ref.png"])
    // Identity bullets line up with their array positions…
    expect(finalPrompt).toContain("Image 1 (Kira)")
    expect(finalPrompt).toContain("Image 2 (reference): a backdrop")
    // …and because there is no actual frame, NO frame suffix is emitted (so no
    // `Image 2` double-claim that the pre-fix path produced).
    expect(finalPrompt).not.toMatch(/Use Image \d+ as the (opening|closing)/)
    assertConsistent(finalPrompt, modelImages, undefined)
  })

  it("separate upstream start frame + char mention + extra reference: frame appended last, numbering consistent", () => {
    const { finalRefs, finalPrompt, firstFrameUrl, modelImages } = runSeam(
      {
        prompt: "@kira:1:smile dances",
        extraRefs: [{ url: "https://r2/sep-ref.png", description: "a backdrop" }],
      },
      { startFrameUrl: "https://r2/user-start.png" }, // a genuine, distinct start frame
    )

    // The real start frame is MOVED into reference_image_urls (reference mode)
    // and appended after the two references…
    expect(finalRefs).toEqual([
      "https://r2/kira-smile.png",
      "https://r2/sep-ref.png",
      "https://r2/user-start.png",
    ])
    // …reference mode deletes the standalone first_frame_url (frame now rides
    // the array at slot 3)…
    expect(firstFrameUrl).toBeUndefined()
    // …mention bullets at 1 & 2, frame suffix at 3 — every ordinal points at the
    // correct slot, nothing double-numbered.
    expect(finalPrompt).toContain("Image 1 (Kira)")
    expect(finalPrompt).toContain("Image 2 (reference): a backdrop")
    expect(finalPrompt).toContain("Use Image 3 as the opening (first) frame")
    assertConsistent(finalPrompt, modelImages, "https://r2/user-start.png")
  })

  it("lone @-mention, no other refs: still fills the start frame (strict first-frame mode preserved)", () => {
    const { finalRefs, finalPrompt, firstFrameUrl, modelImages } = runSeam(
      { prompt: "@kira:1:smile dances" },
      {},
    )
    // No other references → reference mode is NOT forced, so the mention still
    // legitimately fills first_frame_url (single image, nothing to collide with).
    // The model receives that one image as `Image 1` via first_frame_url, which
    // is exactly what the identity bullet `Image 1 (Kira)` references.
    expect(firstFrameUrl).toBe("https://r2/kira-smile.png")
    expect(finalRefs).toEqual([])
    expect(finalPrompt).toContain("Image 1 (Kira)")
    expect(finalPrompt).not.toMatch(/Use Image \d+ as the (opening|closing)/)
    assertConsistent(finalPrompt, modelImages, undefined)
  })
})

// ---------------------------------------------------------------------------
// SAME combined-case desync, but on the PRIMARY path: the unified
// `generate-video` node. `generate-video` is the only creatable video node and
// the one-way migration target (image-to-video/text-to-video are rewritten to
// it on every editor load), so its mention→frame-slot promotion is what real
// runs hit. The i2v guard above lived only in `case "image-to-video"`; the
// identical unguarded promotion in `case "generate-video"` produced the same
// double-numbered `Image N`. The shared `keepSeedance2MentionsAsRefs` helper
// now guards BOTH cases with identical `otherRefsPresent` semantics.
// ---------------------------------------------------------------------------
describe("Seedance 2 combined case (generate-video) — frame-as-mention numbering stays consistent", () => {
  function node(id: string, type: string, data: Record<string, unknown> = {}): SimpleNode {
    return { id, type, data }
  }
  function edge(source: string, target: string): SimpleEdge {
    return { id: `${source}->${target}`, source, target, sourceHandle: null, targetHandle: null }
  }
  function charNode(id: string): SimpleNode {
    return node(id, "character", {
      label: "Kira",
      characterName: "Kira",
      sourceImageUrl: "https://r2/kira-source.png",
      description: "young woman",
      canonicalDescription: "young woman, brown eyes, auburn hair",
      defaultAssetUrl: "https://r2/kira-portrait.png",
      expressions: [{ name: "smile", url: "https://r2/kira-smile.png" }],
      poses: [], motions: [], angles: [], bodyAngles: [], lightingVariations: [],
    })
  }

  // Identical to runSeam above but builds a `generate-video` node (the PRIMARY
  // path). Pushes the resulting imageUrl/referenceImageUrls through the SAME
  // provider seam the worker uses (first_frame_url + applySeedance2Params).
  function runSeamGV(gvData: Record<string, unknown>, inputs: ResolvedInputs) {
    const character = charNode("char-1")
    const gv = node("gv-1", "generate-video", { provider: "seedance-2", ...gvData })
    const result = buildPayload(
      gv,
      "job-gv",
      inputs,
      undefined,
      { nodes: [character, gv], edges: [edge("char-1", "gv-1")], nodeStates: {} },
    )
    const prompt = result.payload.prompt as string
    const input: Record<string, unknown> = { prompt, first_frame_url: result.payload.imageUrl }
    applySeedance2Params(input, { referenceImageUrls: result.payload.referenceImageUrls } as never)
    const finalRefs = (input.reference_image_urls as string[] | undefined) ?? []
    const firstFrameUrl = input.first_frame_url as string | undefined
    const lastFrameUrl = input.last_frame_url as string | undefined
    const modelImages = finalRefs.length > 0
      ? finalRefs
      : [firstFrameUrl, lastFrameUrl].filter((u): u is string => Boolean(u))
    return { finalRefs, finalPrompt: input.prompt as string, firstFrameUrl, modelImages }
  }

  // Asserts every `Image N` ordinal addresses exactly one image and the frame
  // suffix's ordinal points at the slot truly holding the frame. (Copy of the
  // assertion used by the image-to-video combined case so the contract matches.)
  function assertConsistent(finalPrompt: string, modelImages: string[], frameUrl: string | undefined) {
    const allOrdinals = Array.from(finalPrompt.matchAll(/Image (\d+)/g)).map((m) => parseInt(m[1], 10))
    for (const n of allOrdinals) {
      expect(n).toBeGreaterThanOrEqual(1)
      expect(n).toBeLessThanOrEqual(modelImages.length)
    }
    const frameMatch = finalPrompt.match(/Use Image (\d+) as the (opening|closing)/)
    if (frameMatch) {
      expect(frameUrl).toBeDefined()
      const ordinal = parseInt(frameMatch[1], 10)
      expect(modelImages[ordinal - 1]).toBe(frameUrl)
    }
  }

  it("char-as-start-frame + extra reference: mention stays Image 1, NO contradictory frame suffix", () => {
    const { finalRefs, finalPrompt, firstFrameUrl, modelImages } = runSeamGV(
      {
        prompt: "@kira:1:smile dances",
        extraRefs: [{ url: "https://r2/sep-ref.png", description: "a backdrop" }],
      },
      {}, // no upstream start frame — Kira would otherwise be promoted into it
    )

    // Kira is NOT promoted into first_frame_url; she stays a front-of-list ref.
    expect(firstFrameUrl).toBeUndefined()
    expect(finalRefs).toEqual(["https://r2/kira-smile.png", "https://r2/sep-ref.png"])
    expect(finalPrompt).toContain("Image 1 (Kira)")
    expect(finalPrompt).toContain("Image 2 (reference): a backdrop")
    // No actual frame → NO frame suffix (the pre-fix path double-claimed Image 2).
    expect(finalPrompt).not.toMatch(/Use Image \d+ as the (opening|closing)/)
    assertConsistent(finalPrompt, modelImages, undefined)
  })

  it("lone @-mention, no other refs: still fills the start frame (strict first-frame mode preserved)", () => {
    const { finalRefs, finalPrompt, firstFrameUrl, modelImages } = runSeamGV(
      { prompt: "@kira:1:smile dances" },
      {},
    )
    // No other references → reference mode is NOT forced; the lone mention still
    // legitimately fills first_frame_url (single image, nothing to collide with).
    expect(firstFrameUrl).toBe("https://r2/kira-smile.png")
    expect(finalRefs).toEqual([])
    expect(finalPrompt).toContain("Image 1 (Kira)")
    expect(finalPrompt).not.toMatch(/Use Image \d+ as the (opening|closing)/)
    assertConsistent(finalPrompt, modelImages, undefined)
  })
})

// ---------------------------------------------------------------------------
// #6 — referenceOrder reorder + frame append-after-reorder (payload-builder
// seam). A user drag-reorders the wired reference images; the resolver must
// renumber `Image N` to match the reordered `reference_image_urls`, AND the
// start/end frame must still append AFTER the reordered refs (the resolver
// appends to whatever array it receives). This exercises buildPayload's
// `applyOrderToReferenceUrls` (reorders the `references` edges by the saved
// `connectedRefImageOrder`) → applySeedance2Params (resolver tail-appends the
// frame + emits the `Image N` suffix at the frame's final position).
// ---------------------------------------------------------------------------
describe("Seedance 2 #6 — reference reorder then frame appends after the reordered refs", () => {
  function refNode(id: string): SimpleNode {
    // A generate-image upstream. Its image URL is read from node-state output
    // during the reorder (getNodeImageUrl), mirroring a real run.
    return { id, type: "generate-image", data: { label: id } }
  }
  function edge(source: string, target: string, sourceHandle: string, targetHandle: string): SimpleEdge {
    return { id: `${source}->${target}`, source, target, sourceHandle, targetHandle }
  }

  it("reorder [b,a] + separate start frame → refs come out b,a and the frame is Image 3", () => {
    const a = refNode("a")
    const b = refNode("b")
    const i2v: SimpleNode = {
      id: "i2v-1",
      type: "image-to-video",
      data: {
        provider: "seedance-2",
        // Edge order is a→b; the user dragged it to b→a.
        connectedRefImageOrder: ["b", "a"],
      },
    }
    const result = buildPayload(
      i2v,
      "job-6",
      { startFrameUrl: "https://r2/start.png", referenceImageUrls: ["https://r2/a.png", "https://r2/b.png"] },
      undefined,
      {
        nodes: [a, b, i2v],
        edges: [edge("a", "i2v-1", "image", "references"), edge("b", "i2v-1", "image", "references")],
        nodeStates: {
          a: { status: "completed", output: { imageUrl: "https://r2/a.png" } },
          b: { status: "completed", output: { imageUrl: "https://r2/b.png" } },
        },
      },
    )

    // buildPayload reordered the refs per connectedRefImageOrder (b before a).
    expect(result.payload.referenceImageUrls).toEqual(["https://r2/b.png", "https://r2/a.png"])

    // Push through the provider seam exactly like the worker does.
    const input: Record<string, unknown> = {
      prompt: (result.payload.prompt as string | undefined) ?? "",
      first_frame_url: result.payload.imageUrl,
    }
    applySeedance2Params(input, { referenceImageUrls: result.payload.referenceImageUrls } as never)

    // Reference mode: refs stay in the reordered order, frame appended LAST.
    expect(input.reference_image_urls).toEqual(["https://r2/b.png", "https://r2/a.png", "https://r2/start.png"])
    expect(input.first_frame_url).toBeUndefined()
    // The frame suffix's `Image N` points at the frame's true tail slot (3), so
    // the reorder renumbered the refs (b=1, a=2) and the frame follows at 3.
    expect(input.prompt).toContain("Use Image 3 as the opening (first) frame")
  })
})
