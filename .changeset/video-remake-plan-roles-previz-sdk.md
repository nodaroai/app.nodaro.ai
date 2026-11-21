---
"@nodaro/sdk": minor
---

Video Remake plans the roles of a 3D previz clip: `videoRemake.planRoles()` takes `clipKind: "footage" | "previz"` and `previz` (`VideoRemakePrevizOptions`), as `run()` and `estimate()` do. With `clipKind: "previz"` each planned role comes back as a previz run's role: `name` is the locator of its model in the clip and `subject`, where one could be had, says who or what the model becomes. Send the roles to `estimate()` and `run()` as they are, with the same `clipKind`. `styleChoice()` answers `planRolesPreviz` (one boolean): send `clipKind` to `planRoles()` only where it is `true` (a server that does not plan such a clip refuses the field, 400 `validation_error`). `VideoRemakePlanRolesRefusalCode` gains the previz refusals a plan can answer: `previz_not_available`, `previz_needs_prism`, `previz_needs_clip_kind`, `previz_role_needs_locator` and `previz_not_for_trends`.
