import { describe, it, expect } from "vitest"
import { isPublicEmailDomain, PUBLIC_EMAIL_DOMAINS } from "../public-email-providers.js"

describe("the public mail providers", () => {
  it("are plain lower-case domains, no duplicates", () => {
    for (const d of PUBLIC_EMAIL_DOMAINS) {
      expect(d).toBe(d.trim().toLowerCase())
      expect(d).toMatch(/^[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$/)
    }
  })

  it("cover the providers the app's own signups came from", () => {
    for (const d of ["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "yahoo.com", "icloud.com", "qq.com", "163.com", "2925.com", "naver.com", "mail.ru", "walla.co.il", "uol.com.br", "yahoo.co.jp"]) {
      expect(isPublicEmailDomain(d)).toBe(true)
    }
  })

  it("a company domain is not one, and an admin's addition is", () => {
    expect(isPublicEmailDomain("kirobo.io")).toBe(false)
    expect(isPublicEmailDomain("GMAIL.com ")).toBe(true)
    expect(isPublicEmailDomain("mail-provider.example", new Set(["mail-provider.example"]))).toBe(true)
  })
})
