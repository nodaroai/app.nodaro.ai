import { describe, it, expect, vi } from "vitest"
import {
  SCENE3D_DELIVERY_PROVIDER_URL_TTL_SECONDS,
  createScene3DDeliveryAssetSigner,
  parseScene3DDeliveryAssetUrl,
  signScene3DDeliveryUrlsForProvider,
  type Scene3DDeliveryAssetSigner,
} from "../delivery-provider-access.js"
import type { Scene3DPrivateStorageConfig } from "../object-store.js"

/**
 * Handing a delivery artifact to an external provider.
 *
 * A shot still's URL is the AUTHENTICATED delivery endpoint, and a third-party
 * model fetching `referenceImageUrls` server-to-server carries no credentials —
 * so the `stills` handle was wireable in the editor and 401'd at the provider.
 * The fix is a signed, bounded GET minted with the OWNER's identity, and the
 * three things that must be true of it are: it recognises exactly the delivery
 * URLs and nothing else, it refuses an artifact this owner cannot read, and it
 * never touches a URL that was not a delivery artifact.
 */

const JOB = "11111111-1111-4111-8111-111111111111"
const ASSET = "22222222-2222-4222-8222-222222222222"
const OTHER_ASSET = "33333333-3333-4333-8333-333333333333"
const PUBLIC_IMG = "https://cdn.nodaro.ai/uploads/hero.png"

const CFG: Scene3DPrivateStorageConfig = {
  bucket: "scene-private",
  endpoint: "https://acct.r2.cloudflarestorage.com",
  region: "auto",
  accessKeyId: "AKIAEXAMPLE",
  secretAccessKey: "secret",
  forcePathStyle: false,
}

function artifact(overrides: Record<string, unknown> = {}) {
  return {
    artifactId: ASSET,
    kind: "shot-still",
    usage: "shot-still",
    objectKey: `scene3d/owner/rev/${ASSET}.still.png`,
    bucket: CFG.bucket,
    sha256: "a".repeat(64),
    byteLength: 1234,
    etag: "etag-1",
    ...overrides,
  }
}

/** An authorizer that answers only for one (actor, job, asset) triple. */
function authorizerFor(actorId: string, art = artifact()) {
  return vi.fn(async (actor: string, jobId: string, assetId: string) =>
    actor === actorId && jobId === JOB && assetId === art.artifactId
      ? ({ ok: true, delivery: { jobId } , artifact: art } as never)
      : ({ ok: false, reason: "not-found" } as never))
}

// ---------------------------------------------------------------------------
// Recognition
// ---------------------------------------------------------------------------

