import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import { mkdtempSync, rmSync, statSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buildClient } from "../client.js"
import { getProfile, setProfile } from "../config.js"
import { resolveWorkspace, saveWorkspace, setWorkspaceFlag } from "../workspace.js"

const WS = "20000000-0000-4000-8000-000000000001"
const WS2 = "20000000-0000-4000-8000-000000000002"
const WS3 = "20000000-0000-4000-8000-000000000003"

describe("which workspace the CLI acts in", () => {
  let dir: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "nodaro-ws-test-"))
    vi.stubEnv("NODARO_CONFIG_DIR", dir)
    vi.stubEnv("NODARO_WORKSPACE", "")
    setWorkspaceFlag(undefined)
    setProfile("production", { baseUrl: "https://api.example.com", token: "ndr_x" })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    setWorkspaceFlag(undefined)
    rmSync(dir, { recursive: true, force: true })
  })

  const profile = () => getProfile().profile

  it("is the personal space when nothing says otherwise", () => {
    expect(resolveWorkspace(profile())).toEqual({ workspaceId: undefined, source: "none" })
  })

  it("reads the profile's saved workspace", () => {
    saveWorkspace(undefined, WS)
    expect(resolveWorkspace(profile())).toEqual({ workspaceId: WS, source: "profile" })
  })

  /**
   * The order is the point: a CI job sets the variable once and every command
   * inherits it, a person overrides one command without disturbing what they
   * saved, and neither has to remember to undo anything.
   */
  it("lets the environment beat the profile, and the flag beat both", () => {
    saveWorkspace(undefined, WS)
    vi.stubEnv("NODARO_WORKSPACE", WS2)
    expect(resolveWorkspace(profile())).toEqual({ workspaceId: WS2, source: "env" })

    setWorkspaceFlag(WS3)
    expect(resolveWorkspace(profile())).toEqual({ workspaceId: WS3, source: "flag" })
  })

  it("treats a blank flag or variable as unset, not as a selection", () => {
    // An empty string is not a choice. Reading it as one would send an empty
    // header, which is a different thing from sending none.
    saveWorkspace(undefined, WS)
    setWorkspaceFlag("   ")
    vi.stubEnv("NODARO_WORKSPACE", "  ")
    expect(resolveWorkspace(profile())).toEqual({ workspaceId: WS, source: "profile" })
  })

  it("ignores a blank workspace in a hand-edited config", () => {
    // saveWorkspace never writes one, but a config file is a text file and
    // people edit them. A blank is not a selection; treating it as one would
    // send an empty header, which means something different from none.
    setProfile("production", { baseUrl: "https://api.example.com", token: "ndr_x", workspace: "   " })
    expect(resolveWorkspace(profile())).toEqual({ workspaceId: undefined, source: "none" })
  })

  it("clears the saved workspace back to the personal space", () => {
    saveWorkspace(undefined, WS)
    saveWorkspace(undefined, null)
    expect(profile()?.workspace).toBeUndefined()
    expect(resolveWorkspace(profile())).toEqual({ workspaceId: undefined, source: "none" })
  })

  it("keeps the token and base url when it saves a workspace", () => {
    // Saving a preference must never be the reason credentials are lost.
    saveWorkspace(undefined, WS)
    expect(profile()).toEqual({ baseUrl: "https://api.example.com", token: "ndr_x", workspace: WS })
  })

  it("keeps the credentials file at 0600 after saving one", () => {
    saveWorkspace(undefined, WS)
    const mode = statSync(join(dir, "config.json")).mode & 0o777
    // Windows does not model POSIX permission bits; assert only where it does.
    if (process.platform !== "win32") expect(mode).toBe(0o600)
    else expect(mode).toBeGreaterThan(0)
  })

  it("refuses to save against a profile that has no credentials", () => {
    expect(() => saveWorkspace("staging", WS)).toThrow(/no credentials/i)
  })

  it("hands the resolved workspace to the client it builds", () => {
    // The resolution above is only worth anything if the client carries it:
    // a CLI that resolved a workspace and then sent no header would report
    // the right workspace and write into the wrong one.
    expect(buildClient().workspaceId).toBeUndefined()
    saveWorkspace(undefined, WS)
    expect(buildClient().workspaceId).toBe(WS)
    setWorkspaceFlag(WS2)
    expect(buildClient().workspaceId).toBe(WS2)
  })

  /**
   * `workspace use` verifies against the LIST — what the caller may switch
   * into — and not against `get`, which answers "may I read this". A
   * platform administrator may read any workspace and can select only their
   * own, so a `get` probe would save one the server then refuses on every
   * later command: the exact failure verify-before-save exists to prevent.
   */
  it("verifies a workspace against the list a caller can switch into", async () => {
    const { workspaceCommand } = await import("../commands/workspace.js")
    const list = vi.fn(async () => ({ data: [{ id: WS, name: "Class 1", archived: false }], lastWorkspaceId: null }))
    const get = vi.fn()
    vi.spyOn(await import("../client.js"), "buildClient").mockReturnValue({
      workspaces: { list, get },
    } as never)

    await workspaceCommand().parseAsync(["node", "nodaro", "use", WS])
    expect(list).toHaveBeenCalled()
    expect(get).not.toHaveBeenCalled()
    expect(getProfile().profile?.workspace).toBe(WS)
    vi.restoreAllMocks()
  })

  it("saves NOTHING when the workspace is not one this account can work in", async () => {
    const { workspaceCommand } = await import("../commands/workspace.js")
    const list = vi.fn(async () => ({ data: [{ id: WS, name: "Class 1", archived: false }], lastWorkspaceId: null }))
    vi.spyOn(await import("../client.js"), "buildClient").mockReturnValue({ workspaces: { list } } as never)
    const exit = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("exit")
    }) as never)
    vi.spyOn(console, "error").mockImplementation(() => {})

    await expect(workspaceCommand().parseAsync(["node", "nodaro", "use", WS2])).rejects.toThrow("exit")
    expect(exit).toHaveBeenCalledWith(1)
    expect(getProfile().profile?.workspace).toBeUndefined()
    vi.restoreAllMocks()
  })

  it("saves per profile, not globally", () => {
    setProfile("staging", { baseUrl: "https://next.example.com", token: "ndr_y" })
    saveWorkspace("staging", WS2)
    expect(getProfile("staging").profile?.workspace).toBe(WS2)
    expect(getProfile("production").profile?.workspace).toBeUndefined()
  })
})
