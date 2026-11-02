---
"@nodaro/sdk": minor
---

Content rights, the standing authorization: an import through an API key or an AI agent has nobody to tick a box per link, so the person authorizes those imports once, in their own session. `client.contentRights.authorization()` reads the account's current authorization (`null` when there is none, or it was given under an older declaration), `client.contentRights.authorize({ declarationVersion })` records one, and `client.contentRights.revokeAuthorization()` ends it. Every import a key or an agent then makes is recorded as a confirmation derived from it. `ImportRefusedError` gains the code `rights_authorization_required`: the deployment requires a confirmation, the import came through a key or an agent, and the account holds no standing authorization.
