import { describe, expect, it } from "vitest"
import { GitHubError, type CommitSummary, type GitHubReader } from "../github.js"
import { releasesOf } from "../read-version.js"
import { changesOf, createReleaseNotes, RELEASES_SHOWN } from "../release-notes.js"

const commit = (message: string, parents = 1, committedAt: string | null = null): CommitSummary => ({ message, parents, committedAt })

describe("changesOf", () => {
  it("a release's changes are its merged pull requests, by their titles", () => {
    expect(
      changesOf([
        commit("feat: the row can be turned off (0.13.0)\n\nLong body."),
        commit("docs: screenshots"),
        commit("Merge pull request #22 from acme/feat/row-off\n\nfeat: the row can be turned off (0.13.0)", 2),
        commit("Merge pull request #21 from acme/fix/avatar\n\nfix(avatar): Google pictures load again", 2),
      ]),
    ).toEqual([
      { title: "the row can be turned off", kind: "feature", url: "https://github.com/nodaroai/shell/pull/22" },
      { title: "Google pictures load again", kind: "fix", url: "https://github.com/nodaroai/shell/pull/21" },
    ])
  })

  it("a squashed pull request is read from its subject's (#n)", () => {
    expect(changesOf([commit("refactor: one menu reader (#30)\n\nBody")])).toEqual([{ title: "one menu reader", kind: "other", url: "https://github.com/nodaroai/shell/pull/30" }])
  })

  it("a release that merged no pull request lists its commits, never its version bump, docs, tests or merges", () => {
    expect(
      changesOf([
        commit("feat: one sign-in page"),
        commit("fix: the sign-in path keeps the site"),
        commit("chore: release 0.10.0 — one sign-in page"),
        commit("docs: local sign-in"),
        commit("test: the sign-in path"),
        commit("Merge origin/main into feat/x", 2),
        commit("feat: one sign-in page"),
      ]),
    ).toEqual([
      { title: "one sign-in page", kind: "feature", url: null },
      { title: "the sign-in path keeps the site", kind: "fix", url: null },
    ])
  })

  it("a version-bump pull request is left out beside real ones, kept when it is all the release merged", () => {
    const bump = commit("Merge pull request #9 from a/release\n\nchore: release 0.10.0", 2)
    expect(changesOf([bump, commit("Merge pull request #8 from a/b\n\nfeat: one sign-in page", 2)]).map((c) => c.title)).toEqual(["one sign-in page"])
    expect(changesOf([bump]).map((c) => c.title)).toEqual(["release 0.10.0"])
  })

  it("two pull requests that share a title stay two", () => {
    const changes = changesOf([commit("Merge pull request #5 from a/b\n\nfix: menu", 2), commit("Merge pull request #6 from a/c\n\nfix: menu", 2)])
    expect(changes.map((c) => c.url)).toEqual(["https://github.com/nodaroai/shell/pull/5", "https://github.com/nodaroai/shell/pull/6"])
  })
})

function fakeGitHub(compares: Record<string, CommitSummary[]>, fail: boolean | string = false) {
  const asked: string[] = []
  const github = {
    async commitsBetween(_repo: string, base: string, head: string) {
      asked.push(`${base}...${head}`)
      if (fail === true || fail === `${base}...${head}`) throw new GitHubError("GitHub answered 404: Not Found", 404)
      return compares[`${base}...${head}`] ?? []
    },
  } as unknown as GitHubReader
  return { github, asked }
}

const site = (productId: string, environment: "production" | "staging", version: string) => ({ productId, environment, version })

