import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * The relay client's two money-adjacent contracts (spec §8.1, §8.2, §13.3):
 *
 *   1. the far end's per-job `credits` / `credit_status` survive the poll loop
 *      — they are already in its PUBLIC_JOB_KEYS, so the near end only has to
 *      stop dropping them — and a body without `credits` yields `undefined`
 *      that the relay-cost helper turns into NULL, never 0;
 *   2. `cloudError`'s 402 fallback names the DEPLOYMENT'S OPERATOR as the
 *      fixer. On a deployment-payer instance the caller holds no account of
 *      their own, so "top up your connected account" told them to do something
 *      they cannot do. The far end's own message still wins when it sends one.
 */

const mockFetch = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>()
vi.mock("../../../lib/nodaro-connect.js", () => ({
  nodaroCloudFetch: (...a: unknown[]) => mockFetch(...(a as [string, RequestInit?])),
  getNodaroCredential: vi.fn(),
  nodaroCloudBase: () => "https://cloud.test",
}))

const { waitForCloudJob, createCloudJob } = await import("../client.js")

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response
}

beforeEach(() => {
  mockFetch.mockReset()
})

describe("waitForCloudJob — the cost passthrough", () => {
  it("carries the far end's `credits` and `credit_status` off the terminal poll", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, {
        data: {
          id: "cloud-9",
          status: "completed",
          progress: 100,
          output_data: { imageUrl: "https://c/x.png" },
          credits: 24,
          credit_status: "committed",
        },
      }),
    )
    const job = await waitForCloudJob("cloud-9")
    expect(job.credits).toBe(24)
    expect(job.credit_status).toBe("committed")
  })

  it("leaves `credits` unset — not 0 — when the far end's body has none", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(200, { data: { id: "cloud-9", status: "completed", output_data: {} } }),
    )
    const job = await waitForCloudJob("cloud-9")
    expect(job.credits ?? null).toBeNull()
    expect(job.credits).not.toBe(0)
  })
})

describe("cloudError — the 402 fallback", () => {
  it("names the deployment's operator, not an account the caller does not hold", async () => {
    mockFetch.mockResolvedValue(jsonResponse(402, {}))
    await expect(createCloudJob("/v1/generate-image", { prompt: "x" })).rejects.toMatchObject({
      name: "NodaroCloudError",
      statusCode: 402,
      message: expect.stringMatching(/operator of this deployment/i),
    })
    await expect(createCloudJob("/v1/generate-image", { prompt: "x" })).rejects.not.toMatchObject({
      message: expect.stringMatching(/your connected account/i),
    })
  })

  it("still prefers the far end's own message when it sends one", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(402, { error: { code: "instance_cap_reached", message: "Monthly cap reached for this instance." } }),
    )
    await expect(createCloudJob("/v1/generate-image", { prompt: "x" })).rejects.toMatchObject({
      code: "instance_cap_reached",
      message: expect.stringContaining("Monthly cap reached for this instance."),
    })
  })
})
