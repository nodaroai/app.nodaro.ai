---
"@nodaro/sdk": minor
---

`client.credits.claimWelcomeOffer()` accepts an optional `locale` — the interface language the user answered in, the id of a language Nodaro ships such as `"en"`, `"ja"` or `"pt-BR"`. It is recorded with the consent as the language of the latest one; a value that does not match an id exactly is stored as absent, never refused.
