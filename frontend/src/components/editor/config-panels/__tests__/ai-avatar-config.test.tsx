/**
 * AiAvatarConfig — stale-value fail-safe useEffect tests.
 *
 * The `motionPrompt` and `expressiveness` levers only apply when
 * `supportsMotion` is true (avatar-iv engine OR image-source mode).
 * When the user switches to avatar-v + avatar-source (i.e. supportsMotion=false),
 * any persisted motionPrompt / expressiveness must be cleared so the hidden
 * fields don't linger in workflow state and the backend Zod schema never sees
 * them (CLAUDE.md Provider Enum Sync step 12b).
 */

import { describe, it, expect, vi, beforeEach } from "vitest"
import { render } from "@testing-library/react"
import { AiAvatarConfig } from "../ai-avatar-config"

// =============================================================================
// Module-level mocks
// =============================================================================

vi.mock("@/components/ui/label", () => ({
  Label: ({ children, ...props }: any) => <label {...props}>{children}</label>,
}))
vi.mock("@/components/ui/textarea", () => ({
  Textarea: (props: any) => <textarea {...props} />,
}))
vi.mock("@/components/ui/input", () => ({
  Input: (props: any) => <input {...props} />,
}))
vi.mock("@/components/ui/select", () => ({
  Select: ({ children }: any) => <div>{children}</div>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => <option value={value}>{children}</option>,
  SelectTrigger: ({ children }: any) => <div>{children}</div>,
  SelectValue: () => <span />,
}))
vi.mock("@/components/ui/slider", () => ({
  Slider: () => <div data-testid="slider" />,
}))
vi.mock("@/components/ui/checkbox", () => ({
  Checkbox: () => <input type="checkbox" />,
}))
vi.mock("@/components/ui/radio-group", () => ({
  RadioGroup: ({ children }: any) => <div>{children}</div>,
  RadioGroupItem: (props: any) => <input type="radio" {...props} />,
}))
vi.mock("@/components/heygen/avatar-picker", () => ({
  AvatarPicker: () => <div data-testid="avatar-picker" />,
}))
vi.mock("@/components/heygen/voice-picker", () => ({
  VoicePicker: () => <div data-testid="voice-picker" />,
}))
vi.mock("@/hooks/use-file-upload", () => ({
  useFileUpload: () => ({ upload: vi.fn(), isUploading: false }),
}))
vi.mock("@/lib/image", () => ({
  optimizedImageUrl: (url: string) => url,
}))
vi.mock("lucide-react", () => {
  const icons = ["AlertTriangle", "Upload", "Loader2", "X"]
  const out: Record<string, () => null> = {}
  for (const name of icons) out[name] = () => null
  return out
})

// =============================================================================
// Helpers
// =============================================================================

function baseAiAvatarData(overrides: Partial<any> = {}): any {
  return {
    label: "AI Avatar",
    avatarSource: "avatar",
    speechMode: "text",
    engine: "avatar-iv",
    resolution: "720p",
    aspectRatio: "16:9",
    caption: false,
    ...overrides,
  }
}

function props(onUpdate: any, data: any): any {
  return { data, onUpdate }
}

beforeEach(() => {
  vi.clearAllMocks()
})

// =============================================================================
// Motion lever fail-safe
// =============================================================================

describe("AiAvatarConfig — motion lever fail-safe useEffect", () => {
  it("clears motionPrompt when engine=avatar-v and avatarSource=avatar", () => {
    const onUpdate = vi.fn()
    const data = baseAiAvatarData({
      engine: "avatar-v",
      avatarSource: "avatar",
      motionPrompt: "wave hands",
    })
    render(<AiAvatarConfig {...props(onUpdate, data)} />)
    const merged: Record<string, unknown> = onUpdate.mock.calls.reduce(
      (acc: any, [u]: any) => ({ ...acc, ...u }),
      {},
    )
    expect(merged.motionPrompt).toBeUndefined()
    expect("motionPrompt" in merged).toBe(true)
  })

  it("clears expressiveness when engine=avatar-v and avatarSource=avatar", () => {
    const onUpdate = vi.fn()
    const data = baseAiAvatarData({
      engine: "avatar-v",
      avatarSource: "avatar",
      expressiveness: "high",
    })
    render(<AiAvatarConfig {...props(onUpdate, data)} />)
    const merged: Record<string, unknown> = onUpdate.mock.calls.reduce(
      (acc: any, [u]: any) => ({ ...acc, ...u }),
      {},
    )
    expect(merged.expressiveness).toBeUndefined()
    expect("expressiveness" in merged).toBe(true)
  })

  it("clears both motionPrompt and expressiveness together in one onUpdate call", () => {
    const onUpdate = vi.fn()
    const data = baseAiAvatarData({
      engine: "avatar-v",
      avatarSource: "avatar",
      motionPrompt: "nod slowly",
      expressiveness: "medium",
    })
    render(<AiAvatarConfig {...props(onUpdate, data)} />)
    const merged: Record<string, unknown> = onUpdate.mock.calls.reduce(
      (acc: any, [u]: any) => ({ ...acc, ...u }),
      {},
    )
    expect(merged.motionPrompt).toBeUndefined()
    expect("motionPrompt" in merged).toBe(true)
    expect(merged.expressiveness).toBeUndefined()
    expect("expressiveness" in merged).toBe(true)
  })

  it("does NOT clear motionPrompt when engine=avatar-iv (supportsMotion=true)", () => {
    const onUpdate = vi.fn()
    const data = baseAiAvatarData({
      engine: "avatar-iv",
      avatarSource: "avatar",
      motionPrompt: "wave hands",
    })
    render(<AiAvatarConfig {...props(onUpdate, data)} />)
    for (const [u] of onUpdate.mock.calls) {
      expect("motionPrompt" in u).toBe(false)
    }
  })

  it("does NOT clear motionPrompt when avatarSource=image (supportsMotion=true regardless of engine)", () => {
    const onUpdate = vi.fn()
    const data = baseAiAvatarData({
      engine: "avatar-v",
      avatarSource: "image",
      motionPrompt: "smile",
    })
    render(<AiAvatarConfig {...props(onUpdate, data)} />)
    for (const [u] of onUpdate.mock.calls) {
      expect("motionPrompt" in u).toBe(false)
    }
  })

  it("is a no-op when motionPrompt and expressiveness are already undefined (avatar-v)", () => {
    // No stale fields — no extra onUpdate call expected for the motion levers.
    const onUpdate = vi.fn()
    const data = baseAiAvatarData({ engine: "avatar-v", avatarSource: "avatar" })
    render(<AiAvatarConfig {...props(onUpdate, data)} />)
    // Verify no motion-lever keys appear in any update
    for (const [u] of onUpdate.mock.calls) {
      expect("motionPrompt" in u).toBe(false)
      expect("expressiveness" in u).toBe(false)
    }
  })
})
