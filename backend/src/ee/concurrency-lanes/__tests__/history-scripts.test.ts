// The lane history scripts' contract on the JS twin (fake-history-redis.ts).
// The same contract runs on a real Redis in history-scripts.redis.test.ts.
import { describe } from "vitest"
import { fakeHistoryClient, makeFakeHistoryStore } from "./fake-history-redis.js"
import { runHistoryScriptsContract } from "./history-scripts-contract.js"

describe("lane history scripts — the contract on the JS twin", () => {
  runHistoryScriptsContract(() => {
    const store = makeFakeHistoryStore()
    const prefix = "cl:test:hist:production:"
    const all = () => [...store.strings.keys(), ...store.hashes.keys(), ...store.sets.keys()]
    return {
      client: fakeHistoryClient(store),
      prefix,
      keys: async () => all().filter((k) => k.startsWith(prefix)),
      ttlOf: async (k) => store.ttls.get(k) ?? null,
      cleanup: async () => undefined,
    }
  })
})
