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

export const WIDGET_URI = {
  jobImage: "ui://nodaro/widget/v3/job-image",
  jobVideo: "ui://nodaro/widget/v3/job-video",
  jobAudio: "ui://nodaro/widget/v3/job-audio",
  jobGeneric: "ui://nodaro/widget/v3/job-generic",
  workflow: "ui://nodaro/widget/v3/workflow",
  gallery: "ui://nodaro/widget/v3/gallery",
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
const WIDGET_CSP = {
  resourceDomains: [
    "https://cdn.nodaro.ai",
    "https://assets.nodaro.ai",
    "https://*.r2.cloudflarestorage.com",
  ],
}

export function registerWidgetResources(server: McpServer): void {
  for (const w of WIDGETS) {
    server.registerResource(
      w.name,
      w.uri,
      {
        title: w.name,
        description: w.description,
        mimeType: "text/html;profile=mcp-app",
        // Listing-level _meta as static default (per spec). Hosts may pre-fetch
        // / audit the security config without calling resources/read first.
        _meta: {
          ui: {
            csp: WIDGET_CSP,
            prefersBorder: true,
          },
        },
      },
      async (uri) => {
        // Log so we can verify in Railway whether Claude is actually invoking
        // resources/read — if these never appear in production logs, the host
        // isn't opting into MCP Apps for our tools.
        // eslint-disable-next-line no-console
        console.log(`[mcp] resources/read ${uri.href}`)
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "text/html;profile=mcp-app",
              text: w.build(),
              _meta: {
                ui: {
                  csp: WIDGET_CSP,
                  prefersBorder: true,
                },
              },
            },
          ],
        }
      },
    )
  }
}
