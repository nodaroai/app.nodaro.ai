import { describe, it, expect, vi } from "vitest"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool, listTools } from "./_helpers.js"

// upload_<kind>_widget doesn't write to R2 / Redis at registration time —
// it just mints token(s) and returns them. Mocks here just stub the
// modules so import doesn't try to open real connections.
vi.mock("../../../storage.js", () => ({ s3: { send: vi.fn() } }))
vi.mock("../../../queue.js", () => ({ redis: {} }))

const { registerUploadTools } = await import("../upload.js")

describe("upload_<kind>_widget tools", () => {
  const writeSession = () =>
    newSession({
      userId: "u1",
      scopes: ["assets:write"] as Scope[],
      clientName: "Claude",
    })

  it("registers all three kinds when assets:write is granted", async () => {
    const server = buildServer()
    registerUploadTools({ server, session: writeSession() })
    const names = (await listTools(server)).map((t) => t.name)
    expect(names).toContain("upload_image_widget")
    expect(names).toContain("upload_audio_widget")
    expect(names).toContain("upload_video_widget")
  })

  it("does NOT register without assets:write", async () => {
    const server = buildServer()
    registerUploadTools({
      server,
      session: newSession({
        userId: "u1",
        scopes: [] as Scope[],
        clientName: "Claude",
      }),
    })
    const names = (await listTools(server)).map((t) => t.name)
    expect(names).not.toContain("upload_image_widget")
    expect(names).not.toContain("upload_audio_widget")
    expect(names).not.toContain("upload_video_widget")
  })

  it("returns single-slot upload_url + public_url + uploads array (default max_files=1)", async () => {
    const server = buildServer()
    registerUploadTools({
      server,
      session: newSession({
        userId: "user-abc",
        scopes: ["assets:write"] as Scope[],
        clientName: "Claude",
      }),
    })
    const result = await callTool(server, "upload_image_widget", {
      purpose: "for the headshot app",
    })
    expect(result.isError).toBeUndefined()
    const sc = result.structuredContent as Record<string, unknown>
    expect(sc.upload_url).toMatch(/\/v1\/upload-page\//)
    expect(sc.public_url).toContain("/uploads/handoff/image/user-abc/")
    expect(sc.expires_in_seconds).toBe(3600)
    expect(sc.prompt).toBe("for the headshot app")
    // New multi-file shape — single slot still emits a one-element array
    expect(Array.isArray(sc.uploads)).toBe(true)
    expect((sc.uploads as unknown[]).length).toBe(1)
    const slot = (sc.uploads as Array<Record<string, string>>)[0]!
    expect(slot.upload_url).toBe(sc.upload_url)
    expect(slot.public_url).toBe(sc.public_url)
  })

  it("mints N upload slots with distinct tokens + URLs when max_files=N", async () => {
    const server = buildServer()
    registerUploadTools({
      server,
      session: writeSession(),
    })
    const result = await callTool(server, "upload_image_widget", {
      max_files: 4,
    })
    const sc = result.structuredContent as Record<string, unknown>
    const uploads = sc.uploads as Array<Record<string, string>>
    expect(uploads.length).toBe(4)
    // Each slot gets its own deterministic public URL — no collisions.
    const urls = new Set(uploads.map((u) => u.public_url))
    expect(urls.size).toBe(4)
    // The first slot doubles as the singular alias (back-compat).
    expect(sc.upload_url).toBe(uploads[0]!.upload_url)
    expect(sc.public_url).toBe(uploads[0]!.public_url)
  })

  it("clamps max_files to the hard cap (10)", async () => {
    const server = buildServer()
    registerUploadTools({ server, session: writeSession() })
    // Schema rejects > 10 at validation; verify the validator blocks it.
    const result = await callTool(server, "upload_image_widget", {
      max_files: 50,
    })
    expect(result.isError).toBe(true)
  })

  it("audio kind drops the file under uploads/handoff/audio/", async () => {
    const server = buildServer()
    registerUploadTools({ server, session: writeSession() })
    const result = await callTool(server, "upload_audio_widget", {})
    const sc = result.structuredContent as Record<string, unknown>
    expect(sc.public_url).toContain("/uploads/handoff/audio/")
  })

  it("video kind drops the file under uploads/handoff/video/", async () => {
    const server = buildServer()
    registerUploadTools({ server, session: writeSession() })
    const result = await callTool(server, "upload_video_widget", {})
    const sc = result.structuredContent as Record<string, unknown>
    expect(sc.public_url).toContain("/uploads/handoff/video/")
  })

  it("does NOT register the dropped chunked / inline upload tools", async () => {
    const server = buildServer()
    registerUploadTools({ server, session: writeSession() })
    const names = new Set((await listTools(server)).map((t) => t.name))
    // Chunked
    expect(names.has("upload_image_init")).toBe(false)
    expect(names.has("upload_image_chunk")).toBe(false)
    expect(names.has("upload_image_complete")).toBe(false)
    expect(names.has("upload_audio_init")).toBe(false)
    expect(names.has("upload_video_init")).toBe(false)
    // Inline base64 (the bare upload_<kind> name)
    expect(names.has("upload_image")).toBe(false)
    expect(names.has("upload_audio")).toBe(false)
    expect(names.has("upload_video")).toBe(false)
  })
})
