/**
 * The SDK's docs that live outside the docs site — the package README, the
 * agent primer, the agent skills and the Claude Code plugin — drifted from
 * the SDK and from each other: the README's copy of the primer lost a
 * section, the plugin listed 22 of the client's resources, and every link
 * still pointed at the old GitHub Pages copy after the docs moved to
 * nodaro.ai/docs.
 */
import { describe, it, expect } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(__dirname, "..", "..", "..", "..")
const read = (path: string) => readFileSync(join(ROOT, path), "utf8")

/** The primer file minus its leading `#` comment header. */
function primerBody(): string {
  const lines = read("docs/sdk-agent-primer.txt").split("\n")
  const firstBody = lines.findIndex((line) => !line.startsWith("#"))
  return lines.slice(firstBody).join("\n").trim()
}

/** The primer as the README embeds it, between the ````text fences. */
function readmePrimer(): string {
  const readme = read("packages/client/README.md")
  const match = readme.match(/\n````text\n([\s\S]*?)\n````\n/)
  if (!match) throw new Error("packages/client/README.md has no ````text primer block")
  return match[1].trim()
}

function filesUnder(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name).slice(ROOT.length + 1))
}

describe("SDK docs outside the docs site", () => {
  it("the README carries the primer exactly as docs/sdk-agent-primer.txt has it", () => {
    expect(readmePrimer()).toBe(primerBody())
  })

  it("links nodaro.ai/docs, not the old GitHub Pages copy", () => {
    const files = [
      "packages/client/README.md",
      "packages/cli/README.md",
      "docs/sdk-agent-primer.txt",
      ".claude-plugin/marketplace.json",
      ...filesUnder("docs/skills"),
      ...filesUnder("plugins/nodaro"),
    ]
    const stale = files.filter((file) => read(file).includes("nodaroai.github.io"))
    expect(stale).toEqual([])
  })

  it("the plugin's resource table lists every resource on the client, and only those", () => {
    const client = read("packages/client/src/client.ts")
    const resources = [...client.matchAll(/^ {2}readonly (\w+): \w+Resource$/gm)].map((m) => m[1])
    expect(resources.length).toBeGreaterThan(30)

    const table = read("plugins/nodaro/skills/nodaro-sdk/references/resources.md")
    const rows = [...table.matchAll(/^\| `(\w+)` \|/gm)].map((m) => m[1])
    expect([...rows].sort()).toEqual([...resources].sort())
  })
})
