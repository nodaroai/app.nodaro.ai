---
"@nodaro/shared": minor
"@nodaro/prompts": patch
---

MiniMax H3 Image joins the catalog as a text-to-image id (`minimax-h3-image`, in `IMAGE_GEN_PROVIDERS`) and an edit id (`minimax-h3-image-i2i`, in `IMAGE_I2I_PROVIDERS`); a text-to-image request with reference images runs on the edit id (`T2I_TO_I2I_VARIANT`). It renders at 1K, 2K (the default) or 4K in ten aspect ratios or `auto`, writes PNG or JPEG, takes a seed, and an edit takes 1 to 16 reference images. It is priced by size, the same at 1K and 2K, and an edit also by each reference image: `minimaxH3ImageCreditId` builds `minimax-h3-image:<size>` and `minimax-h3-image-i2i:<size>:<N>ref`.

`isPricedPerInputImage`, `pricedSentImages` and `pricedEstimatedImages` count the input images a run sends for every model priced per input image (GPT Image 2.6 Flare and Sunburst, MiniMax H3 Image). `gptImage26SentImages` and `gptImage26EstimatedImages` are deprecated in their favour; their results are unchanged. The prompt wizard describes both new ids.
