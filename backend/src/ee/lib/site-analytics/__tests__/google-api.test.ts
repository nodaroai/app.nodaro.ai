import { describe, expect, it } from "vitest"
import { googleErrorReason } from "../google-api.js"

describe("googleErrorReason", () => {
  it("an ErrorInfo detail's reason first", () => {
    const body = { error: { code: 403, status: "PERMISSION_DENIED", details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "SERVICE_DISABLED" }] } }
    expect(googleErrorReason(body)).toBe("SERVICE_DISABLED")
  })

  it("then the status", () => {
    expect(googleErrorReason({ error: { code: 403, status: "PERMISSION_DENIED", message: "User does not have sufficient permissions for this property." } })).toBe("PERMISSION_DENIED")
  })

  it("Search Console's older refusal (the body it really sends) reads as PERMISSION_DENIED", () => {
    const searchConsole = {
      error: {
        code: 403,
        message: "User does not have sufficient permission for site 'sc-domain:nodaro.ai'. See also: https://support.google.com/webmasters/answer/2451999.",
        errors: [{ message: "User does not have sufficient permission for site 'sc-domain:nodaro.ai'.", domain: "global", reason: "forbidden" }],
      },
    }
    expect(googleErrorReason(searchConsole)).toBe("PERMISSION_DENIED")
    expect(googleErrorReason({ error: { code: 403, errors: [{ reason: "insufficientPermissions" }] } })).toBe("PERMISSION_DENIED")
  })

  it("the older 'API not configured' reads as a turned-off API", () => {
    expect(googleErrorReason({ error: { code: 403, errors: [{ reason: "accessNotConfigured" }] } })).toBe("SERVICE_DISABLED")
  })

  it("another older reason passes through as Google wrote it; nothing to read is nothing", () => {
    expect(googleErrorReason({ error: { code: 429, errors: [{ reason: "quotaExceeded" }] } })).toBe("quotaExceeded")
    expect(googleErrorReason({ error: "invalid_grant" })).toBeUndefined()
    expect(googleErrorReason(null)).toBeUndefined()
  })
})
