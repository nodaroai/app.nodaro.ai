/** Request schemas of `/v1/webhook-endpoints` — shared by the routes and their OpenAPI entries. */
import { z } from "zod"
import { isLocalOrPrivateHostname } from "@nodaro/shared/workflow"
import { isConfiguredStorageUrl } from "../own-storage-url.js"
import { isThisInstallAddress } from "./own-host.js"
import { WEBHOOK_DELIVERY_STATUSES, WEBHOOK_JOB_EVENTS } from "./event-types.js"

/**
 * C0 and C1 control characters (and DEL): never part of an address or a
 * label, and what a terminal reads as an escape sequence when a CLI prints
 * the value.
 */
const CONTROL_CHARACTERS = /[\u0000-\u001F\u007F-\u009F]/

export const URL_MAX_LENGTH = 2048

/**
 * Names that only mean something inside a private network: never a public
 * receiver, refused at registration. A single label (`intranet`, `db`) and
 * the special-use and private-use suffixes. A public name that resolves to a
 * private address is refused at the send instead (safeFetch checks every
 * answer).
 */
const PRIVATE_NAME_SUFFIXES = [".internal", ".local", ".localhost", ".lan", ".home.arpa", ".intranet", ".corp", ".private"]

export function isPrivateName(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "")
  // An IP literal is judged by its address (isLocalOrPrivateHostname).
  if (host.startsWith("[") || /^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false
  if (!host.includes(".")) return true
  return PRIVATE_NAME_SUFFIXES.some((suffix) => host.endsWith(suffix) || host === suffix.slice(1))
}

function parsed(value: string): URL | null {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

/**
 * Where deliveries go: https only, to a public host, with no credentials in
 * the URL. The syntactic gate; the authoritative one is the send itself
 * (safeFetch resolves the name on every attempt and refuses a private,
 * loopback, link-local or metadata address). There is no http:// or
 * localhost exception: the server makes the request, so it would reach the
 * server's own network. Test locally through a tunnel.
 *
 * The value stored is the address normalized (`URL.href`: lower-case host,
 * default port dropped, path percent-encoded), so two spellings of one address
 * are one address to the per-account uniqueness rule.
 */
export const webhookUrl = z
  .string()
  .trim()
  .min(1)
  .max(URL_MAX_LENGTH)
  .refine((value) => !CONTROL_CHARACTERS.test(value), "url must not contain control characters")
  .refine((value) => {
    const url = parsed(value)
    return url !== null && url.protocol === "https:" && url.hostname.length > 0
  }, "url must be an https:// address")
  .refine((value) => {
    const url = parsed(value)
    return url === null || (url.username === "" && url.password === "")
  }, "url must not carry a user name or password")
  .refine((value) => {
    const url = parsed(value)
    return url === null || (!isLocalOrPrivateHostname(url.hostname) && !isPrivateName(url.hostname) && !isConfiguredStorageUrl(url))
  }, "url must be a public address (not localhost, a private network or name, or this server's storage)")
  .refine((value) => {
    const url = parsed(value)
    return url === null || !isThisInstallAddress(url)
  }, "url must not be an address of this Nodaro server itself")
  .transform((value) => (parsed(value) as URL).href)
  .refine((href) => href.length <= URL_MAX_LENGTH, `url must be at most ${URL_MAX_LENGTH} characters once normalized`)

const events = z
  .array(z.enum(WEBHOOK_JOB_EVENTS))
  .min(1)
  .max(WEBHOOK_JOB_EVENTS.length * 2)
  .transform((list) => [...new Set(list)])

const description = z
  .string()
  .trim()
  .max(500)
  .refine((value) => !CONTROL_CHARACTERS.test(value), "description must not contain control characters (one line of text)")

export const idParams = z.object({ id: z.string().uuid() })

export const createEndpointBody = z.object({
  url: webhookUrl,
  events: events.optional(),
  description: description.optional(),
})

export const updateEndpointBody = z
  .object({
    url: webhookUrl.optional(),
    events: events.optional(),
    isActive: z.boolean().optional(),
    /** `null` clears it. */
    description: description.nullable().optional(),
  })
  .refine(
    (body) => body.url !== undefined || body.events !== undefined || body.isActive !== undefined || body.description !== undefined,
    { message: "At least one field must be provided" },
  )

/** How long the replaced secret keeps signing beside the new one, by default and at most. */
export const DEFAULT_GRACE_SECONDS = 24 * 60 * 60
export const MAX_GRACE_SECONDS = 7 * 24 * 60 * 60

export const rotateSecretBody = z
  .object({
    /**
     * Seconds the replaced secret keeps signing beside the new one, so the
     * receiver can be switched over without a gap. Default a day; 0 ends it
     * at once (a secret that leaked).
     */
    gracePeriodSeconds: z.number().int().min(0).max(MAX_GRACE_SECONDS).optional(),
  })
  .strict()

export const deliveryParams = z.object({ id: z.string().uuid(), deliveryId: z.string().uuid() })

export const listDeliveriesQuery = z.object({
  status: z.enum(WEBHOOK_DELIVERY_STATUSES).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().max(200).optional(),
})
