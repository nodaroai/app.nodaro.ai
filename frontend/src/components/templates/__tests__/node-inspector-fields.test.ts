/**
 * The template canvas is read-only and its nodes are inert, so a prompt that
 * does not fit its node was simply unreadable — a tutorial that hides its own
 * prompts (2026-09-15). A click on a node now opens an inspector with
 * every long text field in full. These are the pure parts: which fields a node
 * exposes, in which order, and which node sits under a click.
 */
import { describe, expect, it } from "vitest"
import { getParameterPromptHint } from "@nodaro/prompts"
import { derivedPlumbingData, inspectorFields, inspectorSettings, nodeAtPoint, wiredInputFields } from "../node-inspector-fields"

describe("inspectorFields", () => {
  it("lists an image node's prompt first, then the negative prompt, and skips empty fields", () => {
    const fields = inspectorFields({
      id: "shot-1",
      type: "generate-image",
      data: { label: "Shot 1", prompt: "A {Shoot concept || studio} portrait.", negativePrompt: "", style: "" },
    })
    expect(fields).toEqual([{ key: "prompt", label: "Prompt", value: "A {Shoot concept || studio} portrait." }])
  })

  it("shows a text node's system and user prompts and its generated result", () => {
    const fields = inspectorFields({
      id: "concept",
      type: "llm-chat",
      data: { label: "Shoot concept", systemPrompt: "You are an art director.", userInput: "Write it.", generatedText: "The model wears pink." },
    })
    expect(fields.map((f) => f.key)).toEqual(["systemPrompt", "userInput", "generatedText"])
    expect(fields[2]).toEqual({ key: "generatedText", label: "Result", value: "The model wears pink." })
  })

  it("shows a sticky note's body and a text-prompt node's text", () => {
    expect(inspectorFields({ id: "n", type: "sticky-note", data: { title: "Step 1", text: "One clean photo." } })).toEqual([
      { key: "text", label: "Note", value: "One clean photo." },
    ])
    expect(inspectorFields({ id: "t", type: "text-prompt", data: { label: "Styling notes", text: "Worn closed." } })).toEqual([
      { key: "text", label: "Text", value: "Worn closed." },
    ])
  })

  it("shows a Web Scrape's search query and its structured result as pretty JSON", () => {
    const results = [{ title: "Dyson V15 Detect", description: "A piezo sensor counts dust particles" }]
    const fields = inspectorFields({
      id: "research",
      type: "web-scrape",
      data: { label: "Research", actor: "google-search", query: "Dyson V15 Detect features", maxResults: 6, generatedJson: results, lastRunOutcome: "success" },
    })
    expect(fields.map((f) => f.key)).toEqual(["query", "generatedJson"])
    expect(fields[0]).toEqual({ key: "query", label: "Search query", value: "Dyson V15 Detect features" })
    expect(fields[1].label).toBe("Result")
    expect(JSON.parse(fields[1].value)).toEqual(results)
    expect(fields[1].value).toContain("\n") // pretty-printed, not one line
  })

  it("shows a content crawl's address as an input, but never a media node's result url", () => {
    expect(inspectorFields({ id: "c", type: "web-scrape", data: { actor: "content-crawler", url: "https://example.com/page", mode: "page" } })).toEqual([
      { key: "url", label: "Address", value: "https://example.com/page" },
    ])
    expect(inspectorFields({ id: "u", type: "upload-image", data: { url: "https://cdn/x.png", assetId: "a" } })).toEqual([])
  })

  it("never exposes a result URL, a job id or a non-string as a field", () => {
    const fields = inspectorFields({
      id: "x",
      type: "generate-image",
      data: { prompt: "p", generatedImageUrl: "https://cdn/x.png", kieTaskId: "abc", generatedResults: [{ url: "u" }], activeResultIndex: 0 },
    })
    expect(fields.map((f) => f.key)).toEqual(["prompt"])
  })
})

/**
 * An image or video node whose prompt arrives on a wire stores no prompt of its
 * own, so the inspector used to answer "no text" on exactly the node a reader
 * clicks first (2026-09-24, Impossible Materials). The text it received is read
 * from the node on the other end of the wire, as that node's last run left it.
 */
