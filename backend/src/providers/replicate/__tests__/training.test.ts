import { beforeEach, describe, expect, it, vi } from "vitest"

// Mock the Replicate client BEFORE importing the module under test.
vi.mock("../client.js", () => ({
  replicate: {
    accounts: { current: vi.fn() },
    models: { get: vi.fn(), create: vi.fn() },
    trainings: { create: vi.fn(), cancel: vi.fn() },
  },
}))
vi.mock("../../../lib/reconcile/fire-on-task-created.js", () => ({
  fireOnTaskCreated: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("../../../lib/config.js", () => ({
  config: { PUBLIC_URL: "https://app.test.local", REPLICATE_API_TOKEN: "test-token" },
}))

import { replicate } from "../client.js"
import { createCharacterTraining, characterModelDestination } from "../training.js"

const CHAR = "abcd1234-0000-0000-0000-00000000beef"
// Owner is derived from the token account (mocked below as "asafna2").
const OWNER = "asafna2"
const DEST = `${OWNER}/char-${CHAR}`

/** Build an ApiError-shaped rejection (training.ts reads err.response.status). */
function apiError(status: number): Error {
  return Object.assign(new Error(`HTTP ${status}`), { response: { status } })
}

const accounts = replicate.accounts as unknown as { current: ReturnType<typeof vi.fn> }
const models = replicate.models as unknown as {
  get: ReturnType<typeof vi.fn>
  create: ReturnType<typeof vi.fn>
}
const trainings = replicate.trainings as unknown as { create: ReturnType<typeof vi.fn> }

beforeEach(() => {
  vi.clearAllMocks()
  // Owner derived from the prod token's Replicate account (never hardcoded).
  accounts.current.mockResolvedValue({ type: "user", username: OWNER })
  trainings.create.mockResolvedValue({ id: "train-123" })
})

describe("createCharacterTraining — ensures destination model before dispatch", () => {
  it("destination owner is derived from the token account, not hardcoded", async () => {
    expect(await characterModelDestination(CHAR)).toBe(DEST)
  })

  it("creates the destination model when missing, THEN dispatches the training", async () => {
    models.get.mockRejectedValueOnce(apiError(404)) // not found
    models.create.mockResolvedValueOnce({})

    const res = await createCharacterTraining({ characterId: CHAR, zipUrl: "https://r2/z.zip", triggerWord: "TOK_x" })

    expect(models.get).toHaveBeenCalledWith(OWNER, `char-${CHAR}`)
    expect(models.create).toHaveBeenCalledWith(OWNER, `char-${CHAR}`, {
      visibility: "private",
      hardware: "gpu-h100",
    })
    // dispatch uses the SAME derived destination + happens AFTER model creation.
    expect(trainings.create).toHaveBeenCalledWith(
      "ostris",
      "flux-dev-lora-trainer",
      expect.any(String),
      expect.objectContaining({ destination: DEST }),
    )
    expect(models.create.mock.invocationCallOrder[0]).toBeLessThan(
      trainings.create.mock.invocationCallOrder[0],
    )
    expect(res).toEqual({ trainingId: "train-123" })
  })

  it("reuses an existing model (get 200 → no create) and still dispatches", async () => {
    models.get.mockResolvedValueOnce({ owner: OWNER, name: `char-${CHAR}` })

    await createCharacterTraining({ characterId: CHAR, zipUrl: "https://r2/z.zip", triggerWord: "TOK_x" })

    expect(models.create).not.toHaveBeenCalled()
    expect(trainings.create).toHaveBeenCalledTimes(1)
  })

  it("swallows a 409 (model created concurrently) and still dispatches", async () => {
    models.get.mockRejectedValueOnce(apiError(404))
    models.create.mockRejectedValueOnce(apiError(409))

    const res = await createCharacterTraining({ characterId: CHAR, zipUrl: "https://r2/z.zip", triggerWord: "TOK_x" })

    expect(trainings.create).toHaveBeenCalledTimes(1)
    expect(res).toEqual({ trainingId: "train-123" })
  })

  it("propagates a non-404 from models.get (e.g. 403 no write access) and does NOT dispatch", async () => {
    models.get.mockRejectedValueOnce(apiError(403))

    await expect(
      createCharacterTraining({ characterId: CHAR, zipUrl: "https://r2/z.zip", triggerWord: "TOK_x" }),
    ).rejects.toThrow()

    expect(models.create).not.toHaveBeenCalled()
    expect(trainings.create).not.toHaveBeenCalled()
  })

  it("propagates a non-409 from models.create (e.g. 422 bad hardware) and does NOT dispatch", async () => {
    models.get.mockRejectedValueOnce(apiError(404))
    models.create.mockRejectedValueOnce(apiError(422))

    await expect(
      createCharacterTraining({ characterId: CHAR, zipUrl: "https://r2/z.zip", triggerWord: "TOK_x" }),
    ).rejects.toThrow()

    expect(trainings.create).not.toHaveBeenCalled()
  })
})
