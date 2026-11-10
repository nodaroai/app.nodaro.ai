/**
 * A run history tooltip shows a failed node's sentence and, under it, the provider's own words.
 */
import { describe, it, expect, afterEach } from "vitest"
import { render, screen, cleanup } from "@testing-library/react"

import { NodeStateErrorText } from "../node-state-error-text"

afterEach(cleanup)

const SENTENCE = "The model declined one of your pictures."
const WORDS = "Request blocked: The uploaded image may contain protected or restricted IP content."

describe("NodeStateErrorText", () => {
  it("shows the provider's words under the sentence", () => {
    render(<NodeStateErrorText state={{ error: SENTENCE, errorDetail: WORDS }} />)
    const sentence = screen.getByText(SENTENCE)
    const words = screen.getByTestId("node-state-provider-words")
    expect(words.textContent).toBe(WORDS)
    expect(sentence.compareDocumentPosition(words) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it.each([
    ["no words", {}],
    ["a null", { errorDetail: null }],
    ["an empty string", { errorDetail: "" }],
  ])("a failure with %s shows the sentence alone", (_name, over) => {
    render(<NodeStateErrorText state={{ error: SENTENCE, ...over }} />)
    expect(screen.getByText(SENTENCE)).toBeTruthy()
    expect(screen.queryByTestId("node-state-provider-words")).toBeNull()
  })
})