describe("wiredInputFields", () => {
  const image = { id: "mat_1", type: "generate-image", data: { label: "Material 1", prompt: "", provider: "gpt-image-2" } }
  const selector = {
    id: "pick_m1",
    type: "selector",
    data: { label: "Material 1 prompt", generatedText: "A sneaker made of ice.", pickedResults: ["A sneaker made of ice."] },
  }
  const edge = (source: string, target: string, targetHandle: string, sourceHandle = "out") => ({ id: `${source}-${target}-${targetHandle}`, source, target, sourceHandle, targetHandle })

  it("shows the prompt a media node received from the node wired into it, named by that node", () => {
    const fields = wiredInputFields(image, [image, selector], [edge("pick_m1", "mat_1", "prompt", "picked")])
    expect(fields).toEqual([
      { key: "wired:pick_m1-mat_1-prompt", label: "Prompt", source: "Material 1 prompt", value: "A sneaker made of ice." },
    ])
  })

  it("reads each kind of text source the way its last run left it", () => {
    const text = { id: "t", type: "text-prompt", data: { label: "Direction", text: "Make it out of chocolate." } }
    const llm = { id: "l", type: "llm-chat", data: { label: "Material Director", generatedText: "Six prompts." } }
    const combine = { id: "c", type: "combine-text", data: { label: "Joined", combinedText: "A + B" } }
    const video = { id: "v", type: "generate-video", data: { label: "Morph 1", prompt: "" } }
    const fields = wiredInputFields(video, [video, text, llm, combine], [
      edge("t", "v", "prompt"),
      edge("l", "v", "prompt"),
      edge("c", "v", "negative"),
    ])
    expect(fields.map((f) => [f.label, f.source, f.value])).toEqual([
      ["Prompt", "Direction", "Make it out of chocolate."],
      ["Prompt", "Material Director", "Six prompts."],
      ["Negative prompt", "Joined", "A + B"],
    ])
  })

  it("numbers the parts when a Split Text or a multi-pick selector feeds the node", () => {
    const split = { id: "s", type: "split-text", data: { label: "Split Materials", generatedText: "Ice.", splitResults: ["Ice.", "Glass."] } }
    const multi = { id: "m", type: "selector", data: { label: "Pick two", generatedText: "Moss.", pickedResults: ["Moss.", "Lava."] } }
    const target = { id: "x", type: "llm-chat", data: { label: "Writer" } }
    const fields = wiredInputFields(target, [target, split, multi], [edge("s", "x", "prompt"), edge("m", "x", "system-prompt")])
    expect(fields.map((f) => [f.label, f.value])).toEqual([
      ["Prompt", "1. Ice.\n\n2. Glass."],
      ["System prompt", "1. Moss.\n\n2. Lava."],
    ])
  })

  it("shows a Web Scrape's structured result as pretty JSON when it feeds a prompt", () => {
    const scrape = { id: "w", type: "web-scrape", data: { label: "Site data", generatedJson: [{ title: "Home" }] } }
    const target = { id: "x", type: "llm-chat", data: { label: "Brand Extraction" } }
    const [field] = wiredInputFields(target, [target, scrape], [edge("w", "x", "prompt", "json")])
    expect(field.source).toBe("Site data")
    expect(JSON.parse(field.value)).toEqual([{ title: "Home" }])
  })

  it("ignores media wires, sources that have produced no text yet, and wires into other nodes", () => {
    const upload = { id: "u", type: "upload-image", data: { label: "Product", url: "https://cdn/p.png" } }
    const empty = { id: "e", type: "text-prompt", data: { label: "Direction", text: "   " } }
    const idle = { id: "i", type: "llm-chat", data: { label: "Not run yet" } }
    const fields = wiredInputFields(image, [image, upload, empty, idle, selector], [
      edge("u", "mat_1", "references", "image"),
      edge("e", "mat_1", "prompt"),
      edge("i", "mat_1", "prompt"),
      edge("pick_m1", "someone_else", "prompt", "picked"),
    ])
    expect(fields).toEqual([])
  })

  // A template published from a run that never saved its plumbing (FOOH
  // Campaign Generator, 2026-09-24): the LLM kept its text, the Split and the
  // selectors kept nothing. Both are pure, so the pick is re-derived with the
  // same shared functions the run uses.
  it("re-derives a selector's pick through an unsaved Split from the LLM text the run left", () => {
    const llm = { id: "n12", type: "llm-chat", data: { label: "Prompt Normalizer", generatedText: "Billboard.\n===NEXT===\nTram wrap.\n===NEXT===\nBus shelter." } }
    const split = { id: "sp", type: "split-text", data: { label: "Split Image Prompts", separator: "custom", customSeparator: "===NEXT===", trimWhitespace: true, removeEmpty: true } }
    const pick = { id: "p2", type: "selector", data: { label: "EXECUTION 2", config: { mode: "item", itemIndex: "2" } } }
    const target = { id: "img2", type: "generate-image", data: { label: "FOOH IMAGE 2", prompt: "" } }
    const fields = wiredInputFields(target, [llm, split, pick, target], [
      edge("n12", "sp", "text", "text"),
      edge("sp", "p2", "in", "out"),
      edge("p2", "img2", "prompt", "picked"),
    ])
    expect(fields).toEqual([{ key: "wired:p2-img2-prompt", label: "Prompt", source: "EXECUTION 2", value: "Tram wrap." }])
  })

  // The run fills exactly four selector fields from `{Label}` refs
  // (resolveSelectorRefs); every other field is a literal to it.
  it("does not guess a pick filled in at run time, and reads a literal field as the run does", () => {
    const llm = { id: "l", type: "llm-chat", data: { label: "Writer", generatedText: "A===NEXT===B" } }
    const split = { id: "s", type: "split-text", data: { label: "Split", separator: "custom", customSeparator: "===NEXT===" } }
    const target = { id: "x", type: "generate-image", data: { label: "Image" } }
    const read = (config: Record<string, unknown>) => {
      const pick = { id: "p", type: "selector", data: { label: "Pick", config } }
      return wiredInputFields(target, [llm, split, pick, target], [edge("l", "s", "text"), edge("s", "p", "in"), edge("p", "x", "prompt", "picked")])
    }
    expect(read({ mode: "modulo", moduloDivisor: "{Row}" })).toEqual([])
    expect(read({ mode: "named-key", namedKeyField: "name", namedKeyValue: "{{trigger.name}}" })).toEqual([])
    // `itemIndex` is not one of them: "{Row}" is unreadable to resolveIndex, which falls back to item 1.
    expect(read({ mode: "item", itemIndex: "{Row}" }).map((f) => f.value)).toEqual(["A"])
  })

  it("shows the prompts a node ran on when a List fanned them out to it", () => {
    const list = { id: "list", type: "list", data: { label: "List" } }
    const img = { id: "img", type: "generate-image", data: { label: "Post image", prompt: "", __listInputs: ["Quote one.", "Quote two."] } }
    const fields = wiredInputFields(img, [list, img], [edge("list", "img", "in", "col_default")])
    expect(fields).toEqual([{ key: "wired:list-inputs", label: "Prompt", source: "List", value: "1. Quote one.\n\n2. Quote two." }])
  })

  it("never shows list inputs that are media addresses, nor repeats a prompt already shown from its wire", () => {
    const urls = { id: "u", type: "image-to-video", data: { label: "Animate", __listInputs: ["https://cdn/a.png", "https://cdn/b.png"] } }
    expect(wiredInputFields(urls, [urls], [])).toEqual([])
    const withWire = { ...image, data: { ...image.data, __listInputs: ["A sneaker made of ice."] } }
    const fields = wiredInputFields(withWire, [withWire, selector], [edge("pick_m1", "mat_1", "prompt", "picked")])
    expect(fields.map((f) => f.key)).toEqual(["wired:pick_m1-mat_1-prompt"])
  })

  it("falls back to the source's id when it has no label, and skips a wire to a missing node", () => {
    const unnamed = { id: "n1", type: "llm-chat", data: { generatedText: "Hello." } }
    const fields = wiredInputFields(image, [image, unnamed], [edge("n1", "mat_1", "prompt"), edge("ghost", "mat_1", "prompt")])
    expect(fields).toEqual([{ key: "wired:n1-mat_1-prompt", label: "Prompt", source: "n1", value: "Hello." }])
  })

  // What a wire carries depends on the handle it leaves and on the wire's own
  // item setting — read the way node-input-resolver reads them (review
  // 2026-09-24: the first version read every wire as the source's picks).
  describe("reads the wire, not just the node it leaves", () => {
    const target = { id: "x", type: "generate-image", data: { label: "Image", prompt: "" } }
    const values = (fields: ReturnType<typeof wiredInputFields>) => fields.map((f) => f.value)

    it("reads a selector's rest channel from its rest handle", () => {
      const pick = { id: "p", type: "selector", data: { label: "Pick", pickedResults: ["Ice."], restResults: ["Glass.", "Moss."] } }
      expect(values(wiredInputFields(target, [pick, target], [edge("p", "x", "prompt", "rest")]))).toEqual(["1. Glass.\n\n2. Moss."])
    })

    it("cuts Generate Text on ===NEXT=== only on its items handle", () => {
      const llm = { id: "l", type: "llm-chat", data: { label: "Writer", generatedText: "Ice.\n===NEXT===\nGlass." } }
      expect(values(wiredInputFields(target, [llm, target], [edge("l", "x", "prompt", "items")]))).toEqual(["1. Ice.\n\n2. Glass."])
      expect(values(wiredInputFields(target, [llm, target], [edge("l", "x", "prompt", "text")]))).toEqual(["Ice.\n===NEXT===\nGlass."])
    })

    it("delivers one item for item / item:N / last, all of them joined for all, and a range for each", () => {
      const split = { id: "s", type: "split-text", data: { label: "Split", splitResults: ["A", "B", "C"] } }
      const llm = { id: "l", type: "llm-chat", data: { label: "Writer", generatedText: "D===NEXT===E===NEXT===F" } }
      const wire = (source: string, sourceHandle: string, data: Record<string, unknown>) => ({ ...edge(source, "x", "prompt", sourceHandle), data })
      const read = (source: string, sourceHandle: string, data: Record<string, unknown>) =>
        values(wiredInputFields(target, [split, llm, target], [wire(source, sourceHandle, data)]))
      expect(read("s", "out", { outputMode: "item", itemIndex: "2" })).toEqual(["B"])
      expect(read("s", "out", { outputMode: "item:2" })).toEqual(["C"])
      expect(read("s", "out", { outputMode: "all" })).toEqual(["A, B, C"])
      expect(read("s", "out", { outputMode: "each", selectorMode: "range", rangeFrom: "2", rangeTo: "3" })).toEqual(["1. B\n\n2. C"])
      // "last" is "Selected": the first item of a plumbing node, the final one of a Generate Text list.
      expect(read("s", "out", { outputMode: "last" })).toEqual(["A"])
      expect(read("l", "items", { outputMode: "last" })).toEqual(["F"])
    })

    it("re-derives a seeded random pick, and shows nothing for an unseeded one", () => {
      const split = { id: "s", type: "split-text", data: { label: "Split", splitResults: ["A", "B", "C", "D"] } }
      const pick = (config: Record<string, unknown>) => ({ id: "p", type: "selector", data: { label: "Pick", config } })
      const read = (config: Record<string, unknown>) =>
        values(wiredInputFields(target, [split, pick(config), target], [edge("s", "p", "in"), edge("p", "x", "prompt", "picked")]))
      expect(read({ mode: "random", randomCount: 1 })).toEqual([])
      const seeded = read({ mode: "random", randomCount: 1, seed: "42" })
      expect(seeded).toHaveLength(1)
      expect(["A", "B", "C", "D"]).toContain(seeded[0])
      expect(read({ mode: "random", randomCount: 1, seed: "42" })).toEqual(seeded)
      expect(read({ mode: "random", randomCount: 1, seed: "{Row}" })).toEqual([])
    })

    it("keeps a variables wire out of a selector's items", () => {
      const split = { id: "s", type: "split-text", data: { label: "Split", splitResults: ["A", "B"] } }
      const row = { id: "r", type: "text-prompt", data: { label: "Row", text: "Z" } }
      const pick = { id: "p", type: "selector", data: { label: "Pick", config: { mode: "item", itemIndex: "last" } } }
      const fields = wiredInputFields(target, [split, row, pick, target], [
        edge("s", "p", "in"),
        edge("r", "p", "variables"),
        edge("p", "x", "prompt", "picked"),
      ])
      expect(values(fields)).toEqual(["B"])
    })

    it("splits the FIRST output of each source joined, as the run's Split Text does", () => {
      const a = { id: "a", type: "selector", data: { label: "A", pickedResults: ["one", "two"] } }
      const b = { id: "b", type: "selector", data: { label: "B", pickedResults: ["three", "four"] } }
      const split = { id: "s", type: "split-text", data: { label: "Split", separator: "custom", customSeparator: "|" } }
      const fields = wiredInputFields(target, [a, b, split, target], [
        edge("a", "s", "text", "picked"),
        edge("b", "s", "text", "picked"),
        edge("s", "x", "prompt"),
      ])
      expect(values(fields)).toEqual(["onethree"])
    })

    it("shows a picker's fragment only where the node names it with {Label}", () => {
      const lighting = { id: "lt", type: "lighting", data: { label: "Lighting", lightingStyle: "on-camera-flash" } }
      const hint = getParameterPromptHint({ id: lighting.id, type: lighting.type, data: { ...lighting.data } }).trim()
      expect(hint.length).toBeGreaterThan(0)
      const named = { ...target, data: { ...target.data, prompt: "A sneaker, {Lighting}." } }
      expect(wiredInputFields(named, [lighting, named], [edge("lt", "x", "prompt")])).toEqual([
        { key: "wired:lt-x-prompt", label: "Prompt", source: "Lighting", value: hint },
      ])
      // Not named: the run skips a picker on a text wire, so it contributed nothing.
      expect(wiredInputFields(target, [lighting, target], [edge("lt", "x", "prompt")])).toEqual([])
    })

    it("keys every wire apart, even two from the same source", () => {
      const pick = { id: "p", type: "selector", data: { label: "Pick", pickedResults: ["Ice."], restResults: ["Glass."] } }
      const fields = wiredInputFields(target, [pick, target], [
        { source: "p", target: "x", sourceHandle: "picked", targetHandle: "prompt" },
        { source: "p", target: "x", sourceHandle: "rest", targetHandle: "prompt" },
      ])
      expect(fields.map((f) => [f.key, f.value])).toEqual([
        ["wired:p:picked:prompt", "Ice."],
        ["wired:p:rest:prompt", "Glass."],
      ])
    })
  })
})

