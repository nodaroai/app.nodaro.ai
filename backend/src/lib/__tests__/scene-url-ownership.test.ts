/**
 * A scene's storage urls name only the pipeline owner's objects
 * (decided 2026-10-07; migration 482).
 *
 * `metadata.scene_node_data` carries urls beside its asset ids — a shot's
 * keyframe, clip, last frame, audio and lipsynced clip, the scene's composite,
 * the interpolation keyframes and every asset ref's `url`. Those urls are what
 * the server downloads and forwards (a start frame to a video model, keyframes
 * to a critic, composites to ffmpeg). A url on our storage is judged by its
 * key (lib/key-ownership.ts): made by another user, or with no maker held by
 * another user's library, is foreign and is dropped before it is forwarded.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { config } from "../config.js"
import { foreignStorageUrls, storageUrlPath, storageUrlPathAnyHost, storageUrlQueryUrls } from "../key-ownership.js"
import {
  ownedSceneNodeData,
  sceneNodeDataUrls,
  withOwnedSceneRows,
  withoutForeignSceneAssetIds,
  withoutForeignSceneRefs,
} from "../pipeline-asset-ownership.js"

type Row = Record<string, unknown>

const OWNER = "00000000-0000-4000-8000-00000000a001"
const OTHER = "00000000-0000-4000-8000-00000000b002"
const OWNER_JOB = "f0000000-0000-4000-8000-00000000a001"
const OTHER_JOB = "f0000000-0000-4000-8000-00000000b002"
const CDN = "https://media.test"
const FALLBACK = "pub-0000.r2.dev"

/** `.in()` / `.eq()` over in-memory tables; `failing` tables answer an error. */
function fakeSupabase(tables: Record<string, Row[]>, failing: string[] = []) {
  const calls: Array<{ table: string; col: string; vals: unknown[] }> = []
  const client = {
    calls,
    from(table: string) {
      const filters: Array<(row: Row) => boolean> = []
      const result = () =>
        failing.includes(table)
          ? { data: null, error: { message: "boom" } }
          : { data: (tables[table] ?? []).filter((row) => filters.every((f) => f(row))), error: null }
      const chain = {
        select: () => chain,
        eq: (col: string, val: unknown) => {
          filters.push((row) => row[col] === val)
          return chain
        },
        in: (col: string, vals: unknown[]) => {
          calls.push({ table, col, vals })
          filters.push((row) => vals.includes(row[col]))
          return chain
        },
        then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
          Promise.resolve(result()).then(resolve, reject),
      }
      return chain
    },
  }
  return client
}

const TABLES: Record<string, Row[]> = {
  jobs: [
    { id: OWNER_JOB, user_id: OWNER },
    { id: OTHER_JOB, user_id: OTHER },
  ],
  assets: [
    { r2_key: "uploads/images/other-plain.png", user_id: OTHER },
    { r2_key: "uploads/images/own-plain.png", user_id: OWNER },
    // The other user saved the owner's generated image to their library.
    { r2_key: `images/${OWNER_JOB}.png`, user_id: OTHER },
  ],
}

let saved: { url: string; fallback: string }
beforeEach(() => {
  saved = { url: config.R2_PUBLIC_URL, fallback: config.R2_PUBLIC_FALLBACK_DOMAIN }
  config.R2_PUBLIC_URL = CDN
  config.R2_PUBLIC_FALLBACK_DOMAIN = FALLBACK
})
afterEach(() => {
  config.R2_PUBLIC_URL = saved.url
  config.R2_PUBLIC_FALLBACK_DOMAIN = saved.fallback
})

describe("which urls are on our storage, and at what key", () => {
  it("reads the key from the public host, its fallback host, any scheme, decoded", () => {
    expect(storageUrlPath(`${CDN}/images/a.png`)).toEqual({ kind: "ours", path: "images/a.png" })
    expect(storageUrlPath(`http://MEDIA.test/images/a.png?v=1#x`)).toEqual({ kind: "ours", path: "images/a.png" })
    expect(storageUrlPath(`https://${FALLBACK}/images/a.png`)).toEqual({ kind: "ours", path: "images/a.png" })
    expect(storageUrlPath(`${CDN}/images/%61.png`)).toEqual({ kind: "ours", path: "images/a.png" })
  })

  it("calls a url on another host external, and one it cannot decode unreadable", () => {
    expect(storageUrlPath("https://provider.example/images/a.png")).toEqual({ kind: "external" })
    expect(storageUrlPath(`https://media.test.evil.example/images/a.png`)).toEqual({ kind: "external" })
    expect(storageUrlPath(`https://media.test@evil.example/images/a.png`)).toEqual({ kind: "external" })
    expect(storageUrlPath("not a url")).toEqual({ kind: "external" })
    expect(storageUrlPath(`${CDN}/images/%E0%A4%A.png`)).toEqual({ kind: "unreadable" })
    expect(storageUrlPath(`${CDN}/`)).toEqual({ kind: "unreadable" })
  })

  it("names nothing as ours when no public url is configured", () => {
    config.R2_PUBLIC_URL = ""
    config.R2_PUBLIC_FALLBACK_DOMAIN = ""
    expect(storageUrlPath(`${CDN}/images/a.png`)).toEqual({ kind: "external" })
  })
})

