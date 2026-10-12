---
"@nodaro/sdk": minor
---

`client.credits.claimSignupGrant(keys)` (`POST /v1/credits/claim-signup-grant`) claims the account's free signup grant with the browser signals of the page making the claim, and the new browser-only subpath `@nodaro/sdk/signup-signals` computes them (`collectSignupKeys`, `computeDeviceKey`, `computeBrowserKey`, `sha256Hex`; `@fingerprintjs/fingerprintjs` is an optional peer dependency for the browser key). Every Nodaro surface reports the same two signals through this one implementation. Additive.
