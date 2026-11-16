// @test-watches frontend/Caddyfile frontend/public/**
/**
 * The one rule for "a path on this site" a deployment may name one of its own
 * pictures by (lib/site-picture-path.ts), shape by shape, and the two lists it
 * reads, each held to the files it stands for:
 *
 * - the reserved folders: every folder the proxy (frontend/Caddyfile) answers
 *   with something other than a file of the site's build or rewrites to, every
 *   folder the platform's build ships (frontend/public), and the CDN's own;
 * - the picture extensions: the still formats of the platform's own picker and
 *   preset pictures.
 */
import { readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterEach, describe, expect, it, vi } from "vitest"
import { LOOK_PREVIEW_SETS, SOUND_RENDER_SETS } from "@nodaro/prompts/picker-art"

const env = vi.hoisted(() => ({ publicUrl: "https://studio.example.com" }))

vi.mock("../config.js", () => ({
  config: {
    get PUBLIC_URL() {
      return env.publicUrl
    },
  },
}))

import {
  RESERVED_SITE_FOLDERS,
  SITE_PICTURE_EXTENSIONS,
  isSitePath,
  siteBaseProblem,
  sitePictureAddress,
  sitePictureFile,
  sitePicturePathProblem,
} from "../site-picture-path.js"

const REPO = join(dirname(fileURLToPath(import.meta.url)), "../../../..")

afterEach(() => {
  env.publicUrl = "https://studio.example.com"
})

