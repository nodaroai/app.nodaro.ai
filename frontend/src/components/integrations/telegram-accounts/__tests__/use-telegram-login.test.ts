/**
 * The connect wizard's state machine against a mocked API: QR (polled while
 * on screen), 2FA, phone code, and the edges — a start refused outright, an
 * attempt that vanished, cancel and unmount both cancelling server-side.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { renderHook, act } from "@testing-library/react"

const api = vi.hoisted(() => ({
  start: vi.fn(),
  poll: vi.fn(),
  code: vi.fn(),
  password: vi.fn(),
  cancel: vi.fn(),
}))

vi.mock("@/lib/api", () => ({
  startTelegramLogin: (input: unknown) => api.start(input),
  pollTelegramLogin: (id: string) => api.poll(id),
  submitTelegramLoginCode: (id: string, code: string) => api.code(id, code),
  submitTelegramLoginPassword: (id: string, password: string) => api.password(id, password),
  cancelTelegramLogin: (id: string) => api.cancel(id),
}))

import { useTelegramLogin } from "../use-telegram-login"

const ATTEMPT = "33333333-3333-4333-8333-333333333333"
const INPUT = { method: "qr" as const, apiId: "123456", apiHash: "b".repeat(32), consentVersion: "v1" }
const PENDING = { status: "pending", loginUrl: "tg://login?token=abc", expiresAt: 1_900_000_000_000 }

function apiError(code: string) {
  return Object.assign(new Error(code), { code })
}

beforeEach(() => {
  vi.useFakeTimers()
  for (const fn of Object.values(api)) fn.mockReset()
  api.cancel.mockResolvedValue(undefined)
})

afterEach(() => {
  vi.useRealTimers()
})

describe("QR", () => {
  it("shows the code, polls while it is on screen, and reports a finished login once", async () => {
    const onConnected = vi.fn()
    api.start.mockResolvedValue({ attemptId: ATTEMPT, state: PENDING })
    api.poll
      .mockResolvedValueOnce({ state: { ...PENDING, loginUrl: "tg://login?token=def" } })
      .mockResolvedValueOnce({ state: { status: "done", account: { id: "acc", label: "@radar" } } })
    const { result } = renderHook(() => useTelegramLogin({ onConnected, pollMs: 1_000 }))

    await act(() => result.current.start(INPUT))
    expect(result.current.view).toEqual({ step: "qr", loginUrl: "tg://login?token=abc", expiresAt: PENDING.expiresAt })

    await act(() => vi.advanceTimersByTimeAsync(1_000))
    expect(result.current.view).toMatchObject({ step: "qr", loginUrl: "tg://login?token=def" })

    await act(() => vi.advanceTimersByTimeAsync(1_000))
    expect(result.current.view).toEqual({ step: "done", label: "@radar" })
    expect(onConnected).toHaveBeenCalledTimes(1)

    await act(() => vi.advanceTimersByTimeAsync(5_000))
    expect(api.poll).toHaveBeenCalledTimes(2) // polling stopped with the QR step
  })

  it("an attempt the server no longer knows ends as expired", async () => {
    api.start.mockResolvedValue({ attemptId: ATTEMPT, state: PENDING })
    api.poll.mockRejectedValue(apiError("not_found"))
    const { result } = renderHook(() => useTelegramLogin({ pollMs: 1_000 }))
    await act(() => result.current.start(INPUT))
    await act(() => vi.advanceTimersByTimeAsync(1_000))
    expect(result.current.view).toEqual({ step: "failed", reason: "expired" })
  })

  it("a transient poll failure keeps the QR on screen", async () => {
    api.start.mockResolvedValue({ attemptId: ATTEMPT, state: PENDING })
    api.poll.mockRejectedValueOnce(apiError("telegram_unavailable")).mockResolvedValueOnce({ state: PENDING })
    const { result } = renderHook(() => useTelegramLogin({ pollMs: 1_000 }))
    await act(() => result.current.start(INPUT))
    await act(() => vi.advanceTimersByTimeAsync(1_000))
    expect(result.current.view.step).toBe("qr")
  })
})

describe("password and code", () => {
  it("asks for the 2FA password, keeps asking after a wrong one, finishes with the right one", async () => {
    api.start.mockResolvedValue({ attemptId: ATTEMPT, state: { status: "needs_password", hint: "horse" } })
    api.password
      .mockResolvedValueOnce({ state: { status: "needs_password", hint: "horse", error: "password_invalid" } })
      .mockResolvedValueOnce({ state: { status: "done", account: { id: "acc", label: "@x" } } })
    const { result } = renderHook(() => useTelegramLogin())

    await act(() => result.current.start(INPUT))
    expect(result.current.view).toEqual({ step: "password", hint: "horse" })
    await act(() => result.current.submitPassword("wrong"))
    expect(result.current.view).toEqual({ step: "password", hint: "horse", error: "password_invalid" })
    await act(() => result.current.submitPassword("right"))
    expect(result.current.view).toEqual({ step: "done", label: "@x" })
    expect(api.password).toHaveBeenLastCalledWith(ATTEMPT, "right")
  })

  it("the phone path goes code → done", async () => {
    api.start.mockResolvedValue({ attemptId: ATTEMPT, state: { status: "code_sent", delivery: "app" } })
    api.code.mockResolvedValue({ state: { status: "done", account: { id: "acc", label: "@x" } } })
    const { result } = renderHook(() => useTelegramLogin())
    await act(() => result.current.start({ ...INPUT, method: "phone", phone: "+15550001" }))
    expect(result.current.view).toEqual({ step: "code" })
    await act(() => result.current.submitCode("12345"))
    expect(result.current.view.step).toBe("done")
  })
})

describe("starts that do not begin", () => {
  it("a start refused by Telegram shows the reason, with no attempt to poll", async () => {
    api.start.mockResolvedValue({ state: { status: "failed", reason: "api_credentials_invalid" } })
    const { result } = renderHook(() => useTelegramLogin({ pollMs: 1_000 }))
    await act(() => result.current.start(INPUT))
    expect(result.current.view).toEqual({ step: "failed", reason: "api_credentials_invalid" })
  })

  it.each([
    ["rate_limited", "rate_limited"],
    ["consent_outdated", "consent_outdated"],
    ["telegram_unavailable", "unavailable"],
    ["invalid_request", "invalid"],
    ["something_else", "unknown"],
  ])("an HTTP %s refusal stays on the form as %s", async (code, error) => {
    api.start.mockRejectedValue(apiError(code))
    const { result } = renderHook(() => useTelegramLogin())
    await act(() => result.current.start(INPUT))
    expect(result.current.view).toEqual({ step: "form", error })
  })
})

describe("leaving", () => {
  it("cancel ends the attempt on the server and returns to the form", async () => {
    api.start.mockResolvedValue({ attemptId: ATTEMPT, state: PENDING })
    const { result } = renderHook(() => useTelegramLogin({ pollMs: 1_000 }))
    await act(() => result.current.start(INPUT))
    act(() => result.current.cancel())
    expect(api.cancel).toHaveBeenCalledWith(ATTEMPT)
    expect(result.current.view).toEqual({ step: "form" })
  })

  it("unmounting mid-login cancels the server-side attempt too", async () => {
    api.start.mockResolvedValue({ attemptId: ATTEMPT, state: PENDING })
    const { result, unmount } = renderHook(() => useTelegramLogin({ pollMs: 1_000 }))
    await act(() => result.current.start(INPUT))
    unmount()
    expect(api.cancel).toHaveBeenCalledWith(ATTEMPT)
  })

  it("a finished login is not cancelled on unmount", async () => {
    api.start.mockResolvedValue({ attemptId: ATTEMPT, state: { status: "done", account: { id: "a", label: null } } })
    const { result, unmount } = renderHook(() => useTelegramLogin())
    await act(() => result.current.start(INPUT))
    unmount()
    expect(api.cancel).not.toHaveBeenCalled()
  })
})
