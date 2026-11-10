---
"@nodaro/sdk": minor
---

`SurfaceAvailability` (`client.surface.availability()`) types `models.restricted`, which `GET /v1/surface/availability` now serves: `true` when the deployment restricts models (a profile `models.allow` / `models.deny`, or an Admin → Availability models override that leaves a model off). A model an admin switched off is listed in `models.denied` without being a restriction. The field is optional: a server that predates it omits it, which reads as `false`.
