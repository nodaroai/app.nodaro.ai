/**
 * The Text to Speech quick strip, rendered: a model the USER picks in the strip's
 * dropdown hands the node's data to the control's `write`, so the voice settings
 * the new model ignores are cleared (the same patch the config panel writes). The
 * fail-safe snap, an effect, calls `write` WITHOUT the data and so writes the
 * provider alone — it must never clean up levers nobody asked about.
 *
 * `node-quick-configs-tts-provider.test.ts` pins the `write` function itself; this
 * file pins the two call sites in `QuickConfigSelect` that decide whether it gets
 * the data. `toStrictEqual` plus the key list throughout: `toEqual` treats
 * `{ speed: undefined }` as `{}`, and the store removes a stored value only when
 * the patch carries its key.
 */
import { createContext, useContext } from "react"
import { describe, it, expect, vi, beforeEach } from "vitest"
import { render, fireEvent } from "@testing-library/react"

const updateNodeData = vi.fn()
vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (sel: any) => sel({ updateNodeData }),
}))

// A plain-element Select whose items are buttons calling the Select's
// onValueChange — the user's pick, without Radix's portal/pointer plumbing.
const PickContext = createContext<(v: string) => void>(() => {})
vi.mock("@/components/ui/select", () => ({
  Select: ({ children, onValueChange }: any) => (
    <PickContext.Provider value={onValueChange ?? (() => {})}>
      <div data-testid="select">{children}</div>
    </PickContext.Provider>
  ),
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => {
    const pick = useContext(PickContext)
    return (
      <button type="button" data-testid={`item-${value}`} onClick={() => pick(value)}>
        {children}
      </button>
    )
  },
  SelectValue: ({ children }: any) => <span>{children}</span>,
}))

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: any) => <div>{children}</div>,
  PopoverAnchor: ({ children }: any) => <>{children}</>,
  PopoverContent: ({ children }: any) => <div>{children}</div>,
}))

import { QuickConfigSelect, getQuickConfigs, readQuickConfigValue } from "../node-quick-configs"

const control = getQuickConfigs("text-to-speech").find((c) => c.field === "provider")!

const tuned = { provider: "elevenlabs-turbo", stability: 0.4, similarityBoost: 0.8, style: 0.3, speed: 1.15, languageCode: "es" }

beforeEach(() => updateNodeData.mockClear())

describe("text-to-speech quick strip — the model dropdown, rendered", () => {
  it("a user's pick of v3 clears the levers v3 ignores (speed, style, similarity) and keeps the rest", () => {
    const { getByTestId } = render(
      <QuickConfigSelect nodeId="n1" control={control} value="elevenlabs-turbo" data={tuned} />,
    )
    expect(updateNodeData).not.toHaveBeenCalled() // a valid stored model is not snapped

    fireEvent.click(getByTestId("item-elevenlabs-v3"))

    expect(updateNodeData).toHaveBeenCalledTimes(1)
    const [nodeId, patch] = updateNodeData.mock.calls[0]
    expect(nodeId).toBe("n1")
    expect(patch).toStrictEqual({ provider: "elevenlabs-v3", similarityBoost: undefined, style: undefined, speed: undefined })
    expect(Object.keys(patch).sort()).toEqual(["provider", "similarityBoost", "speed", "style"])
  })

  it("a node with no stored model shows the default speech model (v4) — what it runs as — and writes nothing", () => {
    const { getAllByText } = render(
      // An unset provider reads as "" (readQuickConfigValue).
      <QuickConfigSelect nodeId="n1" control={control} value={readQuickConfigValue(control, {})} data={{}} />,
    )
    expect(updateNodeData).not.toHaveBeenCalled()
    // Once as the trigger's label, once as the menu item; v3 only as its item.
    expect(getAllByText("ElevenLabs v4")).toHaveLength(2)
    expect(getAllByText("ElevenLabs v3")).toHaveLength(1)
  })

  it("the fail-safe snap of a stale model writes the provider alone, whatever levers the node carries", () => {
    // The legacy `elevenlabs` id is not an option, so the strip's effect snaps it
    // to the first model. The node still carries speed/style/similarity.
    render(<QuickConfigSelect nodeId="n1" control={control} value="elevenlabs" data={{ ...tuned, provider: "elevenlabs" }} />)

    expect(updateNodeData).toHaveBeenCalledTimes(1)
    const [nodeId, patch] = updateNodeData.mock.calls[0]
    expect(nodeId).toBe("n1")
    expect(patch).toStrictEqual({ provider: "elevenlabs-v3" })
    expect(Object.keys(patch)).toEqual(["provider"])
  })
})
