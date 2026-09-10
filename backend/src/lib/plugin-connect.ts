import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto"
import { redis } from "./queue.js"

/**
 * The Nodaro half of the plugin connect handshake.
 *
 * A plugin that lives inside another app (Figma today) cannot receive an OAuth
 * redirect: its UI is an iframe with no address of its own, so `?code=` has
 * nowhere to land. Instead the plugin opens a short-lived session here, sends
 * the user to the ordinary consent screen with the session id as `state`, and
 * polls the session until the user has finished — the shape a TV uses to sign
 * into a streaming service, user code included.
 *
 * Three secrets with three different owners, deliberately:
 *
 * - the session id doubles as OAuth `state`, travels through the browser
 *   (history, referers, the callback URL) and is treated as public;
 * - the poll key never leaves the plugin and is what authorises reading the
 *   outcome — only its hash is stored, and a wrong key is answered exactly
 *   like an unknown session;
 * - the user code is shown by the plugin and typed by the user on the page the
 *   consent screen lands on. It is what ties the person who pressed Allow to
 *   the plugin that opened the session: a session id mailed to a victim gets
 *   the attacker nothing, because the victim never sees the attacker's code
 *   (RFC 8628 §5.4). Five wrong guesses settle the session as denied.
 *
 * What a grant stores is the consent itself — app, user, scopes — never a
 * bearer token. The token is minted at the one authorised read, after an
 * atomic claim, so two overlapping polls cannot both mint.
 *
 * Sessions live in Redis (the browser callback and the plugin's polls can land
 * on different processes). Note that the one-shot authorization codes this
 * flow redeems live in `oauth-codes.ts`, which is per-process today — the
 * same constraint `POST /v1/oauth/token` already has, not a new one. Every
 * record carries its own expiry, so a status change re-sets the key with the
 * time that is left rather than restarting the clock.
 */

export const PLUGIN_CONNECT_TTL_SECONDS = 10 * 60
export const USER_CODE_MAX_ATTEMPTS = 5

export const PLUGIN_CLIENTS = ["figma"] as const
export type PluginClient = (typeof PLUGIN_CLIENTS)[number]

export interface PluginGrant {
  appId: string
  userId: string
  scopes: string[]
}

/**
 * pending        opened, nobody has consented yet
 * awaiting_code  the consent screen came back with a valid code; the grant is
 *                held until the user types the plugin's code
 * granted        confirmed; the next authorised poll mints and deletes
 * denied         declined, or too many wrong codes; the next poll reports it once
 */
export type SessionStatus = "pending" | "awaiting_code" | "granted" | "denied"

interface SessionRecord {
  client: PluginClient
  pollKeyHash: string
  userCodeHash: string
  status: SessionStatus
  expiresAt: number
  attempts: number
  grant?: PluginGrant
}

export interface CreatedSession {
  sessionId: string
  pollKey: string
  userCode: string
  expiresIn: number
}

export type PollResult =
  | { status: "pending" }
  | { status: "granted"; grant: PluginGrant; restore: () => Promise<void> }
  | { status: "denied" }
  | { status: "unknown" }

export type ConfirmResult = "granted" | "wrong" | "denied" | "unknown"

/** No vowels, no 0/O/1/I — a code the user reads off one screen and types on another. */
const USER_CODE_ALPHABET = "BCDFGHJKMNPQRSTVWXYZ23456789"
const USER_CODE_LENGTH = 8

const keyOf = (sessionId: string) => `plugin-connect:${sessionId}`
const sha256 = (value: string) => createHash("sha256").update(value).digest("hex")

/** Typed codes arrive with any casing, spacing or dashes the user felt like. */
export function normalizeUserCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "")
}

function generateUserCode(): string {
  let code = ""
  for (let i = 0; i < USER_CODE_LENGTH; i++) code += USER_CODE_ALPHABET[randomInt(USER_CODE_ALPHABET.length)]
  return `${code.slice(0, 4)}-${code.slice(4)}`
}

function hashesMatch(storedHex: string, presented: string): boolean {
  const expected = Buffer.from(storedHex, "hex")
  const actual = Buffer.from(sha256(presented), "hex")
  return expected.length === actual.length && timingSafeEqual(expected, actual)
}

