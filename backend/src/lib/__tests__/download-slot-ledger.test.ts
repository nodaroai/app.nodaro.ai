// The download-slot ledger on the JS twin of its scripts (decided 2026-10-08).
// The same contract runs on a real Redis in `download-slot-ledger.redis.test.ts`.
import { describe, it, expect } from "vitest"
import { RedisDownloadLedger } from "../download-slot-ledger.js"
import { makeFakeDownloadClient, makeFakeDownloadStore, type FakeDownloadStore } from "./fake-download-redis.js"
import { runDownloadLedgerContract } from "./download-ledger-contract.js"

describe("RedisDownloadLedger — the contract on the JS twin", () => {
  const store: FakeDownloadStore = makeFakeDownloadStore()
  runDownloadLedgerContract(() => ({
    client: () => makeFakeDownloadClient(store),
    cleanup: async (ids) => {
      for (const id of ids) store.zsets.delete(`download:slots:{${id}}`)
    },
  }))
})

describe("RedisDownloadLedger — failure", () => {
  it("an error from Redis throws (the slots above it decide what to do)", async () => {
    const client = makeFakeDownloadClient(makeFakeDownloadStore())
    client.down = true
    const l = new RedisDownloadLedger({ client: () => client })
    await expect(l.acquire("u", "a", 4)).rejects.toThrow("ECONNREFUSED")
  })

  it("an unanswered command throws after the command timeout instead of hanging the download", async () => {
    const client = makeFakeDownloadClient(makeFakeDownloadStore())
    client.hang = true
    const l = new RedisDownloadLedger({ client: () => client, commandTimeoutMs: 20 })
    await expect(l.acquire("u", "a", 4)).rejects.toThrow(/timed out/)
  })

  it("a client that cannot even be read throws", async () => {
    const l = new RedisDownloadLedger({
      client: () => {
        throw new Error("no client")
      },
    })
    await expect(l.acquire("u", "a", 4)).rejects.toThrow("no client")
  })
})
