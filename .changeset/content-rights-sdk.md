---
"@nodaro/sdk": minor
---

Content rights: `client.contentRights.declaration()` reads the text a person confirms before a link is imported, `client.contentRights.confirm({ url, declarationVersion })` records the confirmation, and `media.downloadVideo` takes its id as `confirmationId`. A download without one is still accepted until the deployment turns `content_rights_required` on.
