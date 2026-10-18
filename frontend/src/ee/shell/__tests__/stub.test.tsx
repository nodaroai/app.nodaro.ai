import { render } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { headerAvailable, NodaroShell, shellTranslator } from "virtual:site-header"

/** Tests (like every build without the header) resolve the virtual id to the stub. */
describe("virtual:site-header in tests", () => {
  it("is the stub: no header available, and it renders nothing", () => {
    expect(headerAvailable).toBe(false)
    const { container } = render(<NodaroShell sdk={{} as never} supabase={{} as never} queryClient={{} as never} sourceApp="app" />)
    expect(container).toBeEmptyDOMElement()
  })

  it("its translator knows no words (the header is not there to use them)", () => {
    expect(shellTranslator("he")("account.settings")).toBeUndefined()
  })
})