describe("whose object a storage url names, for a reader acting for the owner", () => {
  it("is foreign when another user made it (job key family, any suffix or spelling)", async () => {
    const urls = [
      `${CDN}/images/${OTHER_JOB}.png`,
      `${CDN}/videos/${OTHER_JOB}-clip.mp4`,
      `http://media.test/images/${OTHER_JOB}.png`,
      `https://${FALLBACK}/images/${OTHER_JOB}.png`,
      `${CDN}/images/%66${OTHER_JOB.slice(1)}.png`,
    ]
    const foreign = await foreignStorageUrls(OWNER, urls, fakeSupabase(TABLES) as never)
    expect([...foreign].sort()).toEqual([...urls].sort())
  })

  it("reads an upper-case key as the different object it is (object keys are case-sensitive)", async () => {
    const upper = `${CDN}/images/${OTHER_JOB.toUpperCase()}.png`
    expect((await foreignStorageUrls(OWNER, [upper], fakeSupabase(TABLES) as never)).size).toBe(0)
  })

  it("is foreign in another user's upload namespace, and the owner's in their own", async () => {
    const other = `${CDN}/uploads/images/${OTHER}/x.png`
    const handoff = `${CDN}/uploads/handoff/videos/${OTHER}/x.mp4`
    const own = `${CDN}/uploads/images/${OWNER}/x.png`
    const foreign = await foreignStorageUrls(OWNER, [other, handoff, own], fakeSupabase(TABLES) as never)
    expect([...foreign].sort()).toEqual([handoff, other].sort())
  })

  it("is the owner's when the owner made it, even though another library holds it (the maker decides)", async () => {
    const foreign = await foreignStorageUrls(OWNER, [`${CDN}/images/${OWNER_JOB}.png`], fakeSupabase(TABLES) as never)
    expect(foreign.size).toBe(0)
  })

  it("with no maker known, is foreign when another user's library holds the key (or a tail of the path)", async () => {
    const held = `${CDN}/uploads/images/other-plain.png`
    const prefixed = `${CDN}/bucket/uploads/images/other-plain.png`
    const own = `${CDN}/uploads/images/own-plain.png`
    const orphan = `${CDN}/uploads/images/nobody.png`
    const foreign = await foreignStorageUrls(OWNER, [held, prefixed, own, orphan], fakeSupabase(TABLES) as never)
    expect([...foreign].sort()).toEqual([held, prefixed].sort())
  })

  it("never judges an external url, and calls an unreadable one of ours foreign", async () => {
    const supabase = fakeSupabase(TABLES)
    const foreign = await foreignStorageUrls(
      OWNER,
      ["https://provider.example/out.png", `${CDN}/images/%E0%A4%A.png`],
      supabase as never,
    )
    expect([...foreign]).toEqual([`${CDN}/images/%E0%A4%A.png`])
  })

  it("asks nothing for no urls of ours", async () => {
    const supabase = fakeSupabase(TABLES)
    await foreignStorageUrls(OWNER, ["https://provider.example/out.png"], supabase as never)
    expect(supabase.calls).toEqual([])
  })

  it("throws when it cannot ask (a reader that cannot ask must not forward)", async () => {
    await expect(
      foreignStorageUrls(OWNER, [`${CDN}/images/${OTHER_JOB}.png`], fakeSupabase(TABLES, ["jobs"]) as never),
    ).rejects.toThrow(/key ownership lookup failed/)
    await expect(
      foreignStorageUrls(OWNER, [`${CDN}/uploads/images/x.png`], fakeSupabase(TABLES, ["assets"]) as never),
    ).rejects.toThrow(/key ownership lookup failed/)
  })
})

