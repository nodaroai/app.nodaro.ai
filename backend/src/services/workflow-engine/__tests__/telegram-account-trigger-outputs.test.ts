import { describe, it, expect } from "vitest"
import { extractSourceNodeOutput, getPrimaryOutput } from "../output-extractor.js"
import { getNodeOutput, resolveNodeInputs } from "../input-resolver.js"
import { resolveFieldMappings } from "../resolve-field-mappings.js"
import { executeRouter } from "../inline-executor.js"
import type { NodeExecutionState, SimpleEdge, SimpleNode } from "../types.js"

/**
 * The account trigger's named outputs (`videoLink`, `postText`, `postLink`):
 * every reader — a Router's input, a connected List column, a `{Label}` ref
 * and a normal wire — must see the value the wire's handle names. An empty
 * named output is "", never the message text in its place: a Router testing
 * "is there a video link?" on the message text would run the video branch on
 * every plain note.
 */

const TRIGGER: SimpleNode = { id: "trig", type: "telegram-account-trigger", data: { label: "Inbox" } }

const VIDEO_POST = {
  text: "look at this https://www.tiktok.com/@a/video/1",
  chatId: "777",
  messageId: "42",
  chatType: "private",
  videoLink: "https://www.tiktok.com/@a/video/1",
  postText: "",
  postLink: "https://www.tiktok.com/@a/video/1",
}

const TEXT_POST = {
  text: "https://www.linkedin.com/posts/someone-activity-1",
  chatId: "777",
  messageId: "43",
  chatType: "private",
  videoLink: "",
  postText: "Five things nobody tells you about launching",
  postLink: "https://www.linkedin.com/posts/someone-activity-1",
}

function triggerState(triggerData: Record<string, unknown>): Record<string, NodeExecutionState> {
  const output = extractSourceNodeOutput(TRIGGER, triggerData)
  return { trig: { status: "completed", output } as NodeExecutionState }
}

describe("account trigger outputs — extraction", () => {
  it("lists every post field, even an empty one, beside the message facts", () => {
    const output = extractSourceNodeOutput(TRIGGER, VIDEO_POST)
    expect(output?.text).toBe(VIDEO_POST.text)
    expect(output?.paramOutputs).toEqual({
      videoLink: VIDEO_POST.videoLink,
      postText: "",
      postLink: VIDEO_POST.postLink,
      chatId: "777",
      messageId: "42",
      chatType: "private",
    })
  })

  it("a run with no message behind it keeps the raw trigger data as its message, and every post field empty", () => {
    const output = extractSourceNodeOutput(TRIGGER, undefined)
    expect(output?.text).toBe("{}")
    expect(output?.paramOutputs).toEqual({ videoLink: "", postText: "", postLink: "" })
  })
})

describe("account trigger outputs — getPrimaryOutput", () => {
  it("a named handle carries its own value", () => {
    const output = extractSourceNodeOutput(TRIGGER, VIDEO_POST)!
    expect(getPrimaryOutput(output, TRIGGER.type, "videoLink")).toBe(VIDEO_POST.videoLink)
    expect(getPrimaryOutput(output, TRIGGER.type, "postLink")).toBe(VIDEO_POST.postLink)
  })

  it("an EMPTY named handle answers \"\" — never the message text", () => {
    const output = extractSourceNodeOutput(TRIGGER, VIDEO_POST)!
    expect(getPrimaryOutput(output, TRIGGER.type, "postText")).toBe("")
  })

  it("the message handle (and no handle) still answers the message", () => {
    const output = extractSourceNodeOutput(TRIGGER, VIDEO_POST)!
    expect(getPrimaryOutput(output, TRIGGER.type, "out")).toBe(VIDEO_POST.text)
    expect(getPrimaryOutput(output, TRIGGER.type, undefined)).toBe(VIDEO_POST.text)
  })

  it("a message fact is readable by its handle (JSON-authored wires)", () => {
    const output = extractSourceNodeOutput(TRIGGER, VIDEO_POST)!
    expect(getPrimaryOutput(output, TRIGGER.type, "chatId")).toBe("777")
  })

  it("a message fact the run lacks answers \"\" too, never the message", () => {
    const output = extractSourceNodeOutput(TRIGGER, { ...VIDEO_POST, senderId: undefined })!
    expect(getPrimaryOutput(output, TRIGGER.type, "senderId")).toBe("")
  })

  it("an older spelling of the message handle still reads the message", () => {
    const output = extractSourceNodeOutput(TRIGGER, VIDEO_POST)!
    expect(getPrimaryOutput(output, TRIGGER.type, "text")).toBe(VIDEO_POST.text)
  })

  it("a webhook trigger's param handle carries THAT param in every reader, as the editor already did", () => {
    const hook: SimpleNode = {
      id: "hook",
      type: "webhook-trigger",
      data: { params: [{ id: "p_topic", name: "topic", type: "text" }, { id: "p_tone", name: "tone", type: "text" }] },
    }
    const output = extractSourceNodeOutput(hook, { topic: "coffee", tone: "dry" })!
    expect(getPrimaryOutput(output, hook.type, "p_topic")).toBe("coffee")
    expect(getPrimaryOutput(output, hook.type, "p_tone")).toBe("dry")
  })

  it("getNodeOutput — what a connected List column and a {Label} ref read — follows the handle too", () => {
    const states = triggerState(TEXT_POST)
    expect(getNodeOutput(TRIGGER, "postText", states)).toBe(TEXT_POST.postText)
    // Empty → no value at all (a List gets no rows, a ref gets nothing).
    expect(getNodeOutput(TRIGGER, "videoLink", states)).toBe("")
  })
})

