---
"@nodaro/shared": minor
"@nodaro/prompts": minor
---

FLUX 3 Klein joins the catalog as a text-to-image id (`flux-3-klein`, in `IMAGE_GEN_PROVIDERS`) and an edit id (`flux-3-klein-i2i`, in `IMAGE_I2I_PROVIDERS`); a text-to-image request with reference images runs on the edit id (`T2I_TO_I2I_VARIANT`). It is the light model of FLUX 3 from Black Forest Labs, a different model from FLUX 2 Klein. It renders at `1K` (the default), `2K` or `4K` in nine aspect ratios, and the edit adds `auto`, listed last; both entries declare `strictAspectRatios`. It writes `png` (the default) or `jpeg` (`outputFormats`). An edit takes 1 to 10 images, a base image included, and it takes a seed. It is priced by size alone, the same on both ids, with no charge per reference image: `flux3KleinCreditId` builds `flux-3-klein:<size>` and, whenever an image is sent, `flux-3-klein-i2i:<size>`. New: the `FLUX_3_KLEIN_*` constants, `isFlux3Klein`, `isFlux3KleinI2i` and `flux3KleinResolution`, and `priceReadsInputImages`, true for a model whose price id reads the images a run sends (the models priced per input image, and FLUX 3 Klein): `pricedSentImages` now counts a base image for it too. The prompt wizard describes both new ids.

`assembleImageInput` takes `reservedImageSeats`: seats of the model's reference limit another image of the run takes (a base image FLUX 3 Klein counts against its limit). A moodboard's style references fill only the seats left; 0, the default, changes nothing.
