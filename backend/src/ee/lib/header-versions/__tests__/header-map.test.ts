import { describe, expect, it } from "vitest"
import { GitHubError, type GitHubReader } from "../github.js"
import { MAP_FILE, parseHeaderMap, readHeaderMap } from "../header-map.js"
import { askOnce, type AskLink } from "../world-links.js"

/**
 * The header's explanations, read from its repository as they stand: a fixed
 * shape of plain text within limits, refused whole (with the reason) when it is
 * anything else; and each world's address asked, one failure never failing
 * the others.
 */

const sample = () => ({
  asOf: "1.2.0",
  figures: {
    anatomy: {
      heading: "What the bar holds",
      barLabel: "All of it is the bar",
      parts: {
        logo: { name: "Mark", note: "Goes home." },
        worlds: { name: "Places" },
        developers: { name: "Tools" },
        language: { name: "Tongue" },
        credits: { name: "Coins" },
        account: { name: "Me" },
      },
      caption: "A bar on every page.",
    },
    release: { heading: "Shipping", lanes: [{ name: "Here", steps: [{ name: "Merge", gate: "Checks pass." }, { name: "Tag", strong: true }] }] },
    phone: {
      heading: "On a phone",
      header: { name: "Top", measure: "--top-h" },
      page: { name: "Page" },
      productBar: { name: "Actions", detail: "Go, Stop" },
      bottomBar: { name: "Bottom", measure: "--bottom-h", note: "Taller on a phone" },
      a11y: { note: "Lifted" },
    },
  },
  worlds: [
    { id: "gallery", label: "Gallery", href: "https://example.com/gallery", group: "simple" },
    { id: "editor", label: "Editor", href: "https://editor.example.com", group: "advanced" },
  ],
})

/** A reader that only knows the current files it is given, by `repo:path`; any other read is a mistake here. */
function reader(files: Record<string, string | Error>): { github: GitHubReader; asked: string[] } {
  const asked: string[] = []
  const unused = async (): Promise<never> => {
    throw new Error("not read here")
  }
  const github: GitHubReader = {
    deployments: unused,
    statuses: unused,
    fileAt: unused,
    tags: unused,
    commitsBetween: unused,
    async currentFile(repo, path) {
      asked.push(`${repo}:${path}`)
      const file = files[`${repo}:${path}`]
      if (file instanceof Error) throw file
      return file ?? null
    },
  }
  return { github, asked }
}

const answers = (byHref: Record<string, number | Error>): AskLink =>
  askOnce(async (href) => {
    const answer = byHref[href]
    if (answer === undefined) throw new Error(`asked an address it should not: ${href}`)
    if (answer instanceof Error) throw answer
    return answer
  })

const timeout = () => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" })

