/**
 * The connect form's validators: what the wizard lets through to the server
 * is exactly the shape the server accepts, and pasted numbers are cleaned
 * the way people paste them.
 */
import { describe, it, expect } from "vitest"
import {
  EMPTY_FORM,
  FIELD_IDS,
  canSubmit,
  firstMissingField,
  isValidApiHash,
  isValidApiId,
  isValidPhone,
  normalizePhone,
  type ConnectFormValues,
} from "../connect-form"

const CONSENT = { version: "v1", points: ["a"] }
const READY: ConnectFormValues = { ...EMPTY_FORM, apiId: "123456", apiHash: "a".repeat(32), agreed: true }

describe("api_id and api_hash", () => {
  it.each(["1", "123456", " 42 ", "123456789012"])("accepts api_id %j", (value) => {
    expect(isValidApiId(value)).toBe(true)
  })

  it.each(["", "abc", "12.5", "-1", "1234567890123"])("refuses api_id %j", (value) => {
    expect(isValidApiId(value)).toBe(false)
  })

  it("api_hash is exactly 32 hex digits, either case, surrounding spaces ignored", () => {
    expect(isValidApiHash("0123456789abcdefABCDEF0123456789")).toBe(true)
    expect(isValidApiHash(` ${"f".repeat(32)} `)).toBe(true)
    expect(isValidApiHash("f".repeat(31))).toBe(false)
    expect(isValidApiHash("f".repeat(33))).toBe(false)
    expect(isValidApiHash(`${"f".repeat(31)}g`)).toBe(false)
  })
})

describe("phone", () => {
  it("drops the spaces, dashes and brackets people paste", () => {
    expect(normalizePhone("+1 (555) 000-1234")).toBe("+15550001234")
  })

  it.each(["+15550001234", "0501234567", "+1 (555) 000-1234"])("accepts %j", (value) => {
    expect(isValidPhone(value)).toBe(true)
  })

  it.each(["", "12345", "+1555abc1234", "++15550001234", "1".repeat(16)])("refuses %j", (value) => {
    expect(isValidPhone(value)).toBe(false)
  })
})

describe("canSubmit", () => {
  it("needs the terms loaded and accepted", () => {
    expect(canSubmit(READY, CONSENT)).toBe(true)
    expect(canSubmit(READY, undefined)).toBe(false)
    expect(canSubmit({ ...READY, agreed: false }, CONSENT)).toBe(false)
  })

  it("needs well-formed keys", () => {
    expect(canSubmit({ ...READY, apiId: "x" }, CONSENT)).toBe(false)
    expect(canSubmit({ ...READY, apiHash: "short" }, CONSENT)).toBe(false)
  })

  it("asks for a phone number only on the phone path", () => {
    expect(canSubmit({ ...READY, method: "qr", phone: "" }, CONSENT)).toBe(true)
    expect(canSubmit({ ...READY, method: "phone", phone: "" }, CONSENT)).toBe(false)
    expect(canSubmit({ ...READY, method: "phone", phone: "+15550001234" }, CONSENT)).toBe(true)
  })
})

describe("firstMissingField", () => {
  it("walks the form in screen order — keys, then phone, then the agreement", () => {
    expect(firstMissingField(EMPTY_FORM)).toBe(FIELD_IDS.apiId)
    expect(firstMissingField({ ...EMPTY_FORM, apiId: "1" })).toBe(FIELD_IDS.apiHash)
    expect(firstMissingField({ ...READY, agreed: false })).toBe(FIELD_IDS.agreed)
    expect(firstMissingField({ ...READY, method: "phone", phone: "", agreed: false })).toBe(FIELD_IDS.phone)
    expect(firstMissingField(READY)).toBeNull()
  })

  it("a malformed value stops Continue exactly like an empty one", () => {
    expect(firstMissingField({ ...READY, apiHash: "short" })).toBe(FIELD_IDS.apiHash)
    expect(firstMissingField({ ...READY, method: "phone", phone: "12" })).toBe(FIELD_IDS.phone)
  })
})
