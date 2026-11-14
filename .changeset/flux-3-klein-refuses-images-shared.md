---
"@nodaro/shared": patch
---

FLUX 3 Klein (`flux-3-klein`, `flux-3-klein-i2i`) declares its default size, `defaultResolution: "1K"`, so a client reads 1K from the catalog (`defaultResolutionFor`) rather than from the order of its sizes. A catalog entry can carry `refusesImagesOverLimit: true`: a run that would send the model more input images than `requestImageLimit` allows, a base image counted, is refused with a message saying how many to remove, and no image is left out to make it fit. Both FLUX 3 Klein ids carry it; every other model, Seedream 5.5 included, is unchanged. `refusesImagesOverLimit(model)` from `@nodaro/shared/models` reads it.