describe("the path rule", () => {
  const accepted: ReadonlyArray<string> = [
    "/brand/pictures/style/noir.webp",
    "/brand/noir.png",
    "/brand/NOIR.WEBP",
    "/brand/a.b.c.webp",
    "/brand/%E2%98%85.webp",
    "/brand/caf%C3%A9.png",
    "/Brand-2/x_y-z.webp",
    "/brand/.hidden/x.webp",
    "/brand/%2e%2e%2e/x.webp",
    "/brand/100%25.webp",
    "/brand/a,b.webp",
    "/applications/x.webp",
    "/v1x/x.webp",
    "/brand/v1/x.webp",
    "/editor/x.webp",
    "/gallery/x.webp",
    // A `;` in the first folder starts its parameters; the folder before it is the deployment's own.
    "/brand;v2/x.webp",
    "/healthy/x.webp",
  ]
  for (const path of accepted) {
    it(`accepts ${path}`, () => {
      expect(sitePicturePathProblem(path)).toBeUndefined()
    })
  }

  const refused: ReadonlyArray<readonly [string, RegExp]> = [
    ["brand/x.webp", /must start with \//],
    ["https://studio.example.com/brand/x.webp", /must start with \//],
    ["//evil.example.org/brand/x.webp", /starts with \/\//],
    ["///brand/x.webp", /starts with \/\//],
    ["/\\evil.example.org/x.webp", /backslash/],
    ["/brand\\x.webp", /backslash/],
    ["/brand/\u0000.webp", /control character/],
    ["/brand/x\n.webp", /control character/],
    ["/brand/x\u007f.webp", /control character/],
    ["/brand/x y.webp", /whitespace/],
    ["/brand/x y.webp", /whitespace/],
    ["/brand/x.webp?v=2", /query or a fragment/],
    ["/brand/x.webp#top", /query or a fragment/],
    ["/brand%2Fx.webp", /encodes a slash/],
    ["/brand%2fx.webp", /encodes a slash/],
    ["/brand%5Cx.webp", /encodes a slash or a backslash/],
    ["/brand/%E2%98.webp", /not valid percent-encoding/],
    ["/brand/%zz.webp", /not valid percent-encoding/],
    ["/brand/%00.webp", /encodes a control character/],
    ["/brand/%0A.webp", /encodes a control character/],
    ["/brand//x.webp", /empty segment/],
    ["/brand/", /empty segment/],
    ["/brand/./x.webp", /\. or \.\. segment/],
    ["/brand/../x.webp", /\. or \.\. segment/],
    ["/brand/%2e%2e/x.webp", /\. or \.\. segment/],
    ["/brand/%2E/x.webp", /\. or \.\. segment/],
    ["/..", /\. or \.\. segment/],
    ["/x.webp", /names no folder/],
    ["/favicon.png", /names no folder/],
    ["/v1/x.webp", /under \/v1\/.*the API/],
    ["/V1/x.webp", /under \/V1\//],
    ["/%76%31/x.webp", /under \/v1\//],
    ["/.well-known/x.png", /under \/\.well-known\//],
    ["/mcp/x.webp", /under \/mcp\//],
    ["/health/x.webp", /under \/health\/.*the API/],
    // The proxy hands /health;… to the API too (frontend/Caddyfile): the folder is read up to its `;`.
    ["/health;x/a.png", /under \/health;x\/.*the API/],
    ["/HEALTH;v=1/a.png", /under \/HEALTH;v=1\//],
    ["/v1;x/a.png", /under \/v1;x\//],
    ["/og/x.webp", /under \/og\//],
    ["/app/x.webp", /under \/app\//],
    ["/embed/x.webp", /under \/embed\//],
    ["/present/x.webp", /under \/present\//],
    ["/storage/bucket/x.webp", /under \/storage\//],
    ["/supabase/x.webp", /under \/supabase\//],
    ["/assets/x.webp", /under \/assets\//],
    ["/picker-art/character/person/man.441363db.webp", /under \/picker-art\/.*platform's picker pictures/],
    ["/Picker-Art/x.webp", /under \/Picker-Art\//],
    ["/preset-previews/a.webp", /under \/preset-previews\//],
    ["/fonts/x.png", /under \/fonts\//],
    ["/cdn-cgi/image/width=480/brand/x.webp", /under \/cdn-cgi\//],
    ["/brand/x.mp4", /does not name a picture \(\.png or \.webp\)/],
    ["/brand/x.webm", /does not name a picture/],
    ["/brand/x.mov", /does not name a picture/],
    ["/brand/x.gif", /does not name a picture/],
    ["/brand/x.svg", /does not name a picture/],
    ["/brand/x.jpg", /does not name a picture/],
    ["/brand/x", /does not name a picture/],
    ["/brand/.webp", /does not name a picture/],
    ["/brand/x.webp.", /does not name a picture/],
  ]
  for (const [path, message] of refused) {
    it(`refuses ${JSON.stringify(path)}`, () => {
      expect(sitePicturePathProblem(path)).toMatch(message)
    })
  }
})

describe("which rule judges an address", () => {
  it("an address that starts with / is a site path (and // is refused by its rule)", () => {
    expect(isSitePath("/brand/x.webp")).toBe(true)
    expect(isSitePath("//evil.example.org/x.webp")).toBe(true)
    expect(isSitePath("https://media.example.com/x.webp")).toBe(false)
    expect(isSitePath("brand/x.webp")).toBe(false)
    expect(isSitePath(undefined)).toBe(false)
    expect(isSitePath(7)).toBe(false)
  })
})

describe("PUBLIC_URL must be the site's address", () => {
  it("an http(s) PUBLIC_URL serves site paths", () => {
    expect(siteBaseProblem()).toBeUndefined()
    env.publicUrl = "http://localhost:3000"
    expect(siteBaseProblem()).toBeUndefined()
  })
  for (const value of ["", "studio.example.com", "ftp://studio.example.com"]) {
    it(`PUBLIC_URL ${JSON.stringify(value)} does not`, () => {
      env.publicUrl = value
      expect(siteBaseProblem()).toMatch(/needs PUBLIC_URL set to the site's http\(s\) address/)
    })
  }
})

describe("how a site path reaches a reader", () => {
  it("on the site (REST): as registered", () => {
    expect(sitePictureAddress("/brand/x.webp", { onSite: true, base: "https://a.example.com" })).toBe("/brand/x.webp")
  })
  it("off the site (MCP): absolute on the reader base's origin, whatever path the base has", () => {
    expect(sitePictureAddress("/brand/x.webp", { onSite: false, base: "https://a.example.com" })).toBe("https://a.example.com/brand/x.webp")
    expect(sitePictureAddress("/brand/x.webp", { onSite: false, base: "https://b.example.com:8443/app/" })).toBe("https://b.example.com:8443/brand/x.webp")
    expect(sitePictureAddress("/brand/caf%C3%A9.webp", { onSite: false, base: "http://localhost:3000" })).toBe("http://localhost:3000/brand/caf%C3%A9.webp")
  })
  it("an absolute address is served as registered either way", () => {
    for (const onSite of [true, false]) {
      expect(sitePictureAddress("https://media.example.com/x.webp", { onSite, base: "https://a.example.com" })).toBe("https://media.example.com/x.webp")
    }
  })
  it("the file a path names under the site's root is its decoded path", () => {
    expect(sitePictureFile("/brand/caf%C3%A9.webp")).toBe("brand/café.webp")
    expect(sitePictureFile("/brand/100%25.webp")).toBe("brand/100%.webp")
  })
})

/**
 * The folders frontend/Caddyfile answers with something other than a file of
 * the site's build, or rewrites a request to. A `handle` / `handle_path` on a
 * path, or on a named matcher's paths, counts — unless the matcher skips every
 * picture file (`not path *.png *.webp …` and `not file`), which then never
 * answers a picture. A root file (`/config.js`) names no folder.
 */
function caddyFolders(): Set<string> {
  const text = readFileSync(join(REPO, "frontend/Caddyfile"), "utf8")
  const lines = text.split("\n").map((line) => line.replace(/(^|\s)#.*$/, "").trim())
  const matchers = new Map<string, { paths: string[]; notPaths: string[]; notFile: boolean }>()
  for (let i = 0; i < lines.length; i += 1) {
    const open = /^@([\w-]+)\s*\{$/.exec(lines[i]!)
    // A one-line matcher: `@name path /a /b`, or another kind (`@name expression …`), which names no path.
    const single = /^@([\w-]+)\s+(?!\{)(\S+)\s*(.*)$/.exec(lines[i]!)
    if (single) matchers.set(single[1]!, { paths: single[2] === "path" ? single[3]!.split(/\s+/) : [], notPaths: [], notFile: false })
    if (!open) continue
    const m = { paths: [] as string[], notPaths: [] as string[], notFile: false }
    let depth = 1
    for (i += 1; i < lines.length && depth > 0; i += 1) {
      const line = lines[i]!
      if (depth === 1 && line.startsWith("path ")) m.paths.push(...line.slice(5).trim().split(/\s+/))
      if (depth === 1 && line.startsWith("not path ")) m.notPaths.push(...line.slice(9).trim().split(/\s+/))
      if (depth === 1 && /^not file\b/.test(line)) m.notFile = true
      depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length
    }
    i -= 1
    matchers.set(open[1]!, m)
  }
  const skipsPictures = (m: { notPaths: string[]; notFile: boolean }) =>
    m.notFile && SITE_PICTURE_EXTENSIONS.every((e) => m.notPaths.includes(`*.${e}`))
  const patterns: string[] = []
  for (const line of lines) {
    const handle = /^(?:handle|handle_path)\s+(\S+)\s*\{$/.exec(line)
    if (handle) {
      const target = handle[1]!
      if (target.startsWith("@")) {
        const m = matchers.get(target.slice(1))
        expect(m, `matcher ${target}`).toBeDefined()
        if (!skipsPictures(m!)) patterns.push(...m!.paths)
      } else patterns.push(target)
    }
    const rewrite = /^rewrite\s+\S+\s+(\/\S+)$/.exec(line)
    if (rewrite) patterns.push(rewrite[1]!.replace(/\{[^}]*\}/g, ""))
  }
  const folders = new Set<string>()
  for (const pattern of patterns) {
    if (!pattern.startsWith("/")) continue
    const segments = pattern.slice(1).split("/")
    // A `;` starts the segment's parameters (`/health;*`): the folder is what comes before it.
    const first = segments[0]!.split(";")[0]!
    if (first === "" || first === "*") continue
    const rootFile = segments.length === 1 && /^[^.].*\.[a-z0-9]+$/i.test(first)
    if (!rootFile) folders.add(first.toLowerCase())
  }
  return folders
}

/** Every folder at the top of the platform's build (frontend/public). */
function publicFolders(): Set<string> {
  const entries = readdirSync(join(REPO, "frontend/public"), { withFileTypes: true })
  return new Set(entries.filter((e) => e.isDirectory()).map((e) => e.name.toLowerCase()))
}

/** Reserved for a reason no file of this repo states. */
const OUTSIDE_THE_REPO: Readonly<Record<string, string>> = {
  "cdn-cgi": "Cloudflare answers /cdn-cgi/ on every zone it fronts, before the request reaches the site",
}

describe("the reserved folders are the proxy's, the platform build's and the CDN's", () => {
  it("the proxy's folders are found (the parse still reads the Caddyfile)", () => {
    const found = caddyFolders()
    for (const folder of ["v1", ".well-known", "storage", "supabase", "assets", "picker-art", "preset-previews", "og"]) {
      expect(found.has(folder), folder).toBe(true)
    }
    // The page-move matcher skips every picture file, so its pages are not reserved.
    expect(found.has("editor")).toBe(false)
    expect(found.has("gallery")).toBe(false)
  })

  it("the list is exactly those folders: a new proxy route or platform folder is listed on purpose", () => {
    const expected = new Set([...caddyFolders(), ...publicFolders(), ...Object.keys(OUTSIDE_THE_REPO)])
    expect([...RESERVED_SITE_FOLDERS.keys()].sort()).toEqual([...expected].sort())
  })

  it("every entry is lower-case, so the case-folded compare finds it", () => {
    for (const key of RESERVED_SITE_FOLDERS.keys()) expect(key).toBe(key.toLowerCase())
  })
})

describe("the picture extensions are the platform's own pictures' still formats", () => {
  function extensionsIn(dir: string): string[] {
    const out: string[] = []
    for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
      if (!entry.isFile()) continue
      const dot = entry.name.lastIndexOf(".")
      if (dot > 0) out.push(entry.name.slice(dot + 1).toLowerCase())
    }
    return out
  }
  const CLIP = new Set(["mp4", "webm", "mov", "m4v"])
  const NOT_A_PICTURE = new Set(["txt", "json", "md"])

  it("the committed picker and preset pictures, and the rendered sets, use exactly these", () => {
    const formats = new Set<string>()
    for (const dir of ["frontend/public/picker-art", "frontend/public/preset-previews"]) {
      for (const ext of extensionsIn(join(REPO, dir))) if (!NOT_A_PICTURE.has(ext)) formats.add(ext)
    }
    for (const set of [LOOK_PREVIEW_SETS, SOUND_RENDER_SETS] as ReadonlyArray<Readonly<Record<string, Readonly<Record<string, string>>>>>) {
      for (const url of Object.values(set).flatMap((s) => Object.values(s))) {
        const ext = new URL(url).pathname.split(".").pop()!.toLowerCase()
        if (!CLIP.has(ext)) formats.add(ext)
      }
    }
    expect([...formats].sort()).toEqual([...SITE_PICTURE_EXTENSIONS].sort())
  })
})
