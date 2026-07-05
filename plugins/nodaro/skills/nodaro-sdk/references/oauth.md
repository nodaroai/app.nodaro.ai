# OAuth apps (acting on behalf of other Nodaro users)

1. Create the app at https://app.nodaro.ai/settings/developer-apps —
   redirect URIs, allowed origins, scopes. `client_secret` is shown ONCE
   (rotate button exists).
2. Send the user to the consent screen; they Allow → you get a one-shot
   code (10-minute TTL).
3. Exchange server-side:

```ts
const tokens = await client.oauth.exchangeCode({
  grant_type: "authorization_code",
  client_id: process.env.NODARO_CLIENT_ID!,
  client_secret: process.env.NODARO_CLIENT_SECRET!,
  code, redirect_uri,
})
// then: new StaticTokenAuth(tokens.access_token) — token carries the granted scopes
```

Scopes gate routes (e.g. `workflows:execute`, `jobs:read`); a missing scope
surfaces as `ForbiddenError.missingScope`. Full walkthrough:
https://nodaroai.github.io/app.nodaro.ai/oauth-flow.md
