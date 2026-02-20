/**
 * Paddle.js Client Initialization
 *
 * Lazy-loads the Paddle.js SDK and provides checkout helpers.
 * Uses VITE_PADDLE_CLIENT_TOKEN and VITE_PADDLE_ENVIRONMENT.
 */

import { initializePaddle, type Paddle } from "@paddle/paddle-js"

const CLIENT_TOKEN = import.meta.env.VITE_PADDLE_CLIENT_TOKEN ?? ""
const IS_SANDBOX = import.meta.env.VITE_PADDLE_ENVIRONMENT === "sandbox"

let paddleInstance: Paddle | null = null
let initPromise: Promise<Paddle | null> | null = null

export async function getPaddle(): Promise<Paddle | null> {
  if (paddleInstance) return paddleInstance

  if (!CLIENT_TOKEN) {
    return null
  }

  if (!initPromise) {
    initPromise = initializePaddle({
      token: CLIENT_TOKEN,
      environment: IS_SANDBOX ? "sandbox" : "production",
    }).then((instance) => {
      paddleInstance = instance ?? null
      return paddleInstance
    }).catch((err) => {
      initPromise = null
      return null
    })
  }

  return initPromise
}

export interface CheckoutOptions {
  readonly priceId: string
  readonly userId: string
  readonly userEmail?: string
  readonly successUrl?: string
}

export async function openCheckout(options: CheckoutOptions): Promise<void> {
  const paddle = await getPaddle()
  if (!paddle) {
    throw new Error("Paddle is not available")
  }

  paddle.Checkout.open({
    items: [{ priceId: options.priceId, quantity: 1 }],
    customData: { userId: options.userId },
    customer: options.userEmail ? { email: options.userEmail } : undefined,
    settings: {
      successUrl: options.successUrl ?? `${window.location.origin}/billing?success=true`,
      allowLogout: false,
    },
  })
}