describe("a scene's urls, by key", () => {
  const scene = {
    shots: [
      {
        shot_id: "s1",
        keyframe_url: "k1",
        interpolation_keyframe_urls: ["i1", "i2", 3],
        camera_path_directive: { parameters: { url: "p1" } },
      },
    ],
    generated_clips: [{ asset_id: "x", url: "c1" }],
    composite_video_url: "cv",
    curl: "no",
    url_note: "no",
    urls_count: 2,
  }

  it("collects every string under a key named url or ending in _url or _urls, at any depth", () => {
    expect(sceneNodeDataUrls(scene).sort()).toEqual(["c1", "cv", "i1", "i2", "k1", "p1"])
    expect(sceneNodeDataUrls(undefined)).toEqual([])
  })
})

describe("dropping a scene's foreign references", () => {
  const OWN_ID = "a5000000-0000-4000-8000-000000000001"
  const FOREIGN_ID = "a5000000-0000-4000-8000-000000000002"
  const scene = {
    scene_index: 1,
    shots: [
      { shot_id: "s1", keyframe_asset_id: OWN_ID, keyframe_url: "bad-k", video_asset_id: OWN_ID, video_url: "ok-v" },
      { shot_id: "s2", interpolation_keyframe_urls: ["ok-i", "bad-i"], last_frame_url: "ok-l" },
    ],
    scene_anchor_keyframe: { asset_id: OWN_ID, url: "bad-a" },
    generated_keyframes: [{ asset_id: OWN_ID, url: "ok-g" }, { asset_id: OWN_ID, url: "bad-g" }],
    composite_video_asset_id: FOREIGN_ID,
    composite_video_url: "ok-c",
  }

  it("drops a foreign url with its id, a whole asset ref, and a *_urls list holding one", () => {
    const foreignUrls = new Set(["bad-k", "bad-i", "bad-a", "bad-g"])
    const out = withoutForeignSceneRefs(scene, { foreignUrls })
    expect(out.shots[0]).toEqual({ shot_id: "s1", video_asset_id: OWN_ID, video_url: "ok-v" })
    expect(out.shots[1]).toEqual({ shot_id: "s2", last_frame_url: "ok-l" })
    expect(out.scene_anchor_keyframe).toBeNull()
    expect(out.generated_keyframes).toEqual([{ asset_id: OWN_ID, url: "ok-g" }])
    expect(out.composite_video_url).toBe("ok-c")
    // The input is never mutated.
    expect(scene.shots[0]?.keyframe_url).toBe("bad-k")
  })

  it("a dropped foreign id takes its matching url with it (a branch's copy)", () => {
    const owned = new Map<string, string | null>([[OWN_ID, null]])
    const out = withoutForeignSceneAssetIds(scene, owned)
    expect("composite_video_asset_id" in out).toBe(false)
    expect("composite_video_url" in out).toBe(false)
    expect(out.shots[0]?.keyframe_url).toBe("bad-k")
  })
})

describe("the owner-checked copy a forwarding reader uses", () => {
  const scene = {
    shots: [
      { shot_id: "s1", keyframe_url: `${CDN}/images/${OTHER_JOB}.png`, video_url: `${CDN}/videos/${OWNER_JOB}.mp4` },
      { shot_id: "s2", keyframe_url: "https://provider.example/k.png" },
    ],
    composite_video_url: `${CDN}/uploads/images/other-plain.png`,
  }

  it("drops what another user made or holds and keeps the owner's and external urls", async () => {
    const out = await ownedSceneNodeData(fakeSupabase(TABLES) as never, OWNER, scene)
    expect(out.shots[0]).toEqual({ shot_id: "s1", video_url: `${CDN}/videos/${OWNER_JOB}.mp4` })
    expect(out.shots[1]).toEqual(scene.shots[1])
    expect("composite_video_url" in out).toBe(false)
    expect(scene.composite_video_url).toBe(`${CDN}/uploads/images/other-plain.png`)
  })

  it("judges many scene rows in one lookup and leaves the rows themselves alone", async () => {
    const supabase = fakeSupabase(TABLES)
    const rows = [
      { id: "r1", metadata: { scene_node_data: scene, other: 1 } },
      { id: "r2", metadata: { scene_node_data: { shots: [{ shot_id: "a", keyframe_url: `${CDN}/images/${OWNER_JOB}.png` }] } } },
      { id: "r3", metadata: null },
    ]
    const out = await withOwnedSceneRows(supabase as never, OWNER, rows)
    expect((out[0]?.metadata as { scene_node_data: typeof scene }).scene_node_data.shots[0]).toEqual({
      shot_id: "s1",
      video_url: `${CDN}/videos/${OWNER_JOB}.mp4`,
    })
    expect((out[0]?.metadata as { other: number }).other).toBe(1)
    expect(out[1]).toEqual(rows[1])
    expect(out[2]).toEqual(rows[2])
    expect(rows[0]?.metadata?.scene_node_data).toBe(scene)
    expect(supabase.calls.filter((c) => c.table === "jobs")).toHaveLength(1)
  })

  it("throws when the lookup fails, rather than forwarding unjudged urls", async () => {
    await expect(ownedSceneNodeData(fakeSupabase(TABLES, ["jobs"]) as never, OWNER, scene)).rejects.toThrow()
  })
})

