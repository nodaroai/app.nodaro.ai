import { describe, it, expect, vi, beforeEach, afterAll } from "vitest"

// ---------------------------------------------------------------------------
// Own-storage SSRF exemption (self-host MinIO behind the app origin) ג€”
// covers the subtree matcher, the syntactic gate integration, and the
// storage bootstrap helpers. Config is mocked so R2_* values are test-local.
// ---------------------------------------------------------------------------

const { mockConfig, mockS3Send } = vi.hoisted(() => ({
  mockConfig: {
    R2_PUBLIC_URL: "",
    R2_ENDPOINT: "",
    R2_ACCOUNT_ID: "",
    R2_ACCESS_KEY_ID: "",
    R2_SECRET_ACCESS_KEY: "",
    R2_BUCKET_NAME: "nodaro-assets",
    R2_FORCE_PATH_STYLE: false,
  },
  mockS3Send: vi.fn(),
}))

vi.mock("@/lib/config.js", () => ({
  config: mockConfig,
  isCloud: () => false,
  isCommunity: () => true,
  isBusiness: () => false,
  hasAdmin: () => false,
  hasCredits: () => false,
}))

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: vi.fn() },
}))

vi.mock("@aws-sdk/client-s3", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@aws-sdk/client-s3")>()
  return {
    ...actual,
    S3Client: class MockS3Client {
      send = mockS3Send
    },
  }
})

import { isConfiguredStorageUrl } from "../own-storage-url.js"
import { safeUrlSchema } from "../url-validator.js"
import {
  resolveStorageEndpoint,
  buildPublicReadPolicy,
  ensureStorageBucket,
} from "../storage.js"

const BASE = "http://localhost:3000/storage/nodaro-assets"

// isConfiguredStorageUrl reads process.env directly (see its docstring), so
// the subtree tests drive the env var; the storage-bootstrap tests keep
// driving the mocked config snapshot.
const ORIGINAL_PUBLIC_URL = process.env.R2_PUBLIC_URL

beforeEach(() => {
  vi.clearAllMocks()
  delete process.env.R2_PUBLIC_URL
  mockConfig.R2_PUBLIC_URL = ""
  mockConfig.R2_ENDPOINT = ""
  mockConfig.R2_ACCESS_KEY_ID = ""
  mockConfig.R2_SECRET_ACCESS_KEY = ""
})

afterAll(() => {
  if (ORIGINAL_PUBLIC_URL === undefined) delete process.env.R2_PUBLIC_URL
  else process.env.R2_PUBLIC_URL = ORIGINAL_PUBLIC_URL
})

describe("isConfiguredStorageUrl", () => {
  it("matches only URLs strictly inside the configured subtree", () => {
    process.env.R2_PUBLIC_URL = BASE
    expect(isConfiguredStorageUrl(`${BASE}/images/abc.png`)).toBe(true)
    expect(isConfiguredStorageUrl(`${BASE}/videos/x.mp4?download=1`)).toBe(true)
    // The base itself (no key) is not an object URL.
    expect(isConfiguredStorageUrl(BASE)).toBe(false)
  })

  it("does NOT extend to the rest of the origin", () => {
    process.env.R2_PUBLIC_URL = BASE
    expect(isConfiguredStorageUrl("http://localhost:3000/v1/admin/users")).toBe(false)
    expect(isConfiguredStorageUrl("http://localhost:3000/storage/other-bucket/x.png")).toBe(false)
  })

  it("requires a path-boundary slash ג€” sibling-prefix buckets do not match", () => {
    process.env.R2_PUBLIC_URL = BASE
    expect(isConfiguredStorageUrl(`${BASE}-evil/x.png`)).toBe(false)
  })

  it("is immune to dot-segment traversal (URL-normalized before compare)", () => {
    process.env.R2_PUBLIC_URL = BASE
    expect(isConfiguredStorageUrl(`${BASE}/../../v1/admin/users`)).toBe(false)
  })

  it("is inert when R2_PUBLIC_URL is unset", () => {
    expect(isConfiguredStorageUrl(`${BASE}/images/abc.png`)).toBe(false)
  })

  it("ignores other hosts and ports", () => {
    process.env.R2_PUBLIC_URL = BASE
    expect(isConfiguredStorageUrl("http://localhost:9000/nodaro-assets/x.png")).toBe(false)
    expect(isConfiguredStorageUrl("http://evil.example/storage/nodaro-assets/x.png")).toBe(false)
  })
})

