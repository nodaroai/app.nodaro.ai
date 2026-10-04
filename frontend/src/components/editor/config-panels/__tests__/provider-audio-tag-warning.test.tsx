import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { ProviderAudioTagWarning } from "../provider-audio-tag-warning"
import { translate } from "@/lib/i18n"

describe("ProviderAudioTagWarning", () => {
  it("renders nothing when provider is undefined", () => {
    const { container } = render(
      <ProviderAudioTagWarning provider={undefined} fieldValues={["[whispers] hello"]} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it("renders nothing when provider is v3", () => {
    const { container } = render(
      <ProviderAudioTagWarning provider="elevenlabs-v3" fieldValues={["[whispers] hello"]} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it("renders the warning for the legacy elevenlabs id — it runs as turbo, which strips tags", () => {
    render(<ProviderAudioTagWarning provider="elevenlabs" fieldValues={["[whispers] hello"]} />)
    expect(screen.getByText(translate("en", "cfgext.provWarnAudioTags"))).toBeInTheDocument()
  })

  it.each(["not-a-model", "ELEVENLABS-V3", "constructor", "elevenlabs-dialogue"])(
    "renders the warning for an id that is not a text-to-speech model (%s) — it runs as turbo too",
    (provider) => {
      render(<ProviderAudioTagWarning provider={provider} fieldValues={["[whispers] hello"]} />)
      expect(screen.getByText(translate("en", "cfgext.provWarnAudioTags"))).toBeInTheDocument()
    },
  )

  it("renders nothing when no field contains brackets", () => {
    const { container } = render(
      <ProviderAudioTagWarning provider="elevenlabs-multilingual" fieldValues={["hello world"]} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it("renders nothing when fieldValues is empty", () => {
    const { container } = render(
      <ProviderAudioTagWarning provider="elevenlabs-multilingual" fieldValues={[]} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it("skips undefined entries in fieldValues", () => {
    const { container } = render(
      <ProviderAudioTagWarning provider="elevenlabs-multilingual" fieldValues={[undefined, "no brackets here"]} />,
    )
    expect(container).toBeEmptyDOMElement()
  })

  it("renders warning when provider is v2 and any field has brackets", () => {
    render(
      <ProviderAudioTagWarning
        provider="elevenlabs-multilingual"
        fieldValues={["hello", "[whispers] hi"]}
      />,
    )
    expect(screen.getByText(translate("en", "cfgext.provWarnAudioTags"))).toBeInTheDocument()
  })

  it("renders warning when provider is elevenlabs-turbo and any field has brackets", () => {
    render(
      <ProviderAudioTagWarning provider="elevenlabs-turbo" fieldValues={["[sighs] yes"]} />,
    )
    expect(screen.getByText(translate("en", "cfgext.provWarnAudioTags"))).toBeInTheDocument()
  })
})
