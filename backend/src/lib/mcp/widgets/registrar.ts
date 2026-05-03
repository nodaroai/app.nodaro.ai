/**
 * Registers all MCP UI resources (widget templates) on a per-request server.
 *
 * Per the MCP Apps spec (SEP-1865), tools that produce UI declare a static
 * `_meta.ui.resourceUri` on the tool definition. The host then fetches that
 * URI via `resources/read` to get the iframe HTML.
 *
 * This module owns the URI scheme `ui://nodaro/widget/v3/{kind}` and keeps the
 * widget HTML on the server side. Per-call data is delivered to the iframe
 * via the host's `ui/notifications/tool-input` and
 * `ui/notifications/tool-result` events (NOT embedded in the HTML).
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { buildSingleJobWidget } from "./single-job.js"
import { buildWorkflowWidgetTemplate } from "./workflow.js"
import { buildGalleryWidgetTemplate } from "./gallery.js"
import { buildUploadImageWidget } from "./upload-image.js"
import { config } from "../../config.js"

export const WIDGET_URI = {
  jobImage: "ui://nodaro/widget/v3/job-image",
  jobVideo: "ui://nodaro/widget/v3/job-video",
  jobAudio: "ui://nodaro/widget/v3/job-audio",
  jobGeneric: "ui://nodaro/widget/v3/job-generic",
  workflow: "ui://nodaro/widget/v3/workflow",
  gallery: "ui://nodaro/widget/v3/gallery",
  uploadImage: "ui://nodaro/widget/v3/upload-image",
} as const

const WIDGETS: Array<{
  name: string
  uri: string
  description: string
  build: () => string
}> = [
  {
    name: "widget-job-image",
    uri: WIDGET_URI.jobImage,
    description: "Inline preview for image generation jobs (progress + result)",
    build: () => buildSingleJobWidget("image"),
  },
  {
    name: "widget-job-video",
    uri: WIDGET_URI.jobVideo,
    description: "Inline preview for video generation jobs (progress + result)",
    build: () => buildSingleJobWidget("video"),
  },
  {
    name: "widget-job-audio",
    uri: WIDGET_URI.jobAudio,
    description: "Inline preview for audio generation jobs (progress + result)",
    build: () => buildSingleJobWidget("audio"),
  },
  {
    name: "widget-job-generic",
    uri: WIDGET_URI.jobGeneric,
    description: "Inline status card for generic jobs without media preview",
    build: () => buildSingleJobWidget("generic"),
  },
  {
    name: "widget-workflow",
    uri: WIDGET_URI.workflow,
    description: "Workflow run status: per-node pills + outputs gallery",
    build: () => buildWorkflowWidgetTemplate(),
  },
  {
    name: "widget-gallery",
    uri: WIDGET_URI.gallery,
    description: "Asset gallery: paginated grid + detail view + Use button",
    build: () => buildGalleryWidgetTemplate(),
  },
  {
    name: "widget-upload-image",
    uri: WIDGET_URI.uploadImage,
    description: "In-iframe image upload: file picker + drop-zone + auto-announce URL on success",
    build: () => buildUploadImageWidget(),
  },
]

/**
 * CSP allowlist for our widgets — they load images/videos/audio from our
 * Cloudflare-fronted CDN domain (cdn.nodaro.ai) and from the raw R2 bucket
 * URL we sometimes use. No outbound fetch/XHR/WebSocket needed since the
 * iframe only talks to the host via postMessage.
 *
 * NOTE: the widget's <img>/<video> elements load from `cdn.nodaro.ai`, not
 * `assets.nodaro.ai`. Getting that domain wrong here causes Claude.ai to
 * block image rendering with "Refused to load — violates img-src directive."
 */
// PUBLIC_URL is the host the upload widget POSTs the picked file to
// (`/v1/upload-page/:token`). connectDomains feeds the iframe's
// connect-src CSP — without it the host blocks the fetch with a CSP
// violation. Other widgets don't use connect, so the extra entry is
// harmless for them. Stripping the trailing slash so the entry parses
// cleanly into a CSP source.
const WIDGET_CSP = {
  resourceDomains: [
    "https://cdn.nodaro.ai",
    "https://assets.nodaro.ai",
    "https://*.r2.cloudflarestorage.com",
  ],
  connectDomains: [config.PUBLIC_URL.replace(/\/+$/, "")],
}

/**
 * Historical URI prefixes we register at, in addition to the current `/v3/`.
 *
 * Claude.ai caches `tools/list` aggressively — once a connector is paired,
 * the host may keep using the OLD `_meta.ui.resourceUri` from the cached
 * tool definition for hours/days, even after the server publishes new
 * tool registrations. If we don't keep the old resource URIs alive, those
 * users see "Resource ui://nodaro/widget/job-image not found" errors.
 *
 * Each historical prefix maps to the SAME widget HTML — only the URI
 * differs. Add a new entry if we ever bump the version again.
 */
const LEGACY_URI_PREFIXES = [
  "ui://nodaro/widget/", // v0 (initial release)
  "ui://nodaro/widget/v2/", // v2 cache-bust
] as const

const CURRENT_URI_PREFIX = "ui://nodaro/widget/v3/"

const KIND_OF = {
  jobImage: "job-image",
  jobVideo: "job-video",
  jobAudio: "job-audio",
  jobGeneric: "job-generic",
  workflow: "workflow",
  gallery: "gallery",
} as const

export function registerWidgetResources(server: McpServer): void {
  for (const w of WIDGETS) {
    // Derive the kind suffix from the current URI so we can mirror it on each
    // legacy prefix.
    const kind = w.uri.replace(CURRENT_URI_PREFIX, "")
    const allUris = [
      w.uri,
      ...LEGACY_URI_PREFIXES.map((prefix) => `${prefix}${kind}`),
    ]
    for (let i = 0; i < allUris.length; i++) {
      const uri = allUris[i]!
      // Resource registration name must be unique within the server — suffix
      // the legacy entries so they don't collide with the current.
      const name = i === 0 ? w.name : `${w.name}-legacy${i}`
      server.registerResource(
        name,
        uri,
        {
          title: w.name,
          description: w.description,
          mimeType: "text/html;profile=mcp-app",
          _meta: {
            ui: { csp: WIDGET_CSP, prefersBorder: false },
          },
        },
        async (resolvedUri) => {
          // eslint-disable-next-line no-console
          console.log(`[mcp] resources/read ${resolvedUri.href}`)
          return {
            contents: [
              {
                uri: resolvedUri.href,
                mimeType: "text/html;profile=mcp-app",
                text: w.build(),
                _meta: {
                  ui: { csp: WIDGET_CSP, prefersBorder: false },
                },
              },
            ],
          }
        },
      )
    }
  }
  // Reference the kind constants so eslint/tsc don't flag them unused; they
  // exist as documentation of what suffix shape the URI tail uses.
  void KIND_OF
}
