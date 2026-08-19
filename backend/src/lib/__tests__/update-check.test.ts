/**
 * The update check behind the sidebar red dot. The load-bearing behaviors:
 * npm-package releases sharing the repo must never be mistaken for an app
 * release; failures degrade to silence; one outbound request per TTL; cloud
 * and opted-out installs make no request at all.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

const editionMock = vi.hoisted(() => ({ isCloud: vi.fn(() => false) }))
vi.mock("../config.js", () => ({ isCloud: editionMock.isCloud }))
vi.mock("../app-version.js", () => ({ getAppVersion: () => "1.23.0" }))

import {
  getUpdateStatus,
  isNewer,
  updateCheckEnabled,
  _resetUpdateCheckForTests,
} from "../update-check.js"

const fetchMock = vi.fn()

const release = (tag: string, extra: Record<string, unknown> = {}) => ({
  tag_name: tag,
  html_url: `https://github.com/nodaroai/app.nodaro.ai/releases/tag/${tag}`,
  published_at: "2026-08-19T00:00:00Z",
  body: `Changes in ${tag}`,
  draft: false,
  prerelease: false,
  ...extra,
})

beforeEach(() => {
  _resetUpdateCheckForTests()
  editionMock.isCloud.mockReturnValue(false)
  delete process.env.NODARO_UPDATE_CHECK
  fetchMock.mockReset()
  vi.stubGlobal("fetch", fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete process.env.NODARO_UPDATE_CHECK
  delete process.env.RAILWAY_GIT_COMMIT_SHA
})

describe("isNewer", () => {
  it("compares semver numerically, not lexically", () => {
    expect(isNewer("1.23.0", "v2.0.0")).toBe(true)
    expect(isNewer("v2.0.0", "v1.23.0")).toBe(false)
    expect(isNewer("1.9.0", "1.10.0")).toBe(true)
    expect(isNewer("2.0.0", "2.0.0")).toBe(false)
  })

  it("a local -dev build never nags about itself", () => {
    expect(isNewer("1.23.0-dev.abc123", "v1.23.0")).toBe(false)
    expect(isNewer("0.0.0-dev", "v2.0.0")).toBe(true)
  })
})

describe("deployed-SHA version resolution (the cloud label fix)", () => {
  const tagsPayload = [
    { name: "v1.27.0", commit: { sha: "deadbeef27" } },
    { name: "@nodaro/sdk@9.9.9", commit: { sha: "deadbeef27" } }, // npm tag on the same sha must never win
    { name: "v1.26.1", commit: { sha: "cafebabe26" } },
  ]

  it("cloud: the running SHA's release tag becomes `current` — the label stops lying", async () => {
    editionMock.isCloud.mockReturnValue(true)
    process.env.RAILWAY_GIT_COMMIT_SHA = "deadbeef27"
    fetchMock.mockImplementation(async (url: unknown) =>
      String(url).includes("/tags")
        ? { ok: true, json: async () => tagsPayload }
        : { ok: true, json: async () => [release("v1.27.0")] },
    )
    const status = await getUpdateStatus()
    expect(status.current).toBe("1.27.0")
    expect(status.updateAvailable).toBe(false)
  })

  it("an untagged SHA (staging runs dev commits) keeps the fallback and never throws", async () => {
    process.env.RAILWAY_GIT_COMMIT_SHA = "not-a-release-sha"
    fetchMock.mockImplementation(async (url: unknown) =>
      String(url).includes("/tags")
        ? { ok: true, json: async () => tagsPayload }
        : { ok: true, json: async () => [release("v1.27.0")] },
    )
    const status = await getUpdateStatus()
    expect(status.current).toBe("1.23.0")
  })

  it("no RAILWAY_GIT_COMMIT_SHA (self-host) -> no tags request at all", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => [release("v1.24.0")] })
    await getUpdateStatus()
    expect(fetchMock.mock.calls.every((c) => !String(c[0]).includes("/tags"))).toBe(true)
  })
})

describe("getUpdateStatus", () => {
  it("picks the newest APP release and ignores the npm package releases sharing the repo", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [
        release("@nodaro/prompts@1.7.2"), // "latest" on GitHub the day this was written
        release("@nodaro/sdk@9.9.9"),
        release("v2.0.0"),
        release("v1.24.0"),
      ],
    })
    const status = await getUpdateStatus()
    expect(status.updateAvailable).toBe(true)
    expect(status.latest?.version).toBe("v2.0.0")
  })

  it("skips drafts and prereleases", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => [
        release("v3.0.0", { draft: true }),
        release("v2.1.0", { prerelease: true }),
        release("v1.24.0"),
      ],
    })
    const status = await getUpdateStatus()
    expect(status.latest?.version).toBe("v1.24.0")
  })

  it("caches — a second call makes no second request", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => [release("v2.0.0")] })
    await getUpdateStatus()
    await getUpdateStatus()
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it("a GitHub failure degrades to 'no update known' — never an error, never a nag", async () => {
    fetchMock.mockRejectedValue(new Error("api down"))
    const status = await getUpdateStatus()
    expect(status).toEqual({ current: "1.23.0", latest: null, updateAvailable: false })
  })

  it("NODARO_UPDATE_CHECK=off makes no request at all", async () => {
    process.env.NODARO_UPDATE_CHECK = "off"
    const status = await getUpdateStatus()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(status.updateAvailable).toBe(false)
    expect(updateCheckEnabled()).toBe(false)
  })

  it("cloud: latest still flows (the what's-new dialog reads it) but updateAvailable is ALWAYS false", async () => {
    editionMock.isCloud.mockReturnValue(true)
    fetchMock.mockResolvedValue({ ok: true, json: async () => [release("v9.0.0")] })
    const status = await getUpdateStatus()
    expect(status.latest?.version).toBe("v9.0.0")
    expect(status.updateAvailable).toBe(false)
  })

  it("running the latest already -> updateAvailable false, latest still reported", async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => [release("v1.23.0")] })
    const status = await getUpdateStatus()
    expect(status.updateAvailable).toBe(false)
    expect(status.latest?.version).toBe("v1.23.0")
  })
})