/**
 * Review round (decided 2026-10-07). Each case here failed before the fix.
 */
describe("a maker-less key belongs to its earliest library claimant", () => {
  // Owner A uploaded `uploads/images/a-upload.png` (no maker in its name);
  // B later saved A's url to B's own library. B's row must not take A's
  // upload from A — and B, the later claimant, does not gain it either.
  const claims = (ownerAt: string | undefined, otherAt: string | undefined): Record<string, Row[]> => ({
    jobs: [],
    assets: [
      { id: "a1", r2_key: "uploads/images/a-upload.png", user_id: OWNER, created_at: ownerAt },
      { id: "b1", r2_key: "uploads/images/a-upload.png", user_id: OTHER, created_at: otherAt },
    ],
  })
  const url = `${CDN}/uploads/images/a-upload.png`

  it("attacker: another user saving the owner's upload later does not make it foreign to the owner", async () => {
    const tables = claims("2026-10-01T10:00:00.5+00:00", "2026-10-02T10:00:00+00:00")
    expect((await foreignStorageUrls(OWNER, [url], fakeSupabase(tables) as never)).size).toBe(0)
    expect((await foreignStorageUrls(OWNER, [url], fakeSupabase(tables) as never, { forWrite: true })).size).toBe(0)
  })

  it("the later claimant gains nothing: the url stays foreign to them", async () => {
    const tables = claims("2026-10-01T10:00:00+00:00", "2026-10-01T10:00:00.000001+00:00")
    expect([...(await foreignStorageUrls(OTHER, [url], fakeSupabase(tables) as never))]).toEqual([url])
    // And an owner whose row is the later one does not take another's upload.
    expect([...(await foreignStorageUrls(OWNER, [url], fakeSupabase(claims("2026-10-03T00:00:00+00:00", "2026-10-02T00:00:00+00:00")) as never))]).toEqual([url])
  })

  it("a tie, or a row with no time, is foreign (it cannot be told apart)", async () => {
    const at = "2026-10-01T10:00:00+00:00"
    expect((await foreignStorageUrls(OWNER, [url], fakeSupabase(claims(at, at)) as never)).size).toBe(1)
    expect((await foreignStorageUrls(OWNER, [url], fakeSupabase(claims(undefined, at)) as never)).size).toBe(1)
  })
})

describe("our own proxy routes (and any `url=` parameter) are judged by the url they carry", () => {
  const inner = `${CDN}/images/${OTHER_JOB}.png`
  const enc = encodeURIComponent

  it("attacker: a download or image-proxy url wrapping another user's object is foreign, on any host", async () => {
    const urls = [
      `https://api.example/v1/download?url=${enc(inner)}`,
      `https://app.example/api/v1/image-proxy?url=${enc(inner)}`,
      `https://api.example/v1/download?x=1&%75rl=${enc(inner)}#frag`,
      // Wrapped twice.
      `https://api.example/v1/image-proxy?url=${enc(`https://api.example/v1/download?url=${enc(inner)}`)}`,
    ]
    const foreign = await foreignStorageUrls(OWNER, urls, fakeSupabase(TABLES) as never)
    expect([...foreign].sort()).toEqual([...urls].sort())
  })

  it("the owner's own object through a proxy, and a proxy carrying an external url, pass", async () => {
    const urls = [
      `https://api.example/v1/download?url=${enc(`${CDN}/images/${OWNER_JOB}.png`)}`,
      `https://api.example/v1/image-proxy?url=${enc("https://provider.example/a.png")}`,
      `https://provider.example/a.png?urls=${enc(inner)}&curl=${enc(inner)}`,
    ]
    expect((await foreignStorageUrls(OWNER, urls, fakeSupabase(TABLES) as never)).size).toBe(0)
  })
})