// Second review (2026-09-24): text a node never received was still shown.
describe("wiredInputFields follows what reaches the node", () => {
  const e = (source: string, target: string, targetHandle: string, sourceHandle = "out", data?: Record<string, unknown>) => ({
    id: `${source}-${target}-${targetHandle}`, source, target, sourceHandle, targetHandle, data,
  })
  const writer = { id: "w", type: "llm-chat", data: { label: "Writer", generatedText: "A red sneaker." } }

  it("hides a Prompt / Negative wire whose Inject switch is off, unless the node names it", () => {
    const off = { id: "x", type: "generate-image", data: { label: "Image", prompt: "", injectPrompt: false, injectNegative: false } }
    expect(wiredInputFields(off, [writer, off], [e("w", "x", "prompt"), e("w", "x", "negative")])).toEqual([])
    const named = { ...off, data: { ...off.data, prompt: "Studio shot of {Writer}" } }
    expect(wiredInputFields(named, [writer, named], [e("w", "x", "prompt")]).map((f) => f.value)).toEqual(["A red sneaker."])
    // Only image and video nodes have the Negative switch.
    const llm = { id: "y", type: "llm-chat", data: { label: "Other", injectNegative: false } }
    expect(wiredInputFields(llm, [writer, llm], [e("w", "y", "negative")]).map((f) => f.value)).toEqual(["A red sneaker."])
  })

  it("never shows Repeat / multi-model markers as prompts, and names the list that fanned the node out", () => {
    const upload = { id: "u", type: "upload-image", data: { label: "Reference", url: "https://cdn/r.png" } }
    const repeated = { id: "r", type: "generate-image", data: { label: "Image", __listInputs: ["__repeat__", "__repeat__", "__provider:flux__"] } }
    expect(wiredInputFields(repeated, [upload, repeated], [e("u", "r", "references", "image")])).toEqual([])
    const list = { id: "l", type: "list", data: { label: "Quotes" } }
    const fanned = { id: "f", type: "generate-image", data: { label: "Post", __listInputs: ["One.", "Two."] } }
    const [field] = wiredInputFields(fanned, [upload, list, fanned], [e("u", "f", "references", "image"), e("l", "f", "in", "col_default")])
    expect(field.source).toBe("Quotes")
  })

  it("derives from a structured result as the run passes it: compact, one item per array element", () => {
    const posts = [{ title: "First" }, { title: "Second", body: "a\nb" }]
    const scrape = { id: "s", type: "web-scrape", data: { label: "Posts", generatedJson: posts } }
    const pick = { id: "p", type: "selector", data: { label: "Pick", config: { mode: "item", itemIndex: "2" } } }
    const target = { id: "x", type: "llm-chat", data: { label: "Writer" } }
    const edges = [e("s", "p", "in", "json"), e("p", "x", "prompt", "picked")]
    const [field] = wiredInputFields(target, [scrape, pick, target], edges)
    expect(JSON.parse(field.value)).toEqual(posts[1])
    expect(derivedPlumbingData([scrape, pick, target], edges).get("p")).toEqual({
      pickedResults: [JSON.stringify(posts[1])],
      restResults: [JSON.stringify(posts[0])],
    })
    // Split on newlines reads the compact JSON — one line, one part.
    const split = { id: "t", type: "split-text", data: { label: "Lines", separator: "newline" } }
    expect(derivedPlumbingData([scrape, split], [e("s", "t", "text", "json")]).get("t")).toEqual({ splitResults: [JSON.stringify(posts)] })
  })

  it("splits Generate Text's whole result even when it is wired from the items handle", () => {
    const llm = { id: "l", type: "llm-chat", data: { label: "Writer", generatedText: "A\nB===NEXT===C\nD" } }
    const split = { id: "t", type: "split-text", data: { label: "Lines", separator: "newline" } }
    expect(derivedPlumbingData([llm, split], [e("l", "t", "text", "items")]).get("t")).toEqual({ splitResults: ["A", "B===NEXT===C", "D"] })
  })

  it("delivers Generate Text's whole result for an 'all' wire from its items handle", () => {
    const llm = { id: "l", type: "llm-chat", data: { label: "Writer", generatedText: "Ice.\n===NEXT===\nGlass." } }
    const target = { id: "x", type: "generate-image", data: { label: "Image", prompt: "" } }
    const fields = wiredInputFields(target, [llm, target], [e("l", "x", "prompt", "items", { outputMode: "all" })])
    expect(fields.map((f) => f.value)).toEqual(["Ice.\n===NEXT===\nGlass."])
  })

  it("does not guess a selector fed by Generate Text's items, which the two engines read differently", () => {
    const llm = { id: "l", type: "llm-chat", data: { label: "Writer", generatedText: "A===NEXT===B" } }
    const pick = { id: "p", type: "selector", data: { label: "Pick", config: { mode: "item", itemIndex: "2" } } }
    expect(derivedPlumbingData([llm, pick], [e("l", "p", "in", "items")]).has("p")).toBe(false)
  })

  it("composes a picker's hint with the graph, as both engines do", () => {
    const framing = { id: "fr", type: "framing", data: { label: "Framing", shotSize: "close-up" } }
    const motion = { id: "cm", type: "camera-motion", data: { label: "Camera Motion", cameraMotion: "dolly-in" } }
    const video = { id: "v", type: "generate-video", data: { label: "Clip", prompt: "A sneaker, {Camera Motion}." } }
    const nodes = [framing, motion, video]
    const edges = [e("fr", "cm", "startState"), e("cm", "v", "prompt")]
    const withGraph = getParameterPromptHint(motion, { nodes, edges }).trim()
    expect(withGraph).not.toBe(getParameterPromptHint(motion).trim())
    expect(wiredInputFields(video, nodes, edges).map((f) => f.value)).toEqual([withGraph])
  })
})

