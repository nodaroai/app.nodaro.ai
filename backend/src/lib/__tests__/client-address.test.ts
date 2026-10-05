import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { createHash, createHmac } from "node:crypto"
import {
  assertClientAddressConfig,
  clientAddress,
  clientNetworkHash,
  clientNetworkKey,
  describeClientAddressConfig,
  networkHash,
  networkHashScheme,
  rateLimitAddressKey,
  resolveClientAddress,
  type AddressedRequest,
} from "../client-address.js"

/** Behind the bundled Caddy: the socket is loopback and Caddy wrote one XFF entry. */
function viaCaddy(xff: string | undefined, extra: Record<string, string> = {}): AddressedRequest {
  return {
    headers: { ...(xff === undefined ? {} : { "x-forwarded-for": xff }), ...extra },
    ip: "127.0.0.1",
    socket: { remoteAddress: "127.0.0.1" },
  }
}

/** Straight from a peer, no Caddy (the mcp.* host on Railway). */
function direct(socket: string, headers: Record<string, string> = {}): AddressedRequest {
  return { headers, ip: socket, socket: { remoteAddress: socket } }
}

const ENV_KEYS = ["CLIENT_IP_HEADER", "CLIENT_IP_HEADER_FROM", "NETWORK_HASH_SECRET"] as const
let saved: Record<string, string | undefined> = {}

beforeEach(() => {
  saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
  for (const k of ENV_KEYS) process.env[k] = ""
})
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

function railway() {
  process.env.CLIENT_IP_HEADER = "x-real-ip"
  process.env.CLIENT_IP_HEADER_FROM = "100.64.0.0/10"
}

describe("nearest untrusted hop (no platform edge configured)", () => {
  it("is Caddy's single entry — what every reader used before", () => {
    expect(resolveClientAddress(viaCaddy("203.0.113.7"))).toMatchObject({ address: "203.0.113.7", source: "hop" })
  })

  it("skips a client-chosen leftmost entry in an appended chain", () => {
    // A hop that APPENDS (nginx $proxy_add_x_forwarded_for) keeps the client's
    // forged value on the left; the address it saw is the rightmost one.
    expect(clientAddress(viaCaddy("9.9.9.9, 203.0.113.7"))).toBe("203.0.113.7")
  })

  it("falls back to the leftmost entry when every hop is internal (LAN / compose self-host)", () => {
    expect(clientAddress(viaCaddy("192.168.1.20"))).toBe("192.168.1.20")
    expect(clientAddress(viaCaddy("192.168.1.20, 10.0.0.2"))).toBe("192.168.1.20")
  })

  it("is the socket when nothing is forwarded", () => {
    expect(clientAddress(viaCaddy(undefined))).toBe("127.0.0.1")
    expect(clientAddress({ headers: {} })).toBeNull()
  })

  it("treats a v4-mapped loopback socket as loopback", () => {
    expect(clientAddress(direct("::ffff:127.0.0.1", { "x-forwarded-for": "203.0.113.7" }))).toBe("203.0.113.7")
  })

  it("never trusts X-Real-IP without configuration", () => {
    expect(clientAddress(viaCaddy("203.0.113.7", { "x-real-ip": "198.51.100.1" }))).toBe("203.0.113.7")
  })

  it("never reports a Cloudflare server as the client", () => {
    expect(resolveClientAddress(viaCaddy("172.64.1.1"))).toMatchObject({ address: null, source: "unknown", hop: "172.64.1.1" })
  })
})

