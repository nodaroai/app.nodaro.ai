/**
 * A Video URL node exposed on a published app is a `video` input written to its
 * `youtubeUrl`: MCP `get_app_inputs` / `run_app`, the SDK and the app runner all
 * read this one classifier.
 */
import { describe, it, expect } from "vitest"
import { extractAppInputSchema, flatInputsToOverrides, resolvePrimaryInputField } from "../extract-app-inputs.js"
import { exposedMediaNodeIds } from "../../exposed-text-caps.js"

const nodes = [
  { id: "ep", type: "youtube-video", data: { label: "Episode", youtubeUrl: "https://youtu.be/AAAAAAAAAAA" } },
  { id: "script", type: "text-prompt", data: { label: "Script", text: "hi" } },
]
const settings = { presentationSettings: { inputItems: [{ type: "node", nodeId: "ep" }] } }

describe("a Video URL node exposed as an app input", () => {
  it("is a required `video` input on the `youtubeUrl` field", () => {
    const schema = extractAppInputSchema({ snapshotSettings: settings, snapshotNodes: nodes })
    expect(schema.fields).toHaveLength(1)
    expect(schema.fields[0]).toMatchObject({ key: "episode", label: "Episode", type: "video", required: true })
    expect(schema.keyMap.episode).toEqual({ nodeId: "ep", fieldKey: "youtubeUrl" })
  })

  it("tells a caller what it takes: a post link (downloaded for it) or any other public web link", () => {
    const [field] = extractAppInputSchema({ snapshotSettings: settings, snapshotNodes: nodes }).fields
    expect(field!.description).toMatch(/YouTube/)
    expect(field!.description).toMatch(/public web link/i)
    // Decided 2026-10-08: the server downloads a post link itself — it no longer tells a
    // caller to send a file — and says what happens to a long video.
    expect(field!.description).toMatch(/downloaded/i)
    expect(field!.description).not.toMatch(/pass a direct link to the file/)
    expect(field!.description).toMatch(/4 minutes/)
  })

  it("a flat input lands on youtubeUrl, untouched", () => {
    const schema = extractAppInputSchema({ snapshotSettings: settings, snapshotNodes: nodes })
    expect(flatInputsToOverrides({ episode: "https://youtu.be/BBBBBBBBBBB" }, schema.keyMap)).toEqual({
      ep: { youtubeUrl: "https://youtu.be/BBBBBBBBBBB" },
    })
  })

  it("resolves its primary field for a bare run_workflow override", () => {
    expect(resolvePrimaryInputField("youtube-video", {})).toBe("youtubeUrl")
  })

  it("is a replaced MEDIA node: the listing prices the caller's episode, not the creator's sample", () => {
    expect([...exposedMediaNodeIds(settings, nodes)]).toEqual(["ep"])
  })

  it("is NOT an implicit input of an app with no presentation settings (existing apps do not gain one)", () => {
    const schema = extractAppInputSchema({ snapshotSettings: null, snapshotNodes: nodes })
    expect(schema.fields.map((f) => f.key)).toEqual(["script"])
  })
})
