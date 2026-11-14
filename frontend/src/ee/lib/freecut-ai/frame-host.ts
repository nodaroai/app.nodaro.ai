/**
 * Edit with AI in a frame (`/embed/edit-with-ai`): what the panel takes from
 * the page that frames it. That page, a Nodaro product that embeds the editor,
 * sends NODARO_AI_PANEL_INIT with the editor's capabilities, the videos it can
 * give an address for and the one the editor was opened on, and carries the
 * panel's edit requests on to the editor (`createAiPanelRelay` in
 * `@nodaro/shared/media`).
 *
 * Only the parent window itself may send it, and only from a first-party
 * origin (`isAllowedEmbedParent`, the rule the session handoff uses): framed
 * anywhere else, the panel never starts.
 */
import { AI_PANEL_PROTOCOL_VERSION, NODARO_AI_PANEL_INIT, type AiPanelInitPayload, type AiPanelVideo } from "@nodaro/shared/media"
import { isAllowedEmbedParent } from "@/lib/embed-origins"

/** More than any editor project holds; a longer list is cut, not refused. */
const MAX_VIDEOS = 50
const MAX_NAME = 300
const MAX_CAPABILITIES = 50

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)

/** An address the panel can have a video listened to at: https, or http on a local dev host. */
function isVideoAddress(value: unknown, allowLocalhost: boolean): value is string {
  if (typeof value !== "string" || value.length > 4096) return false
  try {
    const url = new URL(value)
    if (url.protocol === "https:") return true
    return allowLocalhost && url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1")
  } catch {
    return false
  }
}

/** The INIT payload as sent, or null when it is not one this panel can use. */
export function readInitPayload(value: unknown, { allowLocalhost = import.meta.env.DEV } = {}): AiPanelInitPayload | null {
  if (!isRecord(value) || value.version !== AI_PANEL_PROTOCOL_VERSION) return null
  const capabilities = Array.isArray(value.capabilities)
    ? value.capabilities.filter((c): c is string => typeof c === "string" && c.length <= 64).slice(0, MAX_CAPABILITIES)
    : []
  const videos: AiPanelVideo[] = (Array.isArray(value.videos) ? value.videos : [])
    .filter((v): v is { url: string; name: string } => isRecord(v) && isVideoAddress(v.url, allowLocalhost) && typeof v.name === "string" && v.name.length > 0 && v.name.length <= MAX_NAME)
    .slice(0, MAX_VIDEOS)
    .map((v) => ({ url: v.url, name: v.name }))
  // The opened video counts only as one of the videos the panel may edit.
  const opened = videos.some((v) => v.url === value.openedVideoUrl) ? (value.openedVideoUrl as string) : undefined
  const project = typeof value.project === "number" && Number.isFinite(value.project) ? value.project : undefined
  return {
    version: AI_PANEL_PROTOCOL_VERSION,
    capabilities,
    videos,
    ...(opened ? { openedVideoUrl: opened } : {}),
    ...(project !== undefined ? { project } : {}),
  }
}

export interface HostInit {
  readonly origin: string
  readonly init: AiPanelInitPayload
}

/**
 * An INIT from the page that frames this one, on a first-party origin, or null.
 * `parent` is `window.parent`, compared by identity.
 */
export function classifyHostMessage(
  event: { readonly data: unknown; readonly origin: string; readonly source: unknown },
  parent: unknown,
  { selfOrigin, allowLocalhost = import.meta.env.DEV }: { readonly selfOrigin?: string; readonly allowLocalhost?: boolean } = {},
): HostInit | null {
  if (event.source !== parent || parent == null) return null
  if (!isAllowedEmbedParent(event.origin, { allowLocalhost, selfOrigin })) return null
  const data = event.data
  if (!isRecord(data) || data.type !== NODARO_AI_PANEL_INIT) return null
  const init = readInitPayload(data.payload, { allowLocalhost })
  return init ? { origin: event.origin, init } : null
}
