/**
 * Whether an outside provider can fetch a file this install stores (decided
 * 2026-11-13): its storage's public base, judged by the one routability list
 * the workflow export check and the nodaro.ai relay read. The community
 * edition's default serves storage on localhost; Nodaro Cloud's is its CDN.
 */
import { describe, it, expect, vi } from "vitest"

const env = vi.hoisted(() => ({ base: "" }))
vi.mock("../config.js", () => ({ config: { get R2_PUBLIC_URL() { return env.base } } }))

import { providersCanFetchOwnMedia } from "../own-media-reachability.js"

describe("providersCanFetchOwnMedia", () => {
  it.each([
    ["the community edition's default (docker-compose.community.yml)", "http://localhost:3000/storage/nodaro-assets", false],
    ["a LAN address", "http://192.168.1.20:3000/storage/nodaro-assets", false],
    ["a .internal name", "http://minio.internal/storage", false],
    ["no base set", "", false],
    ["a public CDN (Nodaro Cloud)", "https://assets.example.com", true],
    ["a self-host on its own public domain", "https://studio.example.org/storage/nodaro-assets", true],
  ])("%s: %s → %s", (_label, base, reachable) => {
    env.base = base
    expect(providersCanFetchOwnMedia()).toBe(reachable)
  })
})
