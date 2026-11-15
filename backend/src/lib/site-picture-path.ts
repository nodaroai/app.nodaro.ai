import { config } from "./config.js"

/**
 * A deployment's own picture as a PATH ON ITS SITE (decided 2026-11-15): a file
 * the deployment ships inside its own build, served from the app's own site
 * under a folder of its own — the same kind of place the platform keeps its
 * picker pictures (`/picker-art/`) and preset pictures (`/preset-previews/`),
 * so it is versioned and reviewed with the deployment's release and same-origin
 * on every host the deployment serves the app on.
 *
 * The ONE rule for "a path on this site", used wherever a deployment names one
 * of its own pictures: `registerPickerPictures`' `pictureUrl` /
 * `enlargedPictureUrl` (lib/picker-pictures.ts) and a preset pack's
 * `previewUrl` (lib/presets/preset-pack-check.ts). Pinned by
 * lib/__tests__/site-picture-path.test.ts, which also derives the reserved
 * folders and the picture extensions from the files they stand for.
 *
 * How such a path reaches a reader is decided where each reply is made — the
 * picker picture decider (lib/picker-images.ts) and the preset view
 * (lib/presets/preset-view.ts) — through `sitePictureAddress` below: as
 * registered on a reply the browser reads on the site that served it (REST),
 * absolute on the reader's base everywhere else (the MCP tools).
 */

/**
 * The still formats a site path may name: the formats of the platform's own
 * picker and preset pictures (the test derives the set from those files). No
 * clip, as for every own picture.
 */
export const SITE_PICTURE_EXTENSIONS: readonly string[] = ["png", "webp"]

/**
 * The first folders a picture on the site may not live under, each with why,
 * compared decoded and case-folded (the proxy matches paths that way):
 *
 * - every folder the proxy in front of the app (frontend/Caddyfile) answers
 *   with something other than a file of the site's build — the API, the
 *   bundled services, the page-move redirects that follow no file type, the
 *   build's own assets;
 * - every folder the platform's own build ships (frontend/public), so a
 *   deployment's picture is always in a folder of its own;
 * - `cdn-cgi`, which the CDN in front of a hosted site answers itself.
 *
 * site-picture-path.test.ts holds the list to those sources both ways: a new
 * proxy route or a new platform folder fails it until it is listed here.
 */
export const RESERVED_SITE_FOLDERS: ReadonlyMap<string, string> = new Map([
  ["v1", "the API answers it"],
  [".well-known", "the API answers its discovery documents there"],
  ["mcp", "the proxy answers it for the MCP endpoint"],
  ["og", "the API answers it with link previews"],
  ["app", "a link-preview bot asking for it is answered by the API"],
  ["embed", "a host that has moved the app's pages redirects it"],
  ["present", "a host that has moved the app's pages redirects it"],
  ["storage", "the proxy answers it from the bundled media store"],
  ["supabase", "the proxy answers it from the bundled database and sign-in service"],
  ["assets", "it holds the build's own scripts and styles"],
  ["picker-art", "it holds the platform's picker pictures"],
  ["preset-previews", "it holds the platform's preset pictures"],
  ["face-mesh-art", "it holds the platform's own files"],
  ["fonts", "it holds the platform's own files"],
  ["notifications", "it holds the platform's own files"],
  ["projects", "it holds the platform's own files"],
  ["demo-assets", "it holds the platform's own files"],
  ["cdn-cgi", "the CDN in front of the site answers it"],
])

const CONTROL = /[\u0000-\u001f\u007f-\u009f]/
const WHITESPACE = /\s/
/** An encoded slash or backslash: decoded, it would change where the path's segments split. */
const ENCODED_SEPARATOR = /%(2f|5c)/i

/**
 * Whether an address is meant as a path on the site (it starts with `/`), and
 * is therefore judged by `sitePicturePathProblem` rather than by a seam's
 * absolute-address rule. `//host/…` lands here too, and is refused there.
 */
export function isSitePath(value: unknown): value is string {
  return typeof value === "string" && value.startsWith("/")
}

