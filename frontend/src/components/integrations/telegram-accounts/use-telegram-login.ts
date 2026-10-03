import { useCallback, useEffect, useRef, useState } from "react"
import {
  cancelTelegramLogin,
  pollTelegramLogin,
  startTelegramLogin,
  submitTelegramLoginCode,
  submitTelegramLoginPassword,
  type StartTelegramLoginInput,
  type TelegramLoginFailure,
  type TelegramLoginState,
} from "@/lib/api"

/**
 * The Telegram connect wizard's state machine, UI-free.
 *
 * The server owns the login (a live client in the daemon); this hook only
 * mirrors its state into a step the dialog renders, and polls while a QR
 * code is on screen. A scan is only collectable while its token lives
 * (~30 s), so the server checks Telegram every few seconds by itself — the
 * browser's poll just reads that state back.
 */

export type FormError = "rate_limited" | "consent_outdated" | "unavailable" | "invalid" | "unknown"

export type LoginView =
  | { step: "form"; error?: FormError }
  | { step: "qr"; loginUrl: string; expiresAt: number }
  | { step: "code"; error?: "code_invalid" }
  | { step: "password"; hint?: string; error?: "password_invalid" }
  | { step: "done"; label: string | null }
  | { step: "failed"; reason: TelegramLoginFailure; retryAfterSeconds?: number }

export const QR_POLL_MS = 2_000

function toView(state: TelegramLoginState): LoginView {
  switch (state.status) {
    case "pending":
      return { step: "qr", loginUrl: state.loginUrl, expiresAt: state.expiresAt }
    case "code_sent":
      return state.error ? { step: "code", error: state.error } : { step: "code" }
    case "needs_password":
      return {
        step: "password",
        ...(state.hint ? { hint: state.hint } : {}),
        ...(state.error ? { error: state.error } : {}),
      }
    case "done":
      return { step: "done", label: state.account.label }
    case "failed":
      return {
        step: "failed",
        reason: state.reason,
        ...(state.retryAfterSeconds ? { retryAfterSeconds: state.retryAfterSeconds } : {}),
      }
  }
}

function codeOf(err: unknown): string | undefined {
  return err instanceof Error ? ((err as { code?: unknown }).code as string | undefined) : undefined
}

function formErrorOf(err: unknown): FormError {
  switch (codeOf(err)) {
    case "rate_limited":
      return "rate_limited"
    case "consent_outdated":
      return "consent_outdated"
    case "telegram_unavailable":
    case "feature_unavailable":
      return "unavailable"
    case "invalid_request":
      return "invalid"
    default:
      return "unknown"
  }
}

export interface UseTelegramLoginOptions {
  /** Called once when an account finished connecting. */
  onConnected?: () => void
  pollMs?: number
}

export function useTelegramLogin(options: UseTelegramLoginOptions = {}) {
  const [view, setView] = useState<LoginView>({ step: "form" })
  const [busy, setBusy] = useState(false)
  const attemptRef = useRef<string | null>(null)
  const onConnectedRef = useRef(options.onConnected)
  onConnectedRef.current = options.onConnected
  const pollMs = options.pollMs ?? QR_POLL_MS

  const apply = useCallback((state: TelegramLoginState) => {
    const next = toView(state)
    setView(next)
    if (next.step === "done" || next.step === "failed") attemptRef.current = null
    if (next.step === "done") onConnectedRef.current?.()
  }, [])

  /** Runs one server call; a transport failure on a later step keeps the step, a missing attempt ends it. */
  const run = useCallback(
    async (call: (attemptId: string) => Promise<{ state: TelegramLoginState }>) => {
      const attemptId = attemptRef.current
      if (!attemptId) return
      setBusy(true)
      try {
        apply((await call(attemptId)).state)
      } catch (err) {
        if (codeOf(err) === "not_found") apply({ status: "failed", reason: "expired" })
      } finally {
        setBusy(false)
      }
    },
    [apply],
  )

  const start = useCallback(
    async (input: StartTelegramLoginInput) => {
      setBusy(true)
      try {
        const started = await startTelegramLogin(input)
        attemptRef.current = started.attemptId ?? null
        apply(started.state)
      } catch (err) {
        setView({ step: "form", error: formErrorOf(err) })
      } finally {
        setBusy(false)
      }
    },
    [apply],
  )

  const submitCode = useCallback((code: string) => run((id) => submitTelegramLoginCode(id, code)), [run])
  const submitPassword = useCallback((password: string) => run((id) => submitTelegramLoginPassword(id, password)), [run])

  /** Leaves the wizard: an attempt still open on the server is cancelled (best effort). */
  const cancel = useCallback(() => {
    const attemptId = attemptRef.current
    attemptRef.current = null
    if (attemptId) void cancelTelegramLogin(attemptId).catch(() => undefined)
    setView({ step: "form" })
  }, [])

  // Poll only while a QR code is on screen; any other step waits for the user.
  useEffect(() => {
    if (view.step !== "qr") return
    const timer = setInterval(() => {
      const attemptId = attemptRef.current
      if (!attemptId) return
      pollTelegramLogin(attemptId)
        .then((res) => apply(res.state))
        .catch((err: unknown) => {
          if (codeOf(err) === "not_found") apply({ status: "failed", reason: "expired" })
          // Anything else is transient: the next tick asks again.
        })
    }, pollMs)
    return () => clearInterval(timer)
  }, [view.step, pollMs, apply])

  // Closing the page mid-login cancels the server-side attempt too.
  useEffect(
    () => () => {
      const attemptId = attemptRef.current
      if (attemptId) void cancelTelegramLogin(attemptId).catch(() => undefined)
    },
    [],
  )

  return { view, busy, start, submitCode, submitPassword, cancel }
}
