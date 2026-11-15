---
"@nodaro/sdk": minor
---

`ConnectedApp` (`client.connectedApps()`) gains an optional `grantedBy: "assertion_exchange"`, present on a grant an app obtained through the MCP assertion exchange — a deployment's own application getting MCP tokens for the user from its sign-in, with no consent screen (`POST /v1/oauth/token` with the `urn:ietf:params:oauth:grant-type:jwt-bearer` grant, where a deployment turns it on). Absent on every grant the user approved on a consent screen, so existing code is unaffected.
