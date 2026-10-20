import { describe, it, expect } from "vitest"
import { render, screen } from "@testing-library/react"
import { RetryBadge } from "../RetryBadge"

describe("RetryBadge", () => {
  it("says which retry of how many a schedule's retry run is", () => {
    render(<RetryBadge retry={{ attempt: 2, maxAttempts: 3, retryOf: "exec-1" }} />)
    expect(screen.getByTestId("execution-retry-badge")).toHaveTextContent("Retry 2 of 3")
  })

  it("renders nothing for a run that is not a retry", () => {
    const { container } = render(<RetryBadge retry={undefined} />)
    expect(container).toBeEmptyDOMElement()
  })
})
