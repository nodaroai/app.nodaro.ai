---
"@nodaro/sdk": patch
---

Video Remake: a run's roles share one limit. `VideoRemakeParams.roles` takes at most 15 roles in all, in any mix of person, pet, product and location roles (it was at most 6 person, 1 location, 3 pet and 3 product roles). More than one location role is allowed, each naming a different setting of the video; two with the same name, or two left unnamed, are refused with `place_roles_need_names`. The 30 images of a run are counted as sent: a role whose pictures are prepared sends one. A run whose preparation fails and whose own pictures then pass the engine's limit fails (the run's own fee is refunded; the pictures already prepared stay charged): with the code `too_many_images_prism` on Nodaro Prism, `too_many_images` on Nodaro Pulse. A previz clip takes several location roles too. A trend's run is unchanged. The doc comments of `VideoRemakeParams.roles` and of the resource's refusals say so; no type changes.
