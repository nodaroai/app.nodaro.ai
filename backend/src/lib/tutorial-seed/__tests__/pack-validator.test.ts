import { describe, it, expect } from "vitest"
import {
  parsePackManifest,
  validatePackDoc,
  isPublicHttpsUrl,
} from "../pack-validator.js"
import type { TutorialPackManifest } from "../types.js"

const manifest = (over: Partial<TutorialPackManifest> = {}): TutorialPackManifest => ({
  name: "SAI Tutorials",
  categories: [{ slug: "sai-basics", name: "SAI Basics", sortOrder: 0 }],
  ...over,
})

const doc = (over: Record<string, unknown> = {}) => ({
  slug: "sai-welcome",
  name: "Welcome",
  tutorialCategorySlug: "sai-basics",
  tutorialSortOrder: 0,
  nodes: [{ id: "n1", type: "generate-image", data: {
    prompt: "a lighthouse",
    generatedResults: [{ url: "https://cdn.example.com/a.png" }],
  } }],
  edges: [],
  ...over,
})

describe("parsePackManifest", () => {
  it("accepts a well-formed manifest", () => {
    const r = parsePackManifest(manifest(), "packA")
    expect(r.manifest).not.toBeNull()
    expect(r.issues.filter((i) => i.severity === "error")).toEqual([])
  })

  it("errors when name is missing", () => {
    const r = parsePackManifest({ categories: [] }, "packA")
    expect(r.manifest).toBeNull()
    expect(r.issues.some((i) => i.severity === "error" && i.code === "manifest_invalid")).toBe(true)
  })

  it("errors when a category is missing its name (name is UNIQUE NOT NULL in the table)", () => {
    const r = parsePackManifest({ name: "P", categories: [{ slug: "x" }] }, "packA")
    expect(r.manifest).toBeNull()
    expect(r.issues.some((i) => i.severity === "error")).toBe(true)
  })
})

describe("validatePackDoc", () => {
  it("accepts a valid template doc", () => {
    const { doc: d, issues } = validatePackDoc(doc(), manifest())
    expect(d).not.toBeNull()
    expect(issues.filter((i) => i.severity === "error")).toEqual([])
  })

  it("errors on a category slug the manifest does not declare", () => {
    const { doc: d, issues } = validatePackDoc(doc({ tutorialCategorySlug: "ghost" }), manifest())
    expect(d).toBeNull()
    expect(issues.some((i) => i.code === "unknown_category" && i.severity === "error")).toBe(true)
  })

  it("errors on a template with zero nodes (not a runnable flow)", () => {
    const { issues } = validatePackDoc(doc({ nodes: [] }), manifest())
    expect(issues.some((i) => i.code === "empty_flow" && i.severity === "error")).toBe(true)
  })

  it("errors when a baked media URL is not a public https URL", () => {
    const bad = doc({ nodes: [{ id: "n1", type: "generate-image", data: {
      generatedResults: [{ url: "http://localhost:9000/a.png" }],
    } }] })
    const { issues } = validatePackDoc(bad, manifest())
    expect(issues.some((i) => i.code === "non_public_asset" && i.severity === "error")).toBe(true)
  })

  it("errors when previewMediaUrl is not public", () => {
    const bad = doc({ previewMediaUrl: "http://192.168.1.5/p.png" })
    const { issues } = validatePackDoc(bad, manifest())
    expect(issues.some((i) => i.code === "non_public_asset" && i.severity === "error")).toBe(true)
  })

  it("warns (does not error) when a template carries no baked demo output", () => {
    const noBake = doc({ nodes: [{ id: "n1", type: "generate-image", data: { prompt: "x" } }] })
    const { doc: d, issues } = validatePackDoc(noBake, manifest())
    expect(d).not.toBeNull() // still loads
    expect(issues.some((i) => i.code === "no_baked_output" && i.severity === "warn")).toBe(true)
    expect(issues.filter((i) => i.severity === "error")).toEqual([])
  })

  it("warns on a forbidden prompt term (real person / named composition), never errors", () => {
    const m = manifest({ forbiddenPromptTerms: ["taylor swift"] })
    const named = doc({ nodes: [{ id: "n1", type: "generate-image", data: {
      prompt: "portrait of Taylor Swift on stage",
      generatedResults: [{ url: "https://cdn.example.com/a.png" }],
    } }] })
    const { doc: d, issues } = validatePackDoc(named, m)
    expect(d).not.toBeNull()
    expect(issues.some((i) => i.code === "forbidden_prompt_term" && i.severity === "warn")).toBe(true)
  })
})

describe("isPublicHttpsUrl", () => {
  it.each([
    ["https://cdn.example.com/a.png", true],
    ["http://cdn.example.com/a.png", false], // must be https
    ["http://example.com/x.png", false], // must be https
    ["https://localhost/a.png", false],
    ["https://127.0.0.1/a.png", false],
    ["https://10.0.0.1/a.png", false],
    ["https://192.168.0.2/a.png", false],
    ["https://172.16.0.9/a.png", false],
    ["https://169.254.1.1/a.png", false], // IPv4 link-local
    ["https://0.0.0.0/x.png", false], // IPv4 unspecified
    // IPv6 hosts: URL.hostname returns them BRACKETED (e.g. "[::1]").
    ["https://[::1]/x.png", false], // IPv6 loopback
    ["https://[::]/x.png", false], // IPv6 unspecified
    ["https://[fd00::1]/x.png", false], // IPv6 ULA (fc00::/7)
    ["https://[fe80::1]/x.png", false], // IPv6 link-local (fe80::/10)
    ["https://[2001:db8::1]/x.png", true], // public IPv6 is NOT over-rejected
    ["https://fd.example.com/x.png", true], // hostname starting "fd" is public, not ULA
    ["data:image/png;base64,AAAA", false],
    ["/relative/a.png", false],
    ["not a url", false],
  ])("%s -> %s", (url, ok) => {
    expect(isPublicHttpsUrl(url as string)).toBe(ok)
  })
})