describe("createReleaseNotes", () => {
  const releases = releasesOf(["v0.11.0", "v0.12.0", "v0.13.0", "not-a-release", "v0.14.0-rc.1"])

  it("lists every release newer than the oldest version served, newest first, with the sites that lack it", async () => {
    const { github } = fakeGitHub({
      "v0.12.0...v0.13.0": [commit("Merge pull request #22 from a/b\n\nfeat: row off", 2, "2026-11-01T10:00:00Z")],
      "v0.11.0...v0.12.0": [commit("Merge pull request #21 from a/b\n\nfeat: More menu", 2, "2026-10-30T10:00:00Z")],
    })
    const result = await createReleaseNotes(github).since(releases, [site("tools", "production", "0.11.0"), site("tools", "staging", "0.12.0"), site("studio", "production", "0.13.0")])
    expect(result).toEqual({
      status: "ok",
      older: 0,
      compared: 3,
      releases: [
        {
          version: "0.13.0",
          summary: null,
          releasedAt: "2026-11-01T10:00:00Z",
          url: "https://github.com/nodaroai/shell/compare/v0.12.0...v0.13.0",
          changes: [{ title: "row off", kind: "feature", url: "https://github.com/nodaroai/shell/pull/22" }],
          missingOn: [
            { productId: "tools", environment: "production" },
            { productId: "tools", environment: "staging" },
          ],
        },
        {
          version: "0.12.0",
          summary: null,
          releasedAt: "2026-10-30T10:00:00Z",
          url: "https://github.com/nodaroai/shell/compare/v0.11.0...v0.12.0",
          changes: [{ title: "More menu", kind: "feature", url: "https://github.com/nodaroai/shell/pull/21" }],
          missingOn: [{ productId: "tools", environment: "production" }],
        },
      ],
    })
  })

  it("every site on the newest release: nothing to list, and GitHub is not asked", async () => {
    const { github, asked } = fakeGitHub({})
    expect(await createReleaseNotes(github).since(releases, [site("studio", "production", "0.13.0")])).toEqual({ status: "ok", releases: [], older: 0, compared: 1 })
    expect(asked).toEqual([])
  })

  it("nothing to compare — no site's version read, or no release tagged — is never said as every site current", async () => {
    const { github } = fakeGitHub({})
    expect(await createReleaseNotes(github).since(releases, [])).toEqual({ status: "ok", releases: [], older: 0, compared: 0 })
    expect(await createReleaseNotes(github).since([], [site("tools", "production", "0.12.0")])).toEqual({ status: "ok", releases: [], older: 0, compared: 0 })
  })

  it("a release's commits never change: asked once across builds", async () => {
    const { github, asked } = fakeGitHub({})
    const notes = createReleaseNotes(github)
    await notes.since(releases, [site("tools", "production", "0.12.0")])
    await notes.since(releases, [site("tools", "production", "0.12.0")])
    expect(asked).toEqual(["v0.12.0...v0.13.0"])
  })

  it(`lists at most ${RELEASES_SHOWN} releases and counts the rest`, async () => {
    const many = releasesOf(Array.from({ length: RELEASES_SHOWN + 3 }, (_, i) => `v1.${i}.0`))
    const { github } = fakeGitHub({})
    const result = await createReleaseNotes(github).since(many, [site("tools", "production", "1.0.0")])
    expect(result.status === "ok" && result.releases.map((r) => r.version)).toEqual(Array.from({ length: RELEASES_SHOWN }, (_, i) => `1.${RELEASES_SHOWN + 2 - i}.0`))
    expect(result.status === "ok" && result.older).toBe(2)
  })

  it("each release carries its plain summary, written from that release's own commits", async () => {
    const commits = [commit("Merge pull request #22 from a/b\n\nfeat: row off", 2)]
    const { github } = fakeGitHub({ "v0.12.0...v0.13.0": commits })
    const asked: Array<[string, number]> = []
    const notes = createReleaseNotes(github, (version, given) => {
      asked.push([version, given.length])
      return `The row can be hidden (${version}).`
    })
    const result = await notes.since(releases, [site("tools", "production", "0.12.0")])
    expect(result.status === "ok" && result.releases[0]?.summary).toBe("The row can be hidden (0.13.0).")
    expect(asked).toEqual([["0.13.0", 1]])
  })

  it("GitHub refusing every comparison says so, with what usually fixes it", async () => {
    const { github } = fakeGitHub({}, true)
    const result = await createReleaseNotes(github).since(releases, [site("tools", "production", "0.12.0")])
    expect(result).toMatchObject({ status: "error", message: expect.stringMatching(/^GitHub answered 404/) })
  })

  it("one comparison refused fails its own release only, listed with no changes", async () => {
    const { github } = fakeGitHub({ "v0.12.0...v0.13.0": [commit("Merge pull request #22 from a/b\n\nfeat: row off", 2)] }, "v0.11.0...v0.12.0")
    const result = await createReleaseNotes(github).since(releases, [site("tools", "production", "0.11.0")])
    expect(result).toMatchObject({
      status: "ok",
      releases: [
        { version: "0.13.0", changes: [{ title: "row off" }] },
        { version: "0.12.0", changes: [], releasedAt: null },
      ],
    })
  })
})
