---
"@nodaro/shared": patch
---

Seedance 2 continuation references are now 2 seconds — KIE rejects r2v reference videos shorter than 1.8s for the seedance-2 family ("video duration … must be greater than or equal to 1.8 … in r2v"), which made every 1-second continuation tail fail deterministically.

- New exports: `SEEDANCE_2_CONTINUATION_REF_SEC` (2 — the reference length every Seedance-2 chaining feature cuts and bills) and `SEEDANCE_2_R2V_MIN_REF_VIDEO_SEC` (1.8 — the verified provider floor).
- `SEEDANCE_2_EXTEND_STITCH.referenceTailSeconds` is now `SEEDANCE_2_CONTINUATION_REF_SEC` (was 1).
