import { describe, it, expect, vi, beforeEach } from "vitest"
import { resolveSheetSections, planSheetGeneration } from "@nodaro/shared"
import type { ExecutionContext } from "../../workflow-editor/types"

// --- Module mocks -----------------------------------------------------------
const getCharacter = vi.fn()
const generateCharacterAsset = vi.fn()
vi.mock("@/lib/api", () => ({
  getCharacter: (...a: unknown[]) => getCharacter(...a),
  getObjectById: vi.fn(),
  getLocationById: vi.fn(),
  // The adapter (sheet-tab-adapter) imports these from @/lib/api:
  generateCharacterAsset: (...a: unknown[]) => generateCharacterAsset(...a),
  generateObjectAsset: vi.fn(),
  generateLocationAsset: vi.fn(),
  getJobStatusLean: vi.fn(),
}))

const pollJobToCompletion = vi.fn()
vi.mock("../../workflow-editor/poll-job", () => ({
  pollJobToCompletion: (...a: unknown[]) => pollJobToCompletion(...a),
}))

const updateNodeData = vi.fn()
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: { getState: () => ({ updateNodeData }) },
}))

// The live charged price per credit id; a missing id is "no price" (a build
// without credits, or a failed lookup). The confirm used to print a fixed
// 1 credit per panel and 4 (6 for motion) to compose, ten-fold stale.
const livePrices = vi.hoisted(() => ({ byId: {} as Record<string, number | undefined> }))
const fetchModelCredits = vi.fn(async (id: string) => livePrices.byId[id])
vi.mock("@/hooks/use-model-credit-cost", () => ({
  fetchModelCredits: (id: string) => fetchModelCredits(id),
}))

import { ensureNodeSheetPanels, sheetPanelsConfirmText, SHEET_PRICE_WAIT_MS, SHEET_STAGE_A_CANCELLED } from "../node-sheet-stage-a"

const ctx = { signal: undefined } as unknown as ExecutionContext

function charRow(overrides: Record<string, unknown> = {}) {
  return {
    name: "Hero",
    sourceImageUrl: "https://img/hero.png",
    angles: [], bodyAngles: [], expressions: [], poses: [],
    lightingVariations: [], detailCloseups: [], outfitVariations: [],
    ...overrides,
  }
}

const base = {
  entityKind: "character" as const,
  entityDbId: "char-1",
  type: "turnaround" as const,
  flavour: {
    outputFormat: "still" as const, withText: true, showLabels: true,
    aspect: "landscape" as const, background: "grey" as const,
  },
  ctx,
  nodeId: "n1",
  label: "Sheet",
}

describe("ensureNodeSheetPanels", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pollJobToCompletion.mockResolvedValue("")
    generateCharacterAsset.mockResolvedValue({ jobId: "j" })
  })

  it("no-ops (no confirm, no generation) when every planned panel already exists", async () => {
    // Discover the planned variants via the real planner, then present them all.
    const sections = resolveSheetSections("character", "turnaround")
    const planned = planSheetGeneration("character", sections, base.flavour, {}, "Hero").missing
    const angles = planned.map((m) => ({ name: m.variant, url: `u/${m.variant}` }))
    getCharacter.mockResolvedValue(charRow({ angles }))

    const confirm = vi.fn(() => true)
    await ensureNodeSheetPanels({ ...base, confirm })

    expect(confirm).not.toHaveBeenCalled()
    expect(generateCharacterAsset).not.toHaveBeenCalled()
  })

  it("declining the cost confirm throws CANCELLED and generates nothing (no charge)", async () => {
    getCharacter.mockResolvedValue(charRow()) // empty buckets → panels missing
    const confirm = vi.fn(() => false)

    await expect(ensureNodeSheetPanels({ ...base, confirm })).rejects.toThrow(SHEET_STAGE_A_CANCELLED)
    expect(confirm).toHaveBeenCalledTimes(1)
    expect(generateCharacterAsset).not.toHaveBeenCalled()
  })

  it("generates every missing panel and tolerates an individual panel failure", async () => {
    getCharacter.mockResolvedValue(charRow()) // empty buckets → all planned panels missing
    // Second panel's poll rejects; the batch must still resolve (compose proceeds).
    pollJobToCompletion
      .mockResolvedValueOnce("")
      .mockRejectedValueOnce(new Error("panel failed"))
      .mockResolvedValue("")
    let missingCount = 0
    const confirm = vi.fn((n: number) => { missingCount = n; return true })

    await expect(ensureNodeSheetPanels({ ...base, confirm })).resolves.toBeUndefined()

    expect(missingCount).toBeGreaterThan(0)
    expect(generateCharacterAsset).toHaveBeenCalledTimes(missingCount)
  })

  it("throws a main-image error when panels are missing but the entity has no source image", async () => {
    getCharacter.mockResolvedValue(charRow({ sourceImageUrl: null }))
    const confirm = vi.fn(() => true)

    await expect(ensureNodeSheetPanels({ ...base, confirm })).rejects.toThrow(/main image/i)
    expect(generateCharacterAsset).not.toHaveBeenCalled()
  })

  it("asks each panel for the model its price is quoted by", async () => {
    getCharacter.mockResolvedValue(charRow())
    await ensureNodeSheetPanels({ ...base, confirm: () => true })

    expect(generateCharacterAsset).toHaveBeenCalled()
    for (const [req] of generateCharacterAsset.mock.calls) expect(req).toMatchObject({ provider: "nano-banana" })
  })
})