describe("safeUrlSchema with own-storage subtree", () => {
  it("accepts own-storage localhost URLs and still rejects every other localhost URL", () => {
    process.env.R2_PUBLIC_URL = BASE
    expect(safeUrlSchema.safeParse(`${BASE}/images/abc.png`).success).toBe(true)
    expect(safeUrlSchema.safeParse("http://localhost:3000/v1/jobs").success).toBe(false)
    expect(safeUrlSchema.safeParse("http://localhost:8000/health").success).toBe(false)
    expect(safeUrlSchema.safeParse("http://127.0.0.1/x").success).toBe(false)
  })

  it("keeps rejecting localhost when no storage subtree is configured", () => {
    expect(safeUrlSchema.safeParse(`${BASE}/images/abc.png`).success).toBe(false)
  })
})

describe("resolveStorageEndpoint", () => {
  it("prefers an explicit endpoint and falls back to the R2 account derivation", () => {
    expect(
      resolveStorageEndpoint({ R2_ENDPOINT: "http://minio:9000", R2_ACCOUNT_ID: "acct" }),
    ).toBe("http://minio:9000")
    expect(resolveStorageEndpoint({ R2_ENDPOINT: "", R2_ACCOUNT_ID: "acct" })).toBe(
      "https://acct.r2.cloudflarestorage.com",
    )
  })
})

describe("buildPublicReadPolicy", () => {
  it("grants anonymous GetObject on the bucket objects only, and denies it under the evidence prefix (migration 583)", () => {
    const policy = JSON.parse(buildPublicReadPolicy("nodaro-assets"))
    expect(policy.Statement).toHaveLength(2)
    expect(policy.Statement[0]).toMatchObject({ Effect: "Allow", Action: ["s3:GetObject"], Resource: ["arn:aws:s3:::nodaro-assets/*"] })
    expect(policy.Statement[1]).toMatchObject({ Effect: "Deny", Action: ["s3:GetObject"], Resource: ["arn:aws:s3:::nodaro-assets/evidence/*"] })
  })
})

describe("ensureStorageBucket", () => {
  it("is a no-op without a custom endpoint (cloud R2)", async () => {
    mockConfig.R2_ACCOUNT_ID = "acct"
    mockConfig.R2_ACCESS_KEY_ID = "key"
    mockConfig.R2_SECRET_ACCESS_KEY = "secret"
    await ensureStorageBucket()
    expect(mockS3Send).not.toHaveBeenCalled()
  })

  it("creates the bucket and applies the public-read policy in endpoint mode", async () => {
    mockConfig.R2_ENDPOINT = "http://minio:9000"
    mockConfig.R2_ACCESS_KEY_ID = "key"
    mockConfig.R2_SECRET_ACCESS_KEY = "secret"
    mockS3Send.mockResolvedValue({})
    await ensureStorageBucket()
    expect(mockS3Send).toHaveBeenCalledTimes(2)
  })

  it("continues to the policy when the bucket already exists", async () => {
    mockConfig.R2_ENDPOINT = "http://minio:9000"
    mockConfig.R2_ACCESS_KEY_ID = "key"
    mockConfig.R2_SECRET_ACCESS_KEY = "secret"
    const exists = new Error("exists")
    exists.name = "BucketAlreadyOwnedByYou"
    mockS3Send.mockRejectedValueOnce(exists).mockResolvedValueOnce({})
    await ensureStorageBucket()
    expect(mockS3Send).toHaveBeenCalledTimes(2)
  })

  it("swallows unexpected errors instead of throwing at boot", async () => {
    mockConfig.R2_ENDPOINT = "http://minio:9000"
    mockConfig.R2_ACCESS_KEY_ID = "key"
    mockConfig.R2_SECRET_ACCESS_KEY = "secret"
    mockS3Send.mockRejectedValue(new Error("connection refused"))
    await expect(ensureStorageBucket()).resolves.toBeUndefined()
    expect(mockS3Send).toHaveBeenCalledTimes(1)
  })
})
