/**
 * `tk.social.sendTelegramBotText`: the user's OWN bot writes to the user's
 * OWN connected Telegram account — both resolved here by their owner, so a
 * caller can name no other bot and no other chat. A bot never answers a run
 * its own chat started, and a token Telegram rejects asks the user to
 * reconnect it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest"

const state = vi.hoisted(() => ({
  accounts: [] as Array<Record<string, unknown>>,
  bots: [] as Array<Record<string, unknown>>,
  accountError: null as { message: string } | null,
  botError: null as { message: string } | null,
  reads: [] as Array<{ table: string; filters: Array<[string, unknown]> }>,
  updates: [] as Array<{ table: string; values: Record<string, unknown>; filters: Array<[string, unknown]> }>,
  sends: [] as Array<{ token: string; chatId: string; text: string }>,
  outcome: { status: "sent", messageId: "9" } as Record<string, unknown>,
}))

vi.mock("@/lib/runtime-env.js", () => ({ getRuntimeEnv: () => "staging" }))
vi.mock("@/lib/supabase.js", () => {
  const matching = (rows: Array<Record<string, unknown>>, filters: Array<[string, unknown]>) =>
    rows.filter((row) => filters.every(([column, value]) => row[column] === value))
  return {
    supabase: {
      from: (table: string) => ({
        select: () => {
          const filters: Array<[string, unknown]> = []
          const chain = {
            eq: (column: string, value: unknown) => {
              filters.push([column, value])
              return chain
            },
            maybeSingle: async () => {
              state.reads.push({ table, filters })
              if (state.accountError) return { data: null, error: state.accountError }
              return { data: matching(state.accounts, filters)[0] ?? null, error: null }
            },
            then: (resolve: (value: unknown) => unknown) => {
              state.reads.push({ table, filters })
              return Promise.resolve(state.botError ? { data: null, error: state.botError } : { data: matching(state.bots, filters), error: null }).then(resolve)
            },
          }
          return chain
        },
        update: (values: Record<string, unknown>) => {
          const filters: Array<[string, unknown]> = []
          const chain = {
            eq: (column: string, value: unknown) => {
              filters.push([column, value])
              return chain
            },
            then: (resolve: (value: unknown) => unknown) => {
              state.updates.push({ table, values, filters })
              return Promise.resolve({ data: null, error: null }).then(resolve)
            },
          }
          return chain
        },
      }),
    },
  }
})
vi.mock("@/services/social/encryption.js", () => ({ decryptToken: (cipher: string) => cipher }))
vi.mock("@/services/social/platforms/telegram-text.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/social/platforms/telegram-text.js")>()),
  sendTelegramBotText: async (token: string, chatId: string, text: string) => {
    state.sends.push({ token, chatId, text })
    return state.outcome
  },
}))

import { sendTelegramBotTextFor } from "../social-toolkit.js"
import { buildToolkit } from "../toolkit.js"

const OWNER = "owner-1"
const ACCOUNT = { id: "acc-1", user_id: OWNER, plugin: "telegram-account", runtime_env: "staging", external_id: "777000", status: "active" }
const BOT_A = { id: "conn-a", user_id: OWNER, platform: "telegram", access_token_encrypted: "1111:AAA", created_at: "2026-01-01" }
const BOT_B = { id: "conn-b", user_id: OWNER, platform: "telegram", access_token_encrypted: "2222:BBB", created_at: "2026-02-01" }
const STRANGERS_BOT = { id: "conn-x", user_id: "someone-else", platform: "telegram", access_token_encrypted: "9999:XXX", created_at: "2025-01-01" }
const STRANGERS_ACCOUNT = { ...ACCOUNT, id: "acc-x", user_id: "someone-else", external_id: "555" }

const send = (extra: Record<string, unknown> = {}) =>
  sendTelegramBotTextFor({ userId: OWNER, toAccountId: "acc-1", text: "hi", ...extra } as Parameters<typeof sendTelegramBotTextFor>[0])

beforeEach(() => {
  state.accounts = [ACCOUNT, STRANGERS_ACCOUNT]
  state.bots = [BOT_A, BOT_B, STRANGERS_BOT]
  state.accountError = null
  state.botError = null
  state.reads = []
  state.updates = []
  state.sends = []
  state.outcome = { status: "sent", messageId: "9" }
})

describe("sendTelegramBotTextFor", () => {
  it("the owner's bot writes to the owner's own account — the chat comes from the account row", async () => {
    expect(await send({ connectionId: "conn-b" })).toEqual({ status: "sent", messageId: "9" })
    expect(state.sends).toEqual([{ token: "2222:BBB", chatId: "777000", text: "hi" }])
    expect(state.reads[0]).toEqual({
      table: "plugin_account_secrets",
      filters: [["id", "acc-1"], ["user_id", OWNER], ["plugin", "telegram-account"], ["runtime_env", "staging"]],
    })
  })

  it("without a named bot, the owner's default — the oldest one", async () => {
    await send()
    expect(state.sends[0]!.token).toBe("1111:AAA")
  })

  it("another user's account or bot is not there to use", async () => {
    expect(await send({ toAccountId: "acc-x" })).toEqual({ status: "no_account" })
    expect(await send({ connectionId: "conn-x" })).toEqual({ status: "not_connected" })
    expect(state.sends).toEqual([])
  })

  it("an account an admin switched off has no one to write to", async () => {
    state.accounts = [{ ...ACCOUNT, status: "disabled" }]
    expect(await send()).toEqual({ status: "no_account" })
    expect(state.sends).toEqual([])
  })

  it("never answers a run started in the chat of ANY of the owner's bots — two bots would answer each other for ever", async () => {
    expect(await send({ startedFromChatId: "1111" })).toEqual({ status: "own_chat" })
    expect(await send({ connectionId: "conn-b", startedFromChatId: "1111" })).toEqual({ status: "own_chat" })
    expect(state.sends).toEqual([])
    // Another person's bot is not the owner's: answering a run its chat started is fine.
    expect(await send({ connectionId: "conn-b", startedFromChatId: "9999" })).toEqual({ status: "sent", messageId: "9" })
    expect(state.sends.map((s) => s.token)).toEqual(["2222:BBB"])
  })

  it("a token Telegram rejects reads as a bot to connect again, and is marked for reconnecting", async () => {
    state.outcome = { status: "token_rejected" }
    expect(await send()).toEqual({ status: "not_connected" })
    expect(state.updates).toEqual([
      { table: "social_connections", values: { reconnect_needed: true, updated_at: expect.any(String) }, filters: [["id", "conn-a"], ["user_id", OWNER]] },
    ])
  })

  it("takes exactly as much text as Telegram does in one message", async () => {
    const { TELEGRAM_TEXT_LIMIT } = await import("@/services/social/platforms/telegram-text.js")
    await expect(send({ text: "x".repeat(TELEGRAM_TEXT_LIMIT) })).resolves.toEqual({ status: "sent", messageId: "9" })
    await expect(send({ text: "x".repeat(TELEGRAM_TEXT_LIMIT + 1) })).rejects.toThrow(/characters/)
    await expect(send({ text: "   " })).rejects.toThrow(/characters/)
  })

  it("a failed read throws rather than reading as no account or no bot", async () => {
    state.accountError = { message: "db down" }
    await expect(send()).rejects.toThrow(/db down/)
    state.accountError = null
    state.botError = { message: "db down again" }
    await expect(send()).rejects.toThrow(/db down again/)
  })

  it("is on the toolkit, under social", () => {
    expect(buildToolkit().social?.sendTelegramBotText).toBe(sendTelegramBotTextFor)
  })
})