async function read(sessionId: string): Promise<SessionRecord | null> {
  const raw = await redis.get(keyOf(sessionId))
  if (!raw) return null
  let record: SessionRecord
  try {
    record = JSON.parse(raw) as SessionRecord
  } catch {
    await redis.del(keyOf(sessionId))
    return null
  }
  if (typeof record.expiresAt !== "number" || record.expiresAt <= Date.now()) {
    await redis.del(keyOf(sessionId))
    return null
  }
  return record
}

async function write(sessionId: string, record: SessionRecord): Promise<void> {
  const ttl = Math.max(Math.ceil((record.expiresAt - Date.now()) / 1000), 1)
  await redis.set(keyOf(sessionId), JSON.stringify(record), "EX", ttl)
}

export async function createSession(client: PluginClient): Promise<CreatedSession> {
  const sessionId = `pcs_${randomBytes(24).toString("hex")}`
  const pollKey = randomBytes(32).toString("base64url")
  const userCode = generateUserCode()
  await write(sessionId, {
    client,
    pollKeyHash: sha256(pollKey),
    userCodeHash: sha256(normalizeUserCode(userCode)),
    status: "pending",
    expiresAt: Date.now() + PLUGIN_CONNECT_TTL_SECONDS * 1000,
    attempts: 0,
  })
  return { sessionId, pollKey, userCode, expiresIn: PLUGIN_CONNECT_TTL_SECONDS }
}

/** Which plugin a session belongs to and where it stands, for the callback and the code form. */
export async function peekSession(
  sessionId: string,
): Promise<{ client: PluginClient; status: SessionStatus; attempts: number } | null> {
  const record = await read(sessionId)
  return record ? { client: record.client, status: record.status, attempts: record.attempts } : null
}

/**
 * The consent screen came back with a valid code for the plugin's app. The
 * grant is held, not released — the user still has to type the code the
 * plugin is showing. False when the session is not pending.
 */
export async function holdGrant(sessionId: string, grant: PluginGrant): Promise<boolean> {
  const record = await read(sessionId)
  if (!record || record.status !== "pending") return false
  await write(sessionId, { ...record, status: "awaiting_code", grant })
  return true
}

/**
 * The user typed a code. Right code releases the held grant; a wrong one
 * counts, and the fifth settles the session as denied so a mailed link cannot
 * be guessed through.
 */
export async function confirmUserCode(sessionId: string, typed: string): Promise<ConfirmResult> {
  const record = await read(sessionId)
  if (!record || record.status !== "awaiting_code") return "unknown"

  if (hashesMatch(record.userCodeHash, normalizeUserCode(typed))) {
    await write(sessionId, { ...record, status: "granted" })
    return "granted"
  }

  const attempts = record.attempts + 1
  if (attempts >= USER_CODE_MAX_ATTEMPTS) {
    await write(sessionId, { ...record, status: "denied", attempts, grant: undefined })
    return "denied"
  }
  await write(sessionId, { ...record, attempts })
  return "wrong"
}

/** The user declined on the consent screen. False when the session is already settled. */
export async function markDenied(sessionId: string): Promise<boolean> {
  const record = await read(sessionId)
  if (!record || (record.status !== "pending" && record.status !== "awaiting_code")) return false
  await write(sessionId, { ...record, status: "denied", grant: undefined })
  return true
}

/**
 * The plugin's read. Pending (including "waiting for the code") is left for
 * the next poll. A settled session is handed over once: the claim is an atomic
 * delete, so of two overlapping polls exactly one gets the grant — and that one
 * gets a `restore` to put the record back if minting fails, so a transient
 * database error costs a retry, not the whole consent.
 */
export async function pollSession(sessionId: string, pollKey: string): Promise<PollResult> {
  const record = await read(sessionId)
  if (!record) return { status: "unknown" }
  if (!hashesMatch(record.pollKeyHash, pollKey)) return { status: "unknown" }

  if (record.status === "pending" || record.status === "awaiting_code") return { status: "pending" }

  const claimed = (await redis.del(keyOf(sessionId))) === 1
  if (!claimed) return { status: "unknown" }

  if (record.status === "granted" && record.grant) {
    const grant = record.grant
    return { status: "granted", grant, restore: () => write(sessionId, record) }
  }
  return { status: "denied" }
}