describe("parseScene3DDeliveryAssetUrl", () => {
  it("names the artifact behind a delivery URL, whatever host it wears", () => {
    const expected = { jobId: JOB, assetId: ASSET }
    expect(parseScene3DDeliveryAssetUrl(`https://app.nodaro.ai/v1/3d-scene/deliveries/${JOB}/assets/${ASSET}`)).toEqual(expected)
    expect(parseScene3DDeliveryAssetUrl(`https://next.nodaro.ai/v1/3d-scene/deliveries/${JOB}/assets/${ASSET}`)).toEqual(expected)
    expect(parseScene3DDeliveryAssetUrl(`http://localhost:3001/v1/3d-scene/deliveries/${JOB}/assets/${ASSET}`)).toEqual(expected)
    // A same-origin write stores a bare path.
    expect(parseScene3DDeliveryAssetUrl(`/v1/3d-scene/deliveries/${JOB}/assets/${ASSET}`)).toEqual(expected)
    // Ids are compared lowercased, the way the object keys are written.
    expect(parseScene3DDeliveryAssetUrl(`/v1/3d-scene/deliveries/${JOB.toUpperCase()}/assets/${ASSET.toUpperCase()}`)).toEqual(expected)
  })

  it("is strict — a revision asset is a DIFFERENT lane with a different authorizer", () => {
    // The browser helper matches the whole `/v1/3d-scene/` prefix, for a
    // different job. Rewriting one of those here would sign a revision asset
    // through the delivery authorizer.
    expect(parseScene3DDeliveryAssetUrl(`/v1/3d-scene/revisions/${JOB}/assets/${ASSET}`)).toBeNull()
    expect(parseScene3DDeliveryAssetUrl(`/v1/3d-scene/deliveries/${JOB}`)).toBeNull()
    expect(parseScene3DDeliveryAssetUrl(`/v1/3d-scene/deliveries/${JOB}/assets/${ASSET}/extra`)).toBeNull()
    expect(parseScene3DDeliveryAssetUrl(`/v1/3d-scene/deliveries/not-a-uuid/assets/${ASSET}`)).toBeNull()
    expect(parseScene3DDeliveryAssetUrl(`/v1/3d-scene/deliveries/${JOB}/assets/../../etc`)).toBeNull()
    expect(parseScene3DDeliveryAssetUrl(PUBLIC_IMG)).toBeNull()
    expect(parseScene3DDeliveryAssetUrl("not a url at all")).toBeNull()
    expect(parseScene3DDeliveryAssetUrl(undefined)).toBeNull()
    expect(parseScene3DDeliveryAssetUrl(42)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// The grant
// ---------------------------------------------------------------------------

describe("createScene3DDeliveryAssetSigner", () => {
  it("signs a bounded GET for an artifact the owner can read", async () => {
    const authorize = authorizerFor("owner")
    const sign = createScene3DDeliveryAssetSigner(CFG, authorize as never)
    const url = await sign({ actorId: "owner", jobId: JOB, assetId: ASSET })
    expect(url).toBeTruthy()
    const parsed = new URL(url!)
    // The private bucket's own object, never the public host.
    expect(parsed.host).toBe("scene-private.acct.r2.cloudflarestorage.com")
    expect(parsed.pathname).toContain(`${ASSET}.still.png`)
    // Bounded, and by the documented number.
    expect(parsed.searchParams.get("X-Amz-Expires")).toBe(String(SCENE3D_DELIVERY_PROVIDER_URL_TTL_SECONDS))
    expect(SCENE3D_DELIVERY_PROVIDER_URL_TTL_SECONDS).toBeLessThanOrEqual(1800)
    expect(parsed.searchParams.get("X-Amz-Signature")).toBeTruthy()
    // Not cached anywhere on the way to the provider.
    expect(parsed.searchParams.get("response-cache-control")).toBe("no-store")
    // A provider sends a bare GET, so the grant must not require a header it
    // cannot send (`grantInput` binds If-Match; this deliberately does not) —
    // host-only signed headers is exactly what a bare GET signature looks like.
    expect(parsed.searchParams.get("X-Amz-SignedHeaders")).toBe("host")
    // GET-only, and not by convention: the presigner lives in one function that
    // cannot express a write, and this module never names a write command.
    // (`upload-policy.test.ts` proves the same thing for the whole tree.)
    expect(parsed.searchParams.has("x-amz-If-Match")).toBe(false)
  })

  it("refuses another user's delivery", async () => {
    const authorize = authorizerFor("owner")
    const sign = createScene3DDeliveryAssetSigner(CFG, authorize as never)
    expect(await sign({ actorId: "stranger", jobId: JOB, assetId: ASSET })).toBeNull()
  })

  it("refuses an artifact of a delivery this owner does not have", async () => {
    const authorize = authorizerFor("owner")
    const sign = createScene3DDeliveryAssetSigner(CFG, authorize as never)
    expect(await sign({ actorId: "owner", jobId: JOB, assetId: OTHER_ASSET })).toBeNull()
  })

  it("refuses a pin that lives in a different bucket rather than signing a 404", async () => {
    const authorize = authorizerFor("owner", artifact({ bucket: "some-other-bucket" }))
    const sign = createScene3DDeliveryAssetSigner(CFG, authorize as never)
    expect(await sign({ actorId: "owner", jobId: JOB, assetId: ASSET })).toBeNull()
  })

  it("honours an explicit TTL", async () => {
    const sign = createScene3DDeliveryAssetSigner(CFG, authorizerFor("owner") as never, 120)
    const url = await sign({ actorId: "owner", jobId: JOB, assetId: ASSET })
    expect(new URL(url!).searchParams.get("X-Amz-Expires")).toBe("120")
  })
})

// ---------------------------------------------------------------------------
// The payload pass
// ---------------------------------------------------------------------------

describe("signScene3DDeliveryUrlsForProvider", () => {
  const DELIVERY = `https://app.nodaro.ai/v1/3d-scene/deliveries/${JOB}/assets/${ASSET}`
  const SIGNED = "https://scene-private.acct.r2.cloudflarestorage.com/signed?X-Amz-Signature=abc"
  const signer: Scene3DDeliveryAssetSigner = async ({ actorId }) => (actorId === "owner" ? SIGNED : null)

  it("swaps a delivery URL out of an array field and leaves the rest alone", async () => {
    const payload = { prompt: "a street", referenceImageUrls: [PUBLIC_IMG, DELIVERY], provider: "seedance-2" }
    const out = await signScene3DDeliveryUrlsForProvider(payload, "owner", signer)
    expect(out.referenceImageUrls).toEqual([PUBLIC_IMG, SIGNED])
    // Copied, never mutated in place.
    expect(payload.referenceImageUrls).toEqual([PUBLIC_IMG, DELIVERY])
    expect(out.prompt).toBe("a street")
    expect(out.provider).toBe("seedance-2")
  })

  it("swaps a delivery URL out of a single-URL field too — a still can be wired anywhere", async () => {
    // The point of the data-driven walk: no field list to keep current.
    const out = await signScene3DDeliveryUrlsForProvider(
      { imageUrl: DELIVERY, endFrameUrl: DELIVERY, aFieldNobodyHasWrittenYet: DELIVERY }, "owner", signer,
    )
    expect(out.imageUrl).toBe(SIGNED)
    expect(out.endFrameUrl).toBe(SIGNED)
    expect(out.aFieldNobodyHasWrittenYet).toBe(SIGNED)
  })

  it("returns the SAME object when no delivery URL is present", async () => {
    const payload = { prompt: "a street", referenceImageUrls: [PUBLIC_IMG], duration: 5, shots: [{ prompt: "x" }] }
    expect(await signScene3DDeliveryUrlsForProvider(payload, "owner", signer)).toBe(payload)
  })

  it("mints ONE grant per artifact however many fields carry it", async () => {
    const counted = vi.fn(signer)
    await signScene3DDeliveryUrlsForProvider(
      { imageUrl: DELIVERY, referenceImageUrls: [DELIVERY, DELIVERY] }, "owner", counted,
    )
    expect(counted).toHaveBeenCalledTimes(1)
  })

  it("leaves the authenticated URL in place when the grant is refused", async () => {
    // A refusal must not turn "you cannot read that" into "this field is gone":
    // the run then fails at the provider exactly as it did before, and the
    // owner still sees the URL they see everywhere else.
    const payload = { referenceImageUrls: [DELIVERY] }
    const out = await signScene3DDeliveryUrlsForProvider(payload, "stranger", signer)
    expect(out.referenceImageUrls).toEqual([DELIVERY])
    expect(out).toBe(payload)
  })

  it("never throws when signing fails", async () => {
    const angry: Scene3DDeliveryAssetSigner = async () => { throw new Error("storage down") }
    const payload = { referenceImageUrls: [DELIVERY], prompt: "a street" }
    const out = await signScene3DDeliveryUrlsForProvider(payload, "owner", angry)
    expect(out.referenceImageUrls).toEqual([DELIVERY])
  })

  it("is inert with no owner and on an install with no private bucket", async () => {
    const payload = { referenceImageUrls: [DELIVERY] }
    expect(await signScene3DDeliveryUrlsForProvider(payload, undefined, signer)).toBe(payload)
    expect(await signScene3DDeliveryUrlsForProvider(payload, "owner", null)).toBe(payload)
  })
})
