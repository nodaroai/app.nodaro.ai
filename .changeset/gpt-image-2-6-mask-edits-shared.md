---
"@nodaro/shared": minor
---

GPT Image 2.6 Flare and Sunburst edits take an inpainting mask: `gpt-image-2-6-flare-i2i` and `gpt-image-2-6-sunburst-i2i` join `I2I_MASK_SUPPORT`, and their catalog entries list the `mask` feature (`/v1/models`, MCP `list_models`). The rest of the picture is kept as it was, and a mask costs nothing extra.