/**
 * Why `value` is not a path on this site a picture may be named by, as a
 * phrase that follows the value in a message ("… is under /v1/, …"), or
 * undefined when it is one. In order:
 *
 *  1. it starts with a single `/` (not `//`, which a browser reads as another
 *     host), and holds no backslash, whitespace (it would split a srcset),
 *     control character, query or fragment;
 *  2. it decodes ONCE as percent-encoding, encodes no slash or backslash, and
 *     decoded holds no control character;
 *  3. decoded, it has no empty, `.` or `..` segment, and names a file inside a
 *     folder (`/<folder>/…/<name>.<ext>`) whose first folder is none of
 *     `RESERVED_SITE_FOLDERS`;
 *  4. its file name ends in one of `SITE_PICTURE_EXTENSIONS`.
 */
export function sitePicturePathProblem(value: string): string | undefined {
  if (!value.startsWith("/")) return "is not a path on this site (it must start with /)"
  if (value.startsWith("//")) return "starts with //, which a browser reads as another host"
  if (value.includes("\\")) return "contains a backslash"
  if (CONTROL.test(value)) return "contains a control character"
  if (WHITESPACE.test(value)) return "contains whitespace"
  if (value.includes("?") || value.includes("#")) return "has a query or a fragment"
  if (ENCODED_SEPARATOR.test(value)) return "encodes a slash or a backslash"
  let decoded: string
  try {
    decoded = decodeURIComponent(value)
  } catch {
    return "is not valid percent-encoding"
  }
  if (CONTROL.test(decoded)) return "encodes a control character"
  const segments = decoded.slice(1).split("/")
  if (segments.some((s) => s === "")) return "has an empty segment"
  if (segments.some((s) => s === "." || s === "..")) return "has a . or .. segment"
  if (segments.length < 2) return "names no folder: a picture on the site lives in a folder of the deployment's own (/<folder>/<name>)"
  const reserved = RESERVED_SITE_FOLDERS.get(segments[0]!.toLowerCase())
  if (reserved !== undefined) return `is under /${segments[0]}/, which is not the deployment's own: ${reserved}`
  const name = segments[segments.length - 1]!
  const dot = name.lastIndexOf(".")
  const extension = dot > 0 ? name.slice(dot + 1).toLowerCase() : ""
  if (!SITE_PICTURE_EXTENSIONS.includes(extension)) {
    return `does not name a picture (${SITE_PICTURE_EXTENSIONS.map((e) => `.${e}`).join(" or ")})`
  }
  return undefined
}

/**
 * Why this install cannot serve a picture as a path on its site, or undefined
 * when it can: off the site (the MCP tools on the dedicated MCP host) the path
 * is made absolute on `PUBLIC_URL`, so `PUBLIC_URL` must be the site's own
 * http(s) address — never the hosted product's default host.
 */
export function siteBaseProblem(): string | undefined {
  const publicUrl = config.PUBLIC_URL ?? ""
  try {
    const { protocol } = new URL(publicUrl)
    if (protocol === "https:" || protocol === "http:") return undefined
  } catch {
    /* unset or not a URL */
  }
  return "is a path on this site, which needs PUBLIC_URL set to the site's http(s) address (a reader off the site gets the path on it)"
}

/** The decoded path of a site path, without its leading `/` — the file it names under the site's root (the boot's file check). */
export function sitePictureFile(value: string): string {
  return decodeURIComponent(value).slice(1)
}

/**
 * How a deployment's own picture address reaches a reader. An absolute address
 * (on the media host, or a preset pack's https picture) is served as
 * registered. A path on the site is served:
 *
 *  - as registered, when the reply is read by a browser on the site that
 *    served it (`onSite`: the REST routes): it resolves against whichever of
 *    the deployment's hosts the person is on, and the reply is the same on
 *    every host, so a public cache can share it;
 *  - otherwise absolute, on the ORIGIN of `base` — the reader's base for this
 *    install's own pictures (the MCP lane's `picturesBase`, already the host
 *    the client connected through) — exactly as a browser would resolve the
 *    path there (a root path drops any path `base` has).
 *
 * Only the two reply deciders call this (picker-images-totality.test.ts).
 */
export function sitePictureAddress(address: string, reader: { readonly onSite: boolean; readonly base: string }): string {
  if (!isSitePath(address) || reader.onSite) return address
  try {
    return `${new URL(reader.base).origin}${address}`
  } catch {
    return address
  }
}