describe("a configured platform edge (Railway: x-real-ip from 100.64.0.0/10)", () => {
  beforeEach(railway)

  it("reads the edge's statement when Caddy's entry is the edge proxy", () => {
    const detail = resolveClientAddress(viaCaddy("100.64.3.4", { "x-real-ip": "85.65.91.64" }))
    expect(detail).toEqual({ address: "85.65.91.64", source: "edge-header", hop: "100.64.3.4", header: "x-real-ip", cloudflare: false })
  })

  it("reads it on the direct path, where the socket IS the edge proxy", () => {
    const req = direct("100.64.9.9", { "x-forwarded-for": "6.6.6.6, 7.7.7.7", "x-real-ip": "85.65.91.64" })
    expect(clientAddress(req)).toBe("85.65.91.64")
  })

  it("ignores the header from a hop that is not the edge (a forged header from anywhere else)", () => {
    expect(clientAddress(viaCaddy("203.0.113.7", { "x-real-ip": "198.51.100.1" }))).toBe("203.0.113.7")
  })

  it("is UNKNOWN — never the shared proxy — when the edge states nothing usable", () => {
    for (const stated of [undefined, "", "garbage", "10.0.0.5", "100.64.1.1", "127.0.0.1", "172.64.1.1"]) {
      const extra: Record<string, string> = stated === undefined ? {} : { "x-real-ip": stated }
      expect(resolveClientAddress(viaCaddy("100.64.3.4", extra)), String(stated)).toMatchObject({
        address: null,
        source: "unknown",
        hop: "100.64.3.4",
      })
    }
  })

  it("leaves internal calls on loopback alone", () => {
    expect(clientAddress(viaCaddy(undefined))).toBe("127.0.0.1")
  })

  it("is switched off by none / off / empty — never a header literally named 'none'", () => {
    for (const off of ["none", "off", "", "  NONE "]) {
      process.env.CLIENT_IP_HEADER = off
      expect(resolveClientAddress(viaCaddy("100.64.3.4", { "x-real-ip": "85.65.91.64" })), off).toMatchObject({
        address: "100.64.3.4",
        source: "hop",
        header: null,
      })
    }
  })

  it("never trusts the header without a range; 'any' is the explicit from-every-hop", () => {
    process.env.CLIENT_IP_HEADER_FROM = ""
    // Behind the bundled Caddy a client's own X-Real-IP arrives untouched.
    expect(clientAddress(viaCaddy("203.0.113.7", { "x-real-ip": "6.6.6.6" }))).toBe("203.0.113.7")
    expect(() => assertClientAddressConfig()).toThrow(/CLIENT_IP_HEADER_FROM/)
    process.env.CLIENT_IP_HEADER_FROM = "any"
    expect(clientAddress(viaCaddy("203.0.113.7", { "x-real-ip": "198.51.100.1" }))).toBe("198.51.100.1")
    expect(() => assertClientAddressConfig()).not.toThrow()
  })

  it("marks a Cloudflare server stated by the edge, so readers cannot be opted out by it", () => {
    const detail = resolveClientAddress(viaCaddy("100.64.3.4", { "x-real-ip": "2a06:98c0:3600::103" }))
    expect(detail).toMatchObject({ address: null, source: "unknown", cloudflare: true })
    expect(resolveClientAddress(viaCaddy("100.64.3.4")).cloudflare).toBe(false)
  })

  it("reads a repeated header as one joined value (and refuses it)", () => {
    const req: AddressedRequest = { headers: { "x-forwarded-for": "100.64.3.4", "x-real-ip": ["1.1.1.1", "2.2.2.2"] }, ip: "127.0.0.1" }
    expect(resolveClientAddress(req)).toMatchObject({ address: null, source: "unknown" })
  })
})

