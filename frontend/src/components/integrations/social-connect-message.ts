import { isFromWindow, isRecord, type PopupMessageTransport } from "@/lib/popup-message"

/**
 * The result the social-connect pop-up posts back to the card that opened it.
 * The backend's OAuth callback pages send it (`backend/src/routes/social-auth.ts`)
 * in exactly two shapes:
 *
 * - `{ type: "social-auth-success", platform }`: the network is connected;
 * - `{ type: "social-auth-error", message? }`: it is not, and why.
 */
export const SOCIAL_CONNECT_CONNECTED = "social-auth-success"
export const SOCIAL_CONNECT_FAILED = "social-auth-error"

export type SocialConnectVerdict =
  | { readonly kind: "ignore" }
  | { readonly kind: "connected" }
  /** `message` is null when the pop-up gave no text, and the caller shows its own. */
  | { readonly kind: "failed"; readonly message: string | null }

export interface SocialConnectContext {
  /** What `window.open` returned for this connect. Null when the pop-up was blocked. */
  readonly popup: unknown
  /**
   * The origin a genuine result comes from: the origin the callback page
   * answers on (lib/runtime-config.ts :: runtimeCallbackOrigin). A result from
   * anywhere else was not sent by it.
   */
  readonly expectedOrigin: string
  /** The network this card is connecting. */
  readonly platform: string
}

const IGNORE: SocialConnectVerdict = { kind: "ignore" }
const CONNECTED: SocialConnectVerdict = { kind: "connected" }

/**
 * The one check every `message` event goes through while a connect is open.
 * Anything that is not the pop-up's own result, on the expected origin and in
 * an expected shape, is `ignore`: the caller then changes nothing, so a forged
 * message can neither show its text nor end the wait for the real result.
 */
export function classifySocialConnectMessage(
  transport: PopupMessageTransport,
  context: SocialConnectContext,
): SocialConnectVerdict {
  if (!isFromWindow(transport, context.popup, context.expectedOrigin)) return IGNORE

  const data = transport.data
  if (!isRecord(data)) return IGNORE
  if (data.type === SOCIAL_CONNECT_CONNECTED) {
    return data.platform === context.platform ? CONNECTED : IGNORE
  }
  if (data.type === SOCIAL_CONNECT_FAILED) {
    const message = typeof data.message === "string" && data.message.trim() !== "" ? data.message : null
    return { kind: "failed", message }
  }
  return IGNORE
}