describe("the cost confirm before panels are generated", () => {
  const missingCount = () =>
    planSheetGeneration("character", resolveSheetSections("character", "turnaround"), base.flavour, {}, "Hero").missing.length

  beforeEach(() => {
    vi.clearAllMocks()
    getCharacter.mockResolvedValue(charRow()) // empty buckets → every planned panel missing
    livePrices.byId = { "nano-banana": 10, "reference-sheet:assembly": 40, "reference-sheet:assembly-motion": 60 }
  })

  async function confirmMessage(flavour = base.flavour): Promise<string> {
    const confirm = vi.spyOn(window, "confirm").mockReturnValue(false)
    await expect(ensureNodeSheetPanels({ ...base, flavour })).rejects.toThrow(SHEET_STAGE_A_CANCELLED)
    expect(confirm).toHaveBeenCalledTimes(1)
    return String(confirm.mock.calls[0]?.[0])
  }

  it("quotes every missing panel at the live panel price plus the live compose fee", async () => {
    const n = missingCount()
    expect(n).toBeGreaterThan(1)

    const message = await confirmMessage()

    expect(message).toContain(`${n} more panels`)
    expect(message).toContain(`about ${n * 10} CR`)
    expect(message).toContain("adds 40 CR")
    expect(message).toContain(`about ${n * 10 + 40} CR in all`)
    expect(fetchModelCredits).toHaveBeenCalledWith("nano-banana")
    expect(fetchModelCredits).toHaveBeenCalledWith("reference-sheet:assembly")
    expect(generateCharacterAsset).not.toHaveBeenCalled()
  })

  it("a motion sheet quotes the motion compose fee", async () => {
    const message = await confirmMessage({ ...base.flavour, outputFormat: "motion" as never })

    expect(message).toContain("adds 60 CR")
    expect(fetchModelCredits).toHaveBeenCalledWith("reference-sheet:assembly-motion")
  })

  it("with no live price it names the panel count and quotes no figure", async () => {
    livePrices.byId = { "nano-banana": 10 } // the compose price did not load

    const message = await confirmMessage()

    expect(message).toContain(`${missingCount()} more panels`)
    expect(message).not.toMatch(/\d+ CR/)
  })

  it("a price lookup that never answers doesn't hold the run: after the wait it asks without figures", async () => {
    vi.useFakeTimers()
    try {
      const never = () => new Promise<number | undefined>(() => {})
      fetchModelCredits.mockImplementationOnce(never).mockImplementationOnce(never)
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(false)

      const run = expect(ensureNodeSheetPanels(base)).rejects.toThrow(SHEET_STAGE_A_CANCELLED)
      await vi.advanceTimersByTimeAsync(SHEET_PRICE_WAIT_MS)
      await run

      expect(confirm).toHaveBeenCalledTimes(1)
      expect(String(confirm.mock.calls[0]?.[0])).toContain(`${missingCount()} more panels`)
      expect(String(confirm.mock.calls[0]?.[0])).not.toMatch(/\d+ CR/)
    } finally {
      vi.useRealTimers()
    }
  })

  it("a custom confirm skips the price lookup", async () => {
    await expect(ensureNodeSheetPanels({ ...base, confirm: () => false })).rejects.toThrow(SHEET_STAGE_A_CANCELLED)
    expect(fetchModelCredits).not.toHaveBeenCalled()
  })
})

// The worked examples in docs/nodes/ai-image/reference-sheet.md ("Pricing").
describe("sheetPanelsConfirmText", () => {
  it("prices four new panels plus the compose fee (4×10 + 40 = 80)", () => {
    const message = sheetPanelsConfirmText(4, "Hero sheet", { panel: 10, compose: 40 })
    expect(message).toBe(
      "“Hero sheet” needs 4 more panels made from the main image, about 40 CR. " +
        "Composing the sheet then adds 40 CR: about 80 CR in all. Generate them now?",
    )
  })

  it("prices one panel in the singular (1×10 + 40 = 50)", () => {
    const message = sheetPanelsConfirmText(1, "Hero sheet", { panel: 10, compose: 40 })
    expect(message).toBe(
      "“Hero sheet” needs one more panel made from the main image, about 10 CR. " +
        "Composing the sheet then adds 40 CR: about 50 CR in all. Generate it now?",
    )
  })

  it("without prices it asks about the count alone", () => {
    expect(sheetPanelsConfirmText(3, "Hero sheet", undefined)).toBe(
      "“Hero sheet” needs 3 more panels made from the main image before the sheet can be composed. Generate them now?",
    )
  })
})
