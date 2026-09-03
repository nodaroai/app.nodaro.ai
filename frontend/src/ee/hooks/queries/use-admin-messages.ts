import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query"
import { hasAdmin } from "@/lib/edition"
import { queryKeys } from "@/lib/query-keys"
import { getAuthHeaders } from "@/lib/api"

/**
 * Admin → user email: templates, history, preview, send.
 *
 * Its own file rather than an addition to `use-admin-queries.ts`, which is
 * already 1,296 lines — well past the 800-line ceiling the house rules set.
 */

// ---------------------------------------------------------------------------
// Types — mirror the route's wire shape
// ---------------------------------------------------------------------------

export type AdminMessageStatus = "sending" | "sent" | "failed"

export interface AdminMessage {
  readonly id: string
  readonly userId: string | null
  readonly recipientEmail: string
  readonly sentByAdminId: string | null
  readonly sentByAdminEmail: string | null
  readonly templateId: string
  readonly variables: Record<string, unknown>
  readonly renderedSubject: string
  readonly renderedBody: string
  readonly imageUrl: string | null
  readonly loopsMessageId: string | null
  readonly status: AdminMessageStatus
  readonly errorMessage: string | null
  readonly sentAt: string
}

export interface AdminMessageTemplate {
  readonly id: string
  readonly label: string
  readonly description: string
  /** Whether the Loops design for this template has a screenshot-link block. */
  readonly supportsImage: boolean
  /** False = the subject lives in the Loops template, not in the admin's hands. */
  readonly subjectIsAuthored: boolean
}

export interface AdminMessageTemplates {
  /** False on a deployment with no LOOPS_API_KEY — sending cannot work at all. */
  readonly loopsConfigured: boolean
  readonly dailyLimit: number
  readonly templates: readonly AdminMessageTemplate[]
}

export interface AdminMessageHistory {
  readonly data: readonly AdminMessage[]
  readonly total: number
  /** True before migration 375 reaches this environment's database. */
  readonly unavailable?: boolean
}

export interface AdminMessagePreview {
  readonly subject: string
  readonly bodyHtml: string
  readonly subjectIsAuthored: boolean
}

/**
 * An error that keeps the server's `code`, not just its prose.
 *
 * The message alone was not enough: `send_unconfirmed` (the provider never
 * answered, so the email may well have been delivered) and `send_failed` (it
 * definitely was not) call for opposite things from the UI, and a bare `Error`
 * flattened them into the same toast — leaving Send armed on a draft that may
 * already be in someone's inbox.
 */
export class AdminMessageError extends Error {
  readonly code: string
  constructor(message: string, code: string) {
    super(message)
    this.name = "AdminMessageError"
    this.code = code
  }
}

/**
 * The server's own message when it has one — `daily_limit_reached` and
 * `email_not_configured` both explain themselves, and a generic fallback would
 * throw that explanation away.
 */
async function adminError(res: Response, fallback: string): Promise<AdminMessageError> {
  const body = (await res.json().catch(() => null)) as
    | { error?: { message?: string; code?: string } }
    | null
  return new AdminMessageError(body?.error?.message || fallback, body?.error?.code ?? "unknown")
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function useAdminMessageTemplates() {
  return useQuery({
    queryKey: queryKeys.admin.messageTemplates(),
    queryFn: async (): Promise<AdminMessageTemplates> => {
      const res = await fetch("/v1/admin/message-templates", { headers: await getAuthHeaders() })
      if (!res.ok) throw await adminError(res, "Failed to load message templates")
      const json = await res.json()
      return json.data as AdminMessageTemplates
    },
    enabled: hasAdmin(),
    staleTime: 5 * 60_000,
  })
}

export function useAdminUserMessages(userId: string, enabled = true) {
  return useQuery({
    queryKey: queryKeys.admin.userMessages(userId),
    queryFn: async (): Promise<AdminMessageHistory> => {
      const res = await fetch(`/v1/admin/users/${userId}/messages`, {
        headers: await getAuthHeaders(),
      })
      if (!res.ok) throw await adminError(res, "Failed to load the message history")
      return (await res.json()) as AdminMessageHistory
    },
    enabled: enabled && hasAdmin() && Boolean(userId),
    staleTime: 15_000,
  })
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export interface ComposeInput {
  readonly userId: string
  readonly templateId: string
  readonly variables: Record<string, unknown>
}

export function useAdminMessagePreviewMutation() {
  return useMutation({
    mutationFn: async ({ userId, templateId, variables }: ComposeInput): Promise<AdminMessagePreview> => {
      const res = await fetch(`/v1/admin/users/${userId}/messages/preview`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
        body: JSON.stringify({ templateId, variables }),
      })
      if (!res.ok) throw await adminError(res, "Could not render a preview")
      return (await res.json()).data as AdminMessagePreview
    },
  })
}

export function useAdminSendMessageMutation() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ userId, templateId, variables }: ComposeInput): Promise<AdminMessage> => {
      const res = await fetch(`/v1/admin/users/${userId}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...(await getAuthHeaders()) },
        body: JSON.stringify({ templateId, variables }),
      })
      if (!res.ok) throw await adminError(res, "Failed to send the message")
      return (await res.json()).data as AdminMessage
    },
    // onSettled, NOT onSuccess: a refused send still WROTE a row (status
    // 'failed'), and that row is the point of the log. Refreshing only on
    // success would hide exactly the history an admin most needs to see.
    onSettled: (_data, _err, vars) => {
      qc.invalidateQueries({ queryKey: queryKeys.admin.userMessages(vars.userId) })
    },
  })
}

// ---------------------------------------------------------------------------
// Screenshot upload
// ---------------------------------------------------------------------------

/** Mirrors the route's server-side cap. Checked here only to fail fast. */
export const MAX_SCREENSHOT_BYTES = 5 * 1024 * 1024
export const ACCEPTED_SCREENSHOT_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/avif",
  "image/gif",
] as const

/**
 * Upload one screenshot and get back its public URL.
 *
 * Deliberately `/v1/upload/image` and not the shared `uploadImage()` helper:
 * that one posts to `/v1/upload`, which creates an asset record and bills the
 * bytes to the uploader's storage quota. An admin attaching a support
 * screenshot should not have it appear in their own asset library, nor eat
 * their quota. This endpoint just stores the bytes under an unguessable
 * `uploads/<uuid>` key and returns the public URL — which is what an email
 * client needs, since it cannot authenticate.
 */
export async function uploadAdminScreenshot(file: File): Promise<string> {
  if (!ACCEPTED_SCREENSHOT_TYPES.includes(file.type as (typeof ACCEPTED_SCREENSHOT_TYPES)[number])) {
    throw new Error("Use a PNG, JPEG, WebP, AVIF or GIF image")
  }
  if (file.size > MAX_SCREENSHOT_BYTES) {
    throw new Error("That image is over 5 MB — please shrink it first")
  }

  const form = new FormData()
  form.append("file", file)
  const res = await fetch("/v1/upload/image", {
    method: "POST",
    headers: await getAuthHeaders(),
    body: form,
  })
  if (!res.ok) throw await adminError(res, "Upload failed")
  const { url } = (await res.json()) as { url?: string }
  if (!url) throw new Error("Upload returned no URL")
  return url
}
