import { describe, it, expect, afterEach, vi } from "vitest"
import { render, screen, cleanup, act } from "@testing-library/react"

// The modal's API module is only reached from handlers; stub it so importing
// the component doesn't pull the whole api/supabase chain into the test env.
vi.mock("@/lib/api", () => ({
  sunoVoiceValidateApi: vi.fn(),
  sunoVoiceValidateInfoApi: vi.fn(),
  sunoVoiceRegenerateApi: vi.fn(),
  sunoVoiceGenerateApi: vi.fn(),
  sunoVoiceRecordInfoApi: vi.fn(),
  uploadAudio: vi.fn(),
}))

vi.mock("@/hooks/use-workflow-store", () => ({
  useWorkflowStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({ updateNodeData: () => {} }),
}))

import { SunoVoiceSetupModal } from "../suno-voice-setup-modal"
import { useLocaleStore } from "@/lib/locale-store"
import { translate } from "@/lib/i18n"

function renderModal(data: Record<string, unknown> = {}) {
  return render(
    <SunoVoiceSetupModal
      nodeId="node-1"
      data={data as never}
      open
      onClose={() => {}}
    />,
  )
}

describe("SunoVoiceSetupModal copy comes from the dict", () => {
  afterEach(() => {
    cleanup()
    act(() => useLocaleStore.getState().setLocale("en"))
  })

  it("takes the header and step-1 field copy from the dict", () => {
    renderModal()
    expect(screen.getByText(translate("en", "node.sunoVoicePersonaSetup"))).toBeInTheDocument()
    expect(screen.getByText(translate("en", "node.sourceRecordingUrl"))).toBeInTheDocument()
    expect(screen.getByText(translate("en", "node.vocalSegmentStartS"))).toBeInTheDocument()
    expect(screen.getByText(translate("en", "node.phraseLanguage"))).toBeInTheDocument()
  })

  it("follows a live language switch (footer buttons)", () => {
    renderModal()
    expect(screen.getByText(translate("en", "common.cancel"))).toBeInTheDocument()

    act(() => useLocaleStore.getState().setLocale("he"))
    expect(screen.getByText(translate("he", "common.cancel"))).toBeInTheDocument()
    expect(screen.queryByText(translate("en", "common.cancel"))).not.toBeInTheDocument()
  })

  it("shows the Close label instead of Cancel once a voice exists", () => {
    renderModal({ voiceId: "voice-abc" })
    // Radix's dialog ships its own sr-only "Close" label, so the footer button
    // is one of several matches — the point of the assertion is the ternary.
    expect(screen.getAllByText(translate("en", "common.close")).length).toBeGreaterThan(0)
    expect(screen.queryByText(translate("en", "common.cancel"))).not.toBeInTheDocument()
    expect(screen.getByText(translate("en", "node.voicePersonaReady"))).toBeInTheDocument()
  })
})