// On the canvas a Split or a selector whose run saved nothing rendered as an
// empty box, even where the inspector could say what it held (2026-09-24).
describe("derivedPlumbingData", () => {
  const llm = { id: "n12", type: "llm-chat", data: { label: "Normalizer", generatedText: "Billboard.\n===NEXT===\nTram wrap." } }
  const split = { id: "sp", type: "split-text", data: { label: "Split", separator: "custom", customSeparator: "===NEXT===" } }
  const pick = { id: "p2", type: "selector", data: { label: "EXECUTION 2", config: { mode: "item", itemIndex: "2" } } }
  const edges = [
    { source: "n12", target: "sp", sourceHandle: "text", targetHandle: "text" },
    { source: "sp", target: "p2", sourceHandle: "text", targetHandle: "in" },
  ]

  it("fills the parts and the pick an unsaved run made, and only those", () => {
    const patches = derivedPlumbingData([llm, split, pick], edges)
    expect(patches.get("sp")).toEqual({ splitResults: ["Billboard.", "Tram wrap."] })
    expect(patches.get("p2")).toEqual({ pickedResults: ["Tram wrap."], restResults: ["Billboard."] })
    expect(patches.has("n12")).toBe(false)
  })

  it("leaves a node that saved its own output alone, and one it cannot derive", () => {
    const saved = { ...pick, data: { ...pick.data, pickedResults: ["Saved."] } }
    const unseeded = { id: "r", type: "selector", data: { label: "Random", config: { mode: "random" } } }
    const patches = derivedPlumbingData([llm, split, saved, unseeded], [...edges, { source: "sp", target: "r", sourceHandle: "text", targetHandle: "in" }])
    expect(patches.has("p2")).toBe(false)
    expect(patches.has("r")).toBe(false)
  })
})

