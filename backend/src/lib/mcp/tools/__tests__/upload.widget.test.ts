import { describe, it, expect, vi } from "vitest"
import { newSession } from "../../session.js"
import type { Scope } from "../../../scopes.js"
import { buildServer, callTool, listTools } from "./_helpers.js"

// upload_image_widget doesn't write to R2 / Redis at registration time —
// it just mints a token and returns it. Mocks would only be needed if the
// tool body actually called s3 or supabase.
vi.mock("../../../storage.js", () => ({ s3: { send: vi.fn() } }))
vi.mock("../../../queue.js", () => ({ redis: {} }))

const { registerUploadTools } = await import("../upload.js")

describe("upload_image_widget tool", () => {
  it("registers when assets:write is granted", async () => {
    const server = buildServer()
    registerUploadTools({
      server,
      session: newSession({
        userId: "u1",
        scopes: ["assets:write"] as Scope[],
        clientName: "Claude",
      }),
    })
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).toContain("upload_image_widget")
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
    const tools = await listTools(server)
    expect(tools.map((t) => t.name)).not.toContain("upload_image_widget")
  })

  it("returns upload_url + public_url + widget resourceUri", async () => {
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
    // Token is a one-shot HMAC, baked into the upload_url path.
    expect(sc.upload_url).toMatch(/\/v1\/upload-page\//)
    // Public URL is deterministic — derived from the same key the token
    // commits to. Path includes the user id so we can audit later.
    expect(sc.public_url).toContain("/uploads/handoff/image/user-abc/")
    expect(sc.expires_in_seconds).toBe(3600)
    expect(sc.prompt).toBe("for the headshot app")
  })
})