describe("account trigger outputs — a Router reads the named handle", () => {
  function route(triggerData: Record<string, unknown>, sourceHandle: string) {
    const router: SimpleNode = {
      id: "router",
      type: "router",
      data: {
        mode: "conditional",
        routes: [{ id: "go", name: "Go", active: false }],
        conditionGroups: [
          { id: "g1", conditionLogic: "AND", routeIds: ["go"], conditions: [{ id: "c1", field: "", operator: "regex", value: "\\S", valueType: "static" }] },
        ],
      },
    }
    const edges: SimpleEdge[] = [{ id: "e1", source: "trig", target: "router", sourceHandle, targetHandle: "in" } as SimpleEdge]
    return executeRouter(router, edges, [TRIGGER, router], triggerState(triggerData))
  }

  it("a text post leaves the video route closed, though the message itself has text", () => {
    const out = route(TEXT_POST, "videoLink")
    expect(out.activeRoutes).toEqual([])
    expect(out.routeOutputs?.go).toBeUndefined()
  })

  it("a video post opens it and passes the LINK through, not the message", () => {
    const out = route(VIDEO_POST, "videoLink")
    expect(out.activeRoutes).toEqual(["go"])
    expect(out.routeOutputs?.go).toBe(VIDEO_POST.videoLink)
  })

  it("the text route mirrors it", () => {
    expect(route(VIDEO_POST, "postText").activeRoutes).toEqual([])
    expect(route(TEXT_POST, "postText").routeOutputs?.go).toBe(TEXT_POST.postText)
  })

  it("the documented condition — is not equal to, value left empty — opens only for a value", () => {
    const documented = (triggerData: Record<string, unknown>, sourceHandle: string) => {
      const router: SimpleNode = {
        id: "router",
        type: "router",
        data: {
          mode: "conditional",
          routes: [{ id: "go", name: "Go", active: false }],
          conditionGroups: [{ id: "g1", conditionLogic: "AND", routeIds: ["go"], conditions: [{ id: "c1", field: "", operator: "!=", value: "", valueType: "static" }] }],
        },
      }
      const edges: SimpleEdge[] = [{ id: "e1", source: "trig", target: "router", sourceHandle, targetHandle: "in" } as SimpleEdge]
      return executeRouter(router, edges, [TRIGGER, router], triggerState(triggerData))
    }
    expect(documented(TEXT_POST, "videoLink").activeRoutes).toEqual([])
    expect(documented(VIDEO_POST, "videoLink").routeOutputs?.go).toBe(VIDEO_POST.videoLink)
    expect(documented(VIDEO_POST, "postText").activeRoutes).toEqual([])
    expect(documented(TEXT_POST, "postText").routeOutputs?.go).toBe(TEXT_POST.postText)
  })
})

describe("account trigger outputs — a normal wire", () => {
  const recipe: SimpleNode = { id: "recipe", type: "content-recipe", data: {} }

  function inputs(triggerData: Record<string, unknown>, sourceHandle: string, targetHandle = "in") {
    const edges: SimpleEdge[] = [{ id: "e", source: "trig", target: "recipe", sourceHandle, targetHandle } as SimpleEdge]
    return resolveNodeInputs(recipe, edges, triggerState(triggerData), [TRIGGER, recipe])
  }

  it("Post text → the post's words, not the bare link the message holds", () => {
    expect(inputs(TEXT_POST, "postText").prompt).toBe(TEXT_POST.postText)
  })

  it("an empty named output routes nothing", () => {
    expect(inputs(VIDEO_POST, "postText").prompt).toBeUndefined()
  })

  it("the message handle routes the message, as before", () => {
    expect(inputs(TEXT_POST, "out").prompt).toBe(TEXT_POST.text)
  })

  it("Post link → Content Recipe's link handle cites the post", () => {
    expect(inputs(TEXT_POST, "postLink", "link").sourceLink).toBe(TEXT_POST.postLink)
  })
})