describe("inspectorSettings", () => {
  it("collects the short model settings a viewer would want to copy", () => {
    const settings = inspectorSettings({
      id: "s",
      type: "generate-image",
      data: { provider: "gpt-image-2", resolution: "1K", aspectRatio: "3:4", prompt: "long text", fieldMappings: {}, presentationOutput: true },
    })
    expect(settings).toEqual([
      { label: "Model", value: "gpt-image-2" },
      { label: "Resolution", value: "1K" },
      { label: "Aspect ratio", value: "3:4" },
    ])
  })

  it("names a picker's chosen tiles", () => {
    const settings = inspectorSettings({
      id: "l",
      type: "lighting",
      data: { label: "Lighting", hintMode: "compact", lightingStyle: "on-camera-flash", lightingDirection: "front", presentationInput: true },
    })
    expect(settings).toEqual([
      { label: "lightingStyle", value: "on-camera-flash" },
      { label: "lightingDirection", value: "front" },
    ])
  })
})

describe("nodeAtPoint", () => {
  const rects = [
    { id: "group", x: 0, y: 0, width: 1000, height: 1000 },
    { id: "a", x: 100, y: 100, width: 200, height: 100 },
    { id: "b", x: 250, y: 150, width: 200, height: 100 },
  ]

  it("returns the topmost (last-drawn) node under the point", () => {
    expect(nodeAtPoint(rects, { x: 260, y: 160 })).toBe("b")
    expect(nodeAtPoint(rects, { x: 120, y: 120 })).toBe("a")
  })

  it("falls back to the enclosing group and to null outside everything", () => {
    expect(nodeAtPoint(rects, { x: 900, y: 900 })).toBe("group")
    expect(nodeAtPoint(rects, { x: 2000, y: 5 })).toBeNull()
  })

  it("skips nodes that have no size yet", () => {
    expect(nodeAtPoint([{ id: "unmeasured", x: 0, y: 0, width: 0, height: 0 }], { x: 0, y: 0 })).toBeNull()
  })
})
