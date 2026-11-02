---
"@nodaro/sdk": minor
---

`trendRadar.approve(id, { confirmationId })` passes the admin's content rights confirmation (`contentRights.confirm({ url: candidate.topPost.url, declarationVersion })`) for the top post's clip, which is downloaded under it when the candidate becomes a draft trend. A confirmation that does not fit the top post as the server has it answers `403` with the content rights code before anything is created.