describe("account trigger outputs — Video link into Video Analysis", () => {
  const va: SimpleNode = { id: "va", type: "video-analysis", data: {} }

  function vaInputs(triggerData: Record<string, unknown>, sourceHandle: string) {
    const edges: SimpleEdge[] = [{ id: "e", source: "trig", target: "va", sourceHandle, targetHandle: "video" } as SimpleEdge]
    return resolveNodeInputs(va, edges, triggerState(triggerData), [TRIGGER, va])
  }

  it("the link reaches the node as the post to fetch — not as a video file, not as a prompt", () => {
    const resolved = vaInputs(VIDEO_POST, "videoLink")
    expect(resolved.videoPageUrl).toBe(VIDEO_POST.videoLink)
    expect(resolved.videoUrl).toBeUndefined()
    expect(resolved.prompt).toBeUndefined()
  })

  it("a text post's empty Video link brings nothing", () => {
    const resolved = vaInputs(TEXT_POST, "videoLink")
    expect(resolved.videoPageUrl).toBeUndefined()
    expect(resolved.videoUrl).toBeUndefined()
  })

  it("words on that wire are not a link (Post text wired in by mistake)", () => {
    const resolved = vaInputs(TEXT_POST, "postText")
    expect(resolved.videoPageUrl).toBeUndefined()
    expect(resolved.prompt).toBeUndefined()
  })

  it("a link with words around it is not a link", () => {
    const resolved = vaInputs({ ...VIDEO_POST, videoLink: `${VIDEO_POST.videoLink} what a clip` }, "videoLink")
    expect(resolved.videoPageUrl).toBeUndefined()
  })

  it("a bot trigger's video message is still the FILE, whichever of its handles is wired", () => {
    const bot: SimpleNode = { id: "bot", type: "telegram-trigger", data: {} }
    const states = { bot: { status: "completed", output: extractSourceNodeOutput(bot, { text: "https://youtu.be/dQw4w9WgXcQ", videoUrl: "https://r2.example.com/tg/v.mp4" }) } as NodeExecutionState }
    for (const sourceHandle of ["text", "videoUrl"]) {
      const edges: SimpleEdge[] = [{ id: "e", source: "bot", target: "va", sourceHandle, targetHandle: "video" } as SimpleEdge]
      const resolved = resolveNodeInputs(va, edges, states, [bot, va])
      expect(resolved.videoUrl, sourceHandle).toBe("https://r2.example.com/tg/v.mp4")
      expect(resolved.videoPageUrl, sourceHandle).toBeUndefined()
    }
  })

  it("a bot trigger's message that is just a link is the post to fetch", () => {
    const bot: SimpleNode = { id: "bot", type: "telegram-trigger", data: {} }
    const states = { bot: { status: "completed", output: extractSourceNodeOutput(bot, { text: "https://youtu.be/dQw4w9WgXcQ" }) } as NodeExecutionState }
    const edges: SimpleEdge[] = [{ id: "e", source: "bot", target: "va", sourceHandle: "text", targetHandle: "video" } as SimpleEdge]
    expect(resolveNodeInputs(va, edges, states, [bot, va]).videoPageUrl).toBe("https://youtu.be/dQw4w9WgXcQ")
  })

  it("a video producer on the same input is still the file to analyze", () => {
    const clip: SimpleNode = { id: "vid", type: "generate-video", data: {} }
    const edges: SimpleEdge[] = [{ id: "e", source: "vid", target: "va", targetHandle: "video" } as SimpleEdge]
    const states = { vid: { status: "completed", output: { videoUrl: "https://cdn.example.com/clip.mp4" } } as NodeExecutionState }
    const resolved = resolveNodeInputs(va, edges, states, [clip, va])
    expect(resolved.videoUrl).toBe("https://cdn.example.com/clip.mp4")
    expect(resolved.videoPageUrl).toBeUndefined()
  })
})

describe("a field pip reads the wire's own output", () => {
  it("from the trigger's Video link — the link, not the message", () => {
    const edges: SimpleEdge[] = [{ id: "e", source: "trig", target: "va", sourceHandle: "videoLink", targetHandle: "field-youtubeUrl" } as SimpleEdge]
    const resolved = resolveFieldMappings({ youtubeUrl: "" }, triggerState(VIDEO_POST), [TRIGGER], undefined, ["youtubeUrl"], "va", edges)
    expect(resolved.youtubeUrl).toBe(VIDEO_POST.videoLink)
  })

  it("from a Router's route — that route's value, not the router's marker", () => {
    const router: SimpleNode = { id: "router", type: "router", data: {} }
    const states: Record<string, NodeExecutionState> = {
      router: { status: "completed", output: { text: "routed", activeRoutes: ["go"], routeOutputs: { go: VIDEO_POST.videoLink } } } as NodeExecutionState,
    }
    const edges: SimpleEdge[] = [{ id: "e", source: "router", target: "va", sourceHandle: "go", targetHandle: "field-youtubeUrl" } as SimpleEdge]
    const resolved = resolveFieldMappings({ youtubeUrl: "" }, states, [router], undefined, ["youtubeUrl"], "va", edges)
    expect(resolved.youtubeUrl).toBe(VIDEO_POST.videoLink)
  })
})
