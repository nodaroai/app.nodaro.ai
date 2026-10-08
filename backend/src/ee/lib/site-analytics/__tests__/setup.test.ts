import { describe, expect, it } from "vitest"
import { parseServiceAccount, resolveSetup } from "../setup.js"

const EMAIL = "reader@nodaro-analytics.iam.gserviceaccount.com"
const KEY = "-----BEGIN PRIVATE KEY-----\nMIIEabc\n-----END PRIVATE KEY-----\n"
const KEY_FILE = JSON.stringify({ type: "service_account", project_id: "p", client_email: EMAIL, private_key: KEY })

describe("parseServiceAccount", () => {
  it("reads the key file as Google hands it out", () => {
    expect(parseServiceAccount(KEY_FILE)).toEqual({ ok: true, account: { clientEmail: EMAIL, privateKey: KEY } })
  })

  it("reads it base64-encoded, the way a one-line variable often holds it", () => {
    const encoded = Buffer.from(KEY_FILE, "utf8").toString("base64")
    expect(parseServiceAccount(encoded)).toEqual({ ok: true, account: { clientEmail: EMAIL, privateKey: KEY } })
  })

  it("restores a private key whose newlines arrived escaped", () => {
    const escaped = JSON.stringify({ client_email: EMAIL, private_key: KEY.replace(/\n/g, "\\n") })
    const parsed = parseServiceAccount(escaped)
    expect(parsed.ok && parsed.account.privateKey).toBe(KEY)
  })

  it("refuses a file without the email or the key, and text that is not a key file", () => {
    expect(parseServiceAccount(JSON.stringify({ private_key: KEY })).ok).toBe(false)
    expect(parseServiceAccount(JSON.stringify({ client_email: EMAIL, private_key: "not a key" })).ok).toBe(false)
    expect(parseServiceAccount("hello").ok).toBe(false)
    expect(parseServiceAccount("{ broken").ok).toBe(false)
  })

  it("an RSA-format or cut-off key is a setup problem now, not a sign-in failure later", () => {
    const rsa = parseServiceAccount(JSON.stringify({ client_email: EMAIL, private_key: "-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----\n" }))
    expect(rsa).toEqual({ ok: false, problem: expect.stringMatching(/older RSA format/) })
    const cut = parseServiceAccount(JSON.stringify({ client_email: EMAIL, private_key: "-----BEGIN PRIVATE KEY-----\nMIIE" }))
    expect(cut.ok).toBe(false)
  })
})

describe("resolveSetup", () => {
  it("nothing set: one problem per variable, each naming it", () => {
    const setup = resolveSetup({ serviceAccountJson: "", ga4PropertyId: "", searchConsoleSite: "" })
    expect(setup.account).toBeNull()
    expect(setup.ga4PropertyId).toBeNull()
    expect(setup.searchConsoleSite).toBeNull()
    expect(setup.problems).toHaveLength(3)
    expect(setup.problems.join(" ")).toMatch(/SITE_ANALYTICS_SERVICE_ACCOUNT_JSON/)
    expect(setup.problems.join(" ")).toMatch(/SITE_ANALYTICS_GA4_PROPERTY_ID/)
    expect(setup.problems.join(" ")).toMatch(/SITE_ANALYTICS_SEARCH_CONSOLE_SITE/)
  })

  it("normalizes the property id and the site as the admin may paste them", () => {
    const setup = resolveSetup({ serviceAccountJson: KEY_FILE, ga4PropertyId: " properties/537345785 ", searchConsoleSite: "sc-domain:Nodaro.AI" })
    expect(setup.problems).toEqual([])
    expect(setup.account?.clientEmail).toBe(EMAIL)
    expect(setup.ga4PropertyId).toBe("537345785")
    expect(setup.searchConsoleSite).toBe("sc-domain:nodaro.ai")
    expect(resolveSetup({ serviceAccountJson: KEY_FILE, ga4PropertyId: "537345785", searchConsoleSite: "https://nodaro.ai" }).searchConsoleSite).toBe("https://nodaro.ai/")
  })

  it("a URL-prefix site always ends in a slash, so /blog never covers /blogger; one with a query or fragment is refused", () => {
    const at = (site: string) => resolveSetup({ serviceAccountJson: KEY_FILE, ga4PropertyId: "1", searchConsoleSite: site }).searchConsoleSite
    expect(at("https://example.com/blog")).toBe("https://example.com/blog/")
    expect(at("https://example.com/blog/")).toBe("https://example.com/blog/")
    expect(at("https://example.com/?x=1")).toBeNull()
    expect(at("https://example.com/?")).toBeNull()
    expect(at("https://example.com/#")).toBeNull()
    expect(at("https://user@example.com/")).toBeNull()
  })

  it("the setup names the key file's own problem — an RSA key says so", () => {
    const rsaFile = JSON.stringify({ client_email: EMAIL, private_key: "-----BEGIN RSA PRIVATE KEY-----\nMIIE\n-----END RSA PRIVATE KEY-----\n" })
    const setup = resolveSetup({ serviceAccountJson: rsaFile, ga4PropertyId: "1", searchConsoleSite: "sc-domain:nodaro.ai" })
    expect(setup.problems).toEqual([expect.stringMatching(/older RSA format/)])
  })

  it("a value that cannot be right is a problem on the page, never a crash", () => {
    const setup = resolveSetup({ serviceAccountJson: "hello", ga4PropertyId: "G-ABC123", searchConsoleSite: "nodaro.ai" })
    expect(setup.account).toBeNull()
    expect(setup.ga4PropertyId).toBeNull()
    expect(setup.searchConsoleSite).toBeNull()
    expect(setup.problems).toHaveLength(3)
  })
})