describe("parseHeaderMap", () => {
  it("reads the shape as given, text trimmed", () => {
    const map = sample()
    map.figures.anatomy.heading = "  What the bar holds  "
    const read = parseHeaderMap(JSON.stringify(map))
    const worlds = sample().worlds.map((world) => (world.id === "editor" ? { ...world, href: "https://editor.example.com/" } : world))
    expect(read).toEqual({ map: { ...sample(), worlds } })
  })

  it("writes each world's address one way, as a site's own file is read: one place is one address", () => {
    const map = sample()
    map.worlds = [{ id: "editor", label: "Editor", href: "https://Editor.Example.com", group: "advanced" }]
    const read = parseHeaderMap(JSON.stringify(map))
    expect("map" in read && read.map.worlds[0]?.href).toBe("https://editor.example.com/")
  })

  it.each([
    ["a figure the page does not draw", (m: any) => (m.figures.table = { heading: "x" }), /figures/],
    ["a key the shape does not have", (m: any) => (m.figures.anatomy.parts.logo.href = "https://example.com"), /figures\.anatomy\.parts\.logo/],
    ["a part of the bar left out", (m: any) => delete m.figures.anatomy.parts.account, /figures\.anatomy\.parts\.account/],
    ["a key at the top", (m: any) => (m.products = []), /does not have the shape/],
    ["a world address that is not https", (m: any) => (m.worlds[0].href = "http://example.com/gallery"), /worlds\.0\.href: must be an https address/],
    ["a world address that is not an address", (m: any) => (m.worlds[0].href = "gallery"), /worlds\.0\.href/],
    ["two worlds with one id", (m: any) => (m.worlds[1].id = "gallery"), /two worlds share an id/],
    ["a caption over the limit", (m: any) => (m.figures.anatomy.caption = "x".repeat(1001)), /figures\.anatomy\.caption/],
    ["a note over the limit", (m: any) => (m.figures.anatomy.parts.logo.note = "x".repeat(201)), /parts\.logo\.note/],
    ["a lane without steps", (m: any) => (m.figures.release.lanes[0].steps = []), /lanes\.0\.steps/],
    ["a blank step", (m: any) => (m.figures.release.lanes[0].steps[1].name = "   "), /steps\.1\.name/],
    ["a stand-out that is not yes or no", (m: any) => (m.figures.release.lanes[0].steps[1].strong = "yes"), /steps\.1\.strong/],
    ["a measure that is not a CSS property", (m: any) => (m.figures.phone.header.measure = "height"), /phone\.header\.measure/],
    ["a band of the phone left out", (m: any) => delete m.figures.phone.bottomBar, /phone\.bottomBar/],
    ["a version that is not one", (m: any) => (m.asOf = "latest"), /asOf/],
  ])("refuses %s, saying where", (_name, change, where) => {
    const map = sample()
    change(map)
    const read = parseHeaderMap(JSON.stringify(map))
    expect("problem" in read && read.problem).toMatch(where)
    expect("problem" in read && read.problem).toContain(MAP_FILE)
  })

  it("draws only the figures the file gives", () => {
    const read = parseHeaderMap(JSON.stringify({ ...sample(), figures: {} }))
    expect("map" in read && read.map.figures).toEqual({})
  })

  it("refuses a file that is not JSON, and one too large to be explanations, before parsing it", () => {
    expect(parseHeaderMap("{ not json")).toEqual({ problem: `${MAP_FILE} is not valid JSON.` })
    const huge = JSON.stringify({ ...sample(), padding: "x".repeat(70_000) })
    expect(parseHeaderMap(huge)).toEqual({ problem: `${MAP_FILE} is larger than 64 KB.` })
  })
})

describe("readHeaderMap", () => {
  const FILE = `nodaroai/shell:${MAP_FILE}`

  it("reads the header's file as it stands and asks every world's address", async () => {
    const { github, asked } = reader({ [FILE]: JSON.stringify(sample()) })
    const result = await readHeaderMap(github, answers({ "https://example.com/gallery": 404, "https://editor.example.com/": 200 }))
    expect(asked).toEqual([FILE])
    expect(result).toEqual({
      status: "ok",
      asOf: "1.2.0",
      url: `https://github.com/nodaroai/shell/blob/HEAD/${MAP_FILE}`,
      figures: sample().figures,
      worlds: [
        { id: "gallery", label: "Gallery", href: "https://example.com/gallery", group: "simple", answer: { status: "answered", code: 404 } },
        { id: "editor", label: "Editor", href: "https://editor.example.com/", group: "advanced", answer: { status: "answered", code: 200 } },
      ],
    })
  })

  it("an address that does not answer fails only its own world, and says why", async () => {
    const { github } = reader({ [FILE]: JSON.stringify(sample()) })
    const result = await readHeaderMap(github, answers({ "https://example.com/gallery": timeout(), "https://editor.example.com/": new TypeError("fetch failed") }))
    expect(result.status === "ok" && result.worlds.map((world) => world.answer)).toEqual([
      { status: "no_answer", message: "No answer within 8 seconds." },
      { status: "no_answer", message: "The address could not be reached." },
    ])
  })

  it("a repository without the file says so, and no address is asked", async () => {
    const { github } = reader({})
    expect(await readHeaderMap(github, answers({}))).toEqual({ status: "missing" })
  })

  it("a file the page cannot read is refused whole, and no address is asked", async () => {
    const { github } = reader({ [FILE]: JSON.stringify({ ...sample(), asOf: "soon" }) })
    const result = await readHeaderMap(github, answers({}))
    expect(result).toMatchObject({ status: "error", message: expect.stringMatching(/asOf/) })
  })

  it("GitHub's refusal is said in its words; without the token GitHub is never asked", async () => {
    const { github } = reader({ [FILE]: new GitHubError("GitHub answered 403: Resource not accessible by personal access token", 403) })
    expect(await readHeaderMap(github, answers({}))).toMatchObject({ status: "error", message: expect.stringContaining("GitHub answered 403") })
    expect(await readHeaderMap(null, answers({}))).toEqual({ status: "not_configured" })
  })
})
