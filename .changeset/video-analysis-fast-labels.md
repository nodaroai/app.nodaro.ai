---
"@nodaro/shared": patch
---

Video Analysis catalog: the live fast model (`gemini-3-flash-video-analysis`) is labelled "Video Analysis (Fast)" and the retired one (`gemini-3.6-flash-video-analysis`) "Video Analysis (Fast — legacy)". The two labels and descriptions were swapped, so `/v1/models` and `list_models` showed the legacy model as the fast tier.
