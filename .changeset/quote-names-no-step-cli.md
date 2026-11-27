---
"@nodaro/cli": patch
---

`nodaro video-remake full-quality estimate --json` and `nodaro trends estimate --json` name nothing of how a size is made: a server that still answers `outputResolution`, `upscale` or `upscaleOffered` has its delivered size printed as `resolution` and the other two left out.