describe("network keys and rate-limit identities", () => {
  beforeEach(railway)

  it("keeps an internal IPv6 address whole — on a LAN one /64 is the whole office", () => {
    process.env.CLIENT_IP_HEADER = ""
    expect(clientNetworkKey(viaCaddy("fd12::5"))).toBe("fd12::5")
    expect(rateLimitAddressKey(viaCaddy("fd12::5"))).not.toBe(rateLimitAddressKey(viaCaddy("fd12::6")))
  })

  it("keys IPv6 by its /64", () => {
    const a = clientNetworkKey(viaCaddy("100.64.3.4", { "x-real-ip": "2001:db8:abcd:12:1:2:3:4" }))
    const b = clientNetworkKey(viaCaddy("100.64.3.4", { "x-real-ip": "2001:db8:abcd:12:9:9:9:9" }))
    expect(a).toBe("2001:db8:abcd:12::/64")
    expect(b).toBe(a)
  })

  it("falls back to the hop for a limiter — never worse than before when unknown", () => {
    expect(rateLimitAddressKey(viaCaddy("100.64.3.4"))).toBe("100.64.3.4")
    expect(rateLimitAddressKey(viaCaddy("100.64.3.4", { "x-real-ip": "85.65.91.64" }))).toBe("85.65.91.64")
    expect(rateLimitAddressKey({ headers: {} })).toBe("unknown")
  })
})

describe("network hashes", () => {
  it("is plain sha256 without a secret — the scheme ip_hash has always used for IPv4", () => {
    expect(networkHash("203.0.113.7")).toBe(createHash("sha256").update("203.0.113.7").digest("hex"))
    expect(networkHashScheme()).toEqual({ scheme: "sha256", fingerprint: null, misconfigured: false })
  })

  it("is an HMAC with NETWORK_HASH_SECRET, and its fingerprint follows the key", () => {
    process.env.NETWORK_HASH_SECRET = "s".repeat(64)
    expect(networkHash("203.0.113.7")).toBe(createHmac("sha256", "s".repeat(64)).update("203.0.113.7").digest("hex"))
    const first = networkHashScheme()
    expect(first.scheme).toBe("hmac")
    process.env.NETWORK_HASH_SECRET = "t".repeat(64)
    expect(networkHashScheme().fingerprint).not.toBe(first.fingerprint)
  })

  it("refuses to boot on a secret too short to use, or an edge range list with nothing valid", () => {
    process.env.NETWORK_HASH_SECRET = " ".repeat(40)
    expect(networkHashScheme().misconfigured).toBe(true)
    process.env.NETWORK_HASH_SECRET = "short"
    expect(networkHashScheme().misconfigured).toBe(true)
    expect(() => assertClientAddressConfig()).toThrow(/NETWORK_HASH_SECRET/)
    process.env.NETWORK_HASH_SECRET = ""
    process.env.CLIENT_IP_HEADER_FROM = "not-a-range"
    expect(() => assertClientAddressConfig()).toThrow(/CLIENT_IP_HEADER_FROM/)
    process.env.CLIENT_IP_HEADER_FROM = "100.64.0.0/10"
    expect(() => assertClientAddressConfig()).not.toThrow()
  })

  it("makes an unknown address unique per scope — except a Cloudflare server, which a caller can choose", () => {
    railway()
    const unknown = viaCaddy("100.64.3.4")
    expect(clientNetworkHash(unknown, { unknownScope: "user-a" })).not.toBe(clientNetworkHash(unknown, { unknownScope: "user-b" }))
    const viaWorker = viaCaddy("100.64.3.4", { "x-real-ip": "2a06:98c0:3600::103" })
    expect(clientNetworkHash(viaWorker, { unknownScope: "user-a" })).toBe(clientNetworkHash(viaWorker, { unknownScope: "user-b" }))
  })

  it("falls back to the hop without a scope (caps, limits, dedup) — never worse than before", () => {
    railway()
    expect(clientNetworkHash(viaCaddy("100.64.3.4"))).toBe(networkHash("100.64.3.4"))
    expect(clientNetworkHash(viaCaddy("100.64.3.4"))).not.toBe(clientNetworkHash(viaCaddy("100.64.9.9")))
    expect(clientNetworkHash({ headers: {} })).toBe(networkHash("unknown"))
  })

  it("describes itself in one boot line", () => {
    railway()
    expect(describeClientAddressConfig()).toBe("[client-address] source: x-real-ip from 100.64.0.0/10; network hash: sha256")
  })
})
