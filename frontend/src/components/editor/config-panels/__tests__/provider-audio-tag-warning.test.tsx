import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { ProviderAudioTagWarning } from "../provider-audio-tag-warning"

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
    expect(screen.getByText(/ElevenLabs v3/i)).toBeInTheDocument()
  })

  it("renders warning when provider is elevenlabs-turbo and any field has brackets", () => {
    render(
      <ProviderAudioTagWarning provider="elevenlabs-turbo" fieldValues={["[sighs] yes"]} />,
    )
    expect(screen.getByText(/ElevenLabs v3/i)).toBeInTheDocument()
  })
})
