import { describe, it, expect, vi, beforeEach } from "vitest"

const mockInitializePaddle = vi.fn()
const mockCheckoutOpen = vi.fn()

vi.mock("@paddle/paddle-js", () => ({
  initializePaddle: (...args: unknown[]) => mockInitializePaddle(...args),
}))

describe("paddle", () => {
  beforeEach(() => {
    vi.resetModules()
    vi.restoreAllMocks()
    mockInitializePaddle.mockReset()
    mockCheckoutOpen.mockReset()
  })

  async function loadPaddle(token = "test-token", env = "sandbox") {
    vi.stubEnv("VITE_PADDLE_CLIENT_TOKEN", token)
    vi.stubEnv("VITE_PADDLE_ENVIRONMENT", env)
    return await import("../paddle")
  }

  describe("getPaddle", () => {
    it("returns null when no client token is set", async () => {
      const mod = await loadPaddle("")
      const result = await mod.getPaddle()
      expect(result).toBeNull()
      expect(mockInitializePaddle).not.toHaveBeenCalled()
    })

    it("initializes paddle with sandbox environment", async () => {
      const fakePaddle = { Checkout: { open: mockCheckoutOpen } }
      mockInitializePaddle.mockResolvedValue(fakePaddle)

      const mod = await loadPaddle("tok_123", "sandbox")
      const result = await mod.getPaddle()

      expect(result).toBe(fakePaddle)
      expect(mockInitializePaddle).toHaveBeenCalledWith({
        token: "tok_123",
        environment: "sandbox",
      })
    })

    it("initializes paddle with production environment", async () => {
      const fakePaddle = { Checkout: { open: mockCheckoutOpen } }
      mockInitializePaddle.mockResolvedValue(fakePaddle)

      const mod = await loadPaddle("tok_123", "production")
      const result = await mod.getPaddle()

      expect(result).toBe(fakePaddle)
      expect(mockInitializePaddle).toHaveBeenCalledWith({
        token: "tok_123",
        environment: "production",
      })
    })

    it("caches the paddle instance on subsequent calls", async () => {
      const fakePaddle = { Checkout: { open: mockCheckoutOpen } }
      mockInitializePaddle.mockResolvedValue(fakePaddle)

      const mod = await loadPaddle("tok_123", "sandbox")
      await mod.getPaddle()
      await mod.getPaddle()

      expect(mockInitializePaddle).toHaveBeenCalledTimes(1)
    })

    it("returns null when initialization fails", async () => {
      mockInitializePaddle.mockRejectedValue(new Error("network error"))

      const mod = await loadPaddle("tok_123", "sandbox")
      const result = await mod.getPaddle()

      expect(result).toBeNull()
    })
  })

  describe("openCheckout", () => {
    it("throws when paddle is not available", async () => {
      const mod = await loadPaddle("")
      await expect(mod.openCheckout({
        priceId: "pri_123",
        userId: "u1",
      })).rejects.toThrow("Paddle is not available")
    })

    it("calls Checkout.open with correct options", async () => {
      const fakePaddle = { Checkout: { open: mockCheckoutOpen } }
      mockInitializePaddle.mockResolvedValue(fakePaddle)

      const mod = await loadPaddle("tok_123", "sandbox")
      await mod.openCheckout({
        priceId: "pri_abc",
        userId: "user-42",
        userEmail: "test@example.com",
      })

      expect(mockCheckoutOpen).toHaveBeenCalledWith({
        items: [{ priceId: "pri_abc", quantity: 1 }],
        customData: { userId: "user-42" },
        customer: { email: "test@example.com" },
        settings: {
          successUrl: expect.stringContaining("/billing?success=true"),
          allowLogout: false,
        },
      })
    })

    it("omits customer when no email provided", async () => {
      const fakePaddle = { Checkout: { open: mockCheckoutOpen } }
      mockInitializePaddle.mockResolvedValue(fakePaddle)

      const mod = await loadPaddle("tok_123", "sandbox")
      await mod.openCheckout({
        priceId: "pri_abc",
        userId: "user-42",
      })

      expect(mockCheckoutOpen).toHaveBeenCalledWith(
        expect.objectContaining({ customer: undefined })
      )
    })
  })
})
