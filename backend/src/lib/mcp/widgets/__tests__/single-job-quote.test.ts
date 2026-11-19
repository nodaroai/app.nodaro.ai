import { describe, it, expect } from "vitest"
import { JSDOM } from "jsdom"
import { buildSingleJobWidget } from "../single-job.js"

/**
 * The job card's price-quote state. `modify_video` with a Video Remake engine answers a quote and
 * starts no job; the card then shows the price sentence and the next step, and follows nothing. A
 * job's answer is handled as it always was.
 *
 * The widget's own inline script runs here in a DOM, and the host's `tool-result` notification is
 * delivered as the event the script listens for.
 */
function card() {
  const dom = new JSDOM(buildSingleJobWidget("video"), { runScripts: "dangerously" })
  const { window } = dom
  const posted: Array<{ method?: string; params?: { name?: string; arguments?: unknown } }> = []
  // What the card asks of its host (a poll is a `tools/call` of `get_asset`).
  window.parent.postMessage = ((msg: unknown) => void posted.push(msg as never)) as never
  const result = (detail: unknown) => window.dispatchEvent(new window.CustomEvent("mcp-tool-result", { detail }))
  const el = (id: string) => window.document.getElementById(id)!
  return { window, result, el, polls: () => posted.filter((m) => m.method === "tools/call" && m.params?.name === "get_asset") }
}

const QUOTE = {
  quote: { engine: "nodaro-prism", engineName: "Nodaro Prism", totalCredits: 12, expectedCredits: 9, confirmed: false },
  arguments: { video_url: "https://cdn.example/clip.mp4", roles: [], post_prompt: "night", engine: "nodaro-prism" },
  summary: "This Nodaro Prism run costs about 9 credits (up to 12 held while it runs).",
}

describe("job card — a price quote", () => {
  it("shows the price sentence and the next step, not \"No result returned.\"", () => {
    const { result, el } = card()
    result({ content: [{ type: "text", text: "…" }], structuredContent: { videoRemake: QUOTE } })

    expect(el("quote-price").textContent).toBe(QUOTE.summary)
    expect(el("quote-next").textContent).toBe("Nothing has run yet. Accept the price in the chat to run it with Video Remake.")
    expect(el("status").textContent).not.toContain("No result returned")
    expect(el("status").style.display).not.toBe("none")
    expect(el("progress").hidden).toBe(true)
    expect(el("preview").hidden).toBe(true)
  })

  it("follows no job: nothing is polled", () => {
    const { result, polls, window } = card()
    result({ structuredContent: { videoRemake: QUOTE } })
    expect(polls()).toEqual([])
    window.close()
  })

  it("a quote with no sentence still says it is a quote", () => {
    const { result, el } = card()
    result({ structuredContent: { videoRemake: { quote: QUOTE.quote, arguments: QUOTE.arguments } } })
    expect(el("quote-price").textContent).toBe("Price quote")
  })
})

describe("job card — a job's answer is unchanged", () => {
  it("a started job reads Generating… and is followed", () => {
    const { result, el, window } = card()
    result({ structuredContent: { jobId: "j-1", model: "seedance-2-5" } })
    expect(el("status").textContent).toBe("Generating…")
    expect(window.document.getElementById("quote-price")).toBeNull()
    window.close()
  })

  it("a finished job shows its video", () => {
    const { result, el, window } = card()
    result({ structuredContent: { jobId: "j-1", outputUrl: "https://cdn.example/out.mp4" } })
    expect(el("preview").hidden).toBe(false)
    expect(el("preview").querySelector("video")?.getAttribute("src")).toBe("https://cdn.example/out.mp4")
    expect(el("status").style.display).toBe("none")
    window.close()
  })

  it("a refused call and an empty answer read as before", () => {
    const refused = card()
    refused.result({ isError: true, content: [{ type: "text", text: "refused" }] })
    expect(refused.el("status").textContent).toBe("Generation failed — see the message above.")
    const empty = card()
    empty.result({ structuredContent: {} })
    expect(empty.el("status").textContent).toBe("No result returned.")
  })
})
