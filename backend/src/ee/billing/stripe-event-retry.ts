/**
 * Thrown by a Stripe webhook handler that could not settle its event and
 * wrote nothing a second delivery would repeat. The webhook route answers
 * 500 for it, and Stripe delivers the event again (with backoff, for up to
 * three days). Every other handler error is acknowledged with 200, as before.
 */
export class StripeEventRetryError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "StripeEventRetryError"
  }
}