/**
 * The write side asks what migration 482's trigger asks: the path of EVERY
 * url, whatever its host, read the way the trigger reads it. A writer that
 * let a url through which the trigger then refuses stranded its work (a seed
 * held a reservation for a pipeline with no scenes).
 */
describe("the write side judges as the trigger does", () => {
  it("attacker: a url elsewhere whose path names another user's job is foreign to a writer, not a reader", async () => {
    const url = `https://example.com/x/${OTHER_JOB}.png`
    expect((await foreignStorageUrls(OWNER, [url], fakeSupabase(TABLES) as never)).size).toBe(0)
    expect([...(await foreignStorageUrls(OWNER, [url], fakeSupabase(TABLES) as never, { forWrite: true }))]).toEqual([url])
  })

  it("attacker: tab, newline, backslash and upper-case spellings of another user's key are foreign to a writer", async () => {
    const urls = [
      `${CDN}/images/${OTHER_JOB.slice(0, 8)}\t${OTHER_JOB.slice(8)}.png`,
      `${CDN}/images\\${OTHER_JOB}.png`,
      ` ${CDN}/images/${OTHER_JOB}.png\n`,
      `${CDN}/images/${OTHER_JOB.toUpperCase()}.png`,
      `https:\\\\media.test\\images\\${OTHER_JOB}.png`,
    ]
    const foreign = await foreignStorageUrls(OWNER, urls, fakeSupabase(TABLES) as never, { forWrite: true })
    expect([...foreign].sort()).toEqual([...urls].sort())
  })

  it("the owner's objects, an orphan and an external url still pass a writer", async () => {
    const urls = [
      `${CDN}/images/${OWNER_JOB}.png`,
      `https://example.com/x/${OWNER_JOB}-clip.mp4`,
      `${CDN}/uploads/images/own-plain.png`,
      `${CDN}/uploads/images/nobody.png`,
      "https://provider.example/out.png",
    ]
    expect((await foreignStorageUrls(OWNER, urls, fakeSupabase(TABLES) as never, { forWrite: true })).size).toBe(0)
  })
})

/**
 * The trigger's url reading, ported. The SAME table is asserted against
 * migration 482's `storage_url_path` / `storage_url_query_urls` in
 * supabase/tests/scene-url-ownership.behavior.sql — the parity check CI runs.
 */
const STORAGE_URL_PATH_GOLDEN: ReadonlyArray<readonly [string, string]> = [
  ["https://cdn.example/images/a.png", "images/a.png"],
  ["https://cdn.example/images\\b.png", "images/b.png"],
  ["https://cdn.example/images/ab\t-c\nd\r.png", "images/ab-cd.png"],
  ["  https://cdn.example/x.png\n ", "x.png"],
  ["\u0001https://cdn.example/y.png\u001f", "y.png"],
  ["http://cdn.example/a/%66oo.png?v=1#x", "a/foo.png"],
  ["https://cdn.example//a.png", "a.png"],
  ["https://bad host/a/b.png", "a/b.png"],
  ["https:/cdn.example/a.png", "https:/cdn.example/a.png"],
  ["https://cdn.example/a%2Fb.png", "a/b.png"],
  ["https://cdn.example/a%E2%82%AC.png", "a%E2%82%AC.png"],
  ["https:\\\\cdn.example\\images\\c.png", "images/c.png"],
  ["https://cdn.example/a%5Cb.png", "a\\b.png"],
]
const STORAGE_URL_QUERY_GOLDEN: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["https://api.example/v1/download?url=https%3A%2F%2Fcdn.example%2Fimages%2Fa.png", ["https://cdn.example/images/a.png"]],
  ["https://api.example/v1/image-proxy?x=1&%75rl=https%3A%2F%2Fcdn.example%2Fb.png#url=nope", ["https://cdn.example/b.png"]],
  ["https://api.example/p?url=a+b&url=c", ["a b", "c"]],
  ["https://api.example/p?urls=x&curl=y&url", [""]],
  ["https://api.example/p\t?u\nrl=z", ["z"]],
  ["https://api.example/p#?url=z", []],
]

describe("the trigger's url reading, ported to the write side", () => {
  it("reads a url's path as storage_url_path does", () => {
    for (const [url, path] of STORAGE_URL_PATH_GOLDEN) expect(storageUrlPathAnyHost(url), JSON.stringify(url)).toBe(path)
  })
  it("reads a url's `url` parameters as storage_url_query_urls does", () => {
    for (const [url, inner] of STORAGE_URL_QUERY_GOLDEN) expect(storageUrlQueryUrls(url), JSON.stringify(url)).toEqual(inner)
  })
})
