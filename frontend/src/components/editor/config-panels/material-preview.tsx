"use client"

import { memo } from "react"
import { getMaterial } from "@nodaro-shared/materials"
import { cn } from "@/lib/utils"

interface MaterialPreviewProps {
  readonly materialId: string
  readonly className?: string
}

type SwatchStyle = { readonly background: string; readonly boxShadow?: string }

/**
 * Per-material gradient swatch used by the picker tiles and the Material
 * parameter node body. Each material gets a hand-tuned CSS gradient that
 * evokes its visual character (silk shimmer, chrome mirror, marble veins,
 * bronze patina, neon glow, etc.). No images — pure CSS so tiles render
 * instantly at any scale.
 *
 * Unknown ids fall back to a neutral grey wash so the picker never crashes.
 */
const SWATCHES: Record<string, SwatchStyle> = {
  // -------------------- Fabric --------------------
  silk: { background: "linear-gradient(135deg, #f5e9d3 0%, #e8c997 45%, #c6a15a 100%)" },
  cotton: { background: "linear-gradient(135deg, #fbfaf6 0%, #ece6d6 100%)" },
  denim: { background: "linear-gradient(135deg, #3c5a85 0%, #1f3556 100%)" },
  leather: { background: "linear-gradient(135deg, #6b3a1f 0%, #3a1d0a 100%)" },
  velvet: { background: "radial-gradient(circle at 30% 30%, #8f1b48 0%, #3b0a1c 100%)" },
  satin: { background: "linear-gradient(135deg, #fff3d1 0%, #e9c06b 40%, #a87426 100%)" },
  lace: { background: "repeating-radial-gradient(circle at 40% 40%, #f7f1e4 0 3px, #c9bfa6 4px 5px)" },
  wool: { background: "linear-gradient(135deg, #d9d1bd 0%, #8e836a 100%)" },
  linen: { background: "linear-gradient(135deg, #efe7d2 0%, #c9bb94 100%)" },
  tweed: { background: "repeating-linear-gradient(45deg, #6a5236 0 3px, #8a6f46 3px 6px, #3f2e1a 6px 9px)" },
  cashmere: { background: "linear-gradient(135deg, #e6d5b8 0%, #b08968 100%)" },
  chiffon: { background: "linear-gradient(135deg, rgba(240, 220, 230, 0.9) 0%, rgba(200, 170, 190, 0.75) 100%)" },
  fur: { background: "repeating-linear-gradient(20deg, #6b4d2b 0 2px, #a67c4f 2px 4px, #3c2617 4px 6px)" },

  // -------------------- Metal --------------------
  gold: { background: "linear-gradient(135deg, #fff2b2 0%, #e7c250 40%, #a37810 100%)" },
  silver: { background: "linear-gradient(135deg, #f5f5f7 0%, #b9bec5 40%, #6b7078 100%)" },
  bronze: { background: "linear-gradient(135deg, #b87d3b 0%, #6d4220 55%, #3a2310 100%)" },
  chrome: { background: "linear-gradient(135deg, #fdfdff 0%, #aab1ba 35%, #464a52 70%, #cdd2da 100%)" },
  copper: { background: "linear-gradient(135deg, #f5a372 0%, #b8602a 55%, #6a3010 100%)" },
  brass: { background: "linear-gradient(135deg, #ecc575 0%, #b58735 55%, #6e4a16 100%)" },
  steel: { background: "linear-gradient(90deg, #c3c7cc 0%, #7e858d 100%)" },
  iron: { background: "linear-gradient(135deg, #4b4a47 0%, #22201d 100%)" },
  platinum: { background: "linear-gradient(135deg, #e9ecf0 0%, #aab0b8 50%, #6c7278 100%)" },
  titanium: { background: "linear-gradient(135deg, #aab1b8 0%, #61686f 100%)" },

  // -------------------- Stone --------------------
  marble: { background: "linear-gradient(135deg, #f5f2ec 0%, #d6d0c3 100%), repeating-linear-gradient(45deg, transparent 0 10px, rgba(100,100,110,0.08) 10px 11px)" },
  granite: { background: "radial-gradient(circle at 30% 30%, #4a4a4a 0%, #1c1c1c 100%)" },
  obsidian: { background: "radial-gradient(ellipse at 30% 30%, #333 0%, #0a0a0c 100%)" },
  sandstone: { background: "linear-gradient(180deg, #d4a373 0%, #b07841 50%, #8b5a2b 100%)" },
  slate: { background: "linear-gradient(135deg, #4a5868 0%, #232a33 100%)" },
  jade: { background: "radial-gradient(circle at 35% 35%, #b6e4ba 0%, #3a8b5e 55%, #143d27 100%)" },
  onyx: { background: "repeating-linear-gradient(135deg, #0f0f12 0 8px, #3a3a42 8px 12px)" },
  concrete: { background: "linear-gradient(135deg, #b3b3ae 0%, #7d7d78 100%)" },

  // -------------------- Wood --------------------
  oak: { background: "repeating-linear-gradient(90deg, #b88353 0 6px, #97643a 6px 10px, #7c4a23 10px 14px)" },
  mahogany: { background: "repeating-linear-gradient(90deg, #6b2a1a 0 6px, #4d1a0f 6px 10px, #331109 10px 14px)" },
  walnut: { background: "repeating-linear-gradient(90deg, #4a2b13 0 5px, #6b3d1f 5px 9px, #2d1a09 9px 12px)" },
  bamboo: { background: "repeating-linear-gradient(0deg, #e6d083 0 10px, #b89950 10px 11px, #e6d083 11px 20px)" },
  birch: { background: "repeating-linear-gradient(90deg, #f3ead4 0 14px, #c0b593 14px 15px)" },
  driftwood: { background: "repeating-linear-gradient(90deg, #b9b0a3 0 6px, #888179 6px 10px, #c6bdb0 10px 14px)" },

  // -------------------- Glass / Ceramic --------------------
  glass: { background: "linear-gradient(135deg, rgba(200, 230, 245, 0.6) 0%, rgba(150, 200, 220, 0.3) 50%, rgba(220, 240, 250, 0.7) 100%)" },
  "stained-glass": { background: "conic-gradient(from 180deg at 50% 50%, #9b2b3b 0deg, #2b6b8b 90deg, #c59a1b 180deg, #2d7b3a 270deg, #9b2b3b 360deg)" },
  crystal: { background: "conic-gradient(from 45deg at 50% 50%, #ffffff, #c9e9ff, #ffffff, #e6c9ff, #ffffff)" },
  porcelain: { background: "linear-gradient(135deg, #ffffff 0%, #e8e5db 100%)" },
  "ceramic-glazed": { background: "radial-gradient(circle at 40% 35%, #d97441 0%, #8d3b17 100%)" },
  terracotta: { background: "linear-gradient(135deg, #d78864 0%, #a5512f 100%)" },

  // -------------------- Natural --------------------
  water: { background: "linear-gradient(135deg, #8fd4eb 0%, #3d8bb5 60%, #1a4a6b 100%)" },
  fire: { background: "radial-gradient(circle at 50% 70%, #ffd94a 0%, #f07a1a 40%, #8f2418 100%)" },
  ice: { background: "linear-gradient(135deg, #eafbff 0%, #b4dfea 45%, #6aa3b6 100%)" },
  smoke: { background: "radial-gradient(ellipse at 40% 60%, rgba(200,200,210,0.95) 0%, rgba(90,90,100,0.55) 100%)" },
  sand: { background: "linear-gradient(135deg, #e9d49f 0%, #b38848 100%)" },
  moss: { background: "radial-gradient(circle at 40% 40%, #6a9650 0%, #2c4a1e 100%)" },
  leaves: { background: "repeating-radial-gradient(circle at 30% 30%, #3a7a3a 0 8px, #1e4d1e 9px 12px)" },

  // -------------------- Exotic / Futuristic --------------------
  holographic: { background: "conic-gradient(from 0deg at 50% 50%, #ff6fd8, #3813c2, #17e7c8, #ffd56b, #ff6fd8)" },
  "liquid-metal": { background: "radial-gradient(ellipse at 35% 30%, #e8f0f6 0%, #6b7781 40%, #1e2228 100%)" },
  neon: { background: "linear-gradient(135deg, #ff1aaa 0%, #0affff 100%)", boxShadow: "inset 0 0 14px rgba(255,50,200,0.55), inset 0 0 22px rgba(20,240,255,0.35)" },
  translucent: { background: "linear-gradient(135deg, rgba(180, 230, 255, 0.4) 0%, rgba(150, 200, 240, 0.2) 100%)" },
  mirror: { background: "linear-gradient(135deg, #ffffff 0%, #dfe4ea 50%, #ffffff 100%)" },
  plasma: { background: "radial-gradient(circle at 50% 50%, #ffffff 0%, #e14bff 25%, #5b0ea8 70%, #1a0430 100%)" },
  "crystal-shard": { background: "conic-gradient(from 90deg at 50% 50%, #a0e8ff, #ffc0ef, #d4ffec, #9cc9ff, #a0e8ff)" },
  "obsidian-glass": { background: "linear-gradient(135deg, #2a2a33 0%, #070709 100%)" },
  "carbon-fiber": { background: "repeating-linear-gradient(45deg, #1c1c1f 0 4px, #2a2a2f 4px 8px), repeating-linear-gradient(-45deg, #1c1c1f 0 4px, #2a2a2f 4px 8px)" },
  "holographic-film": { background: "conic-gradient(from 30deg at 50% 50%, #ffd56b, #ff6fd8, #b18bff, #6affc4, #ffd56b)", boxShadow: "inset 0 0 18px rgba(255,255,255,0.25)" },
  iridescent: { background: "linear-gradient(135deg, #ffd6f5 0%, #d6c2ff 25%, #b8e8ff 50%, #c2ffd6 75%, #fff7c2 100%)" },
  mesh: { background: "repeating-linear-gradient(0deg, #4a4a52 0 1px, transparent 1px 6px), repeating-linear-gradient(90deg, #4a4a52 0 1px, transparent 1px 6px), #1a1a1d" },
  "mother-of-pearl": { background: "conic-gradient(from 60deg at 50% 50%, #fff5fb, #e0d6ff, #d6f0ff, #fff0c8, #ffe0e8, #fff5fb)", boxShadow: "inset 0 0 14px rgba(255,255,255,0.35)" },
  "patent-leather": { background: "linear-gradient(135deg, #1a1a1c 0%, #3a3a3e 30%, #0a0a0c 70%, #2a2a2e 100%)", boxShadow: "inset 0 6px 14px rgba(255,255,255,0.18)" },
  suede: { background: "radial-gradient(ellipse at 35% 30%, #b08560 0%, #6e4a2e 100%)" },
  terrazzo: { background: "radial-gradient(circle at 20% 30%, #6b9b8a 0 6px, transparent 7px), radial-gradient(circle at 70% 60%, #c97a4a 0 5px, transparent 6px), radial-gradient(circle at 45% 80%, #4a6b8a 0 4px, transparent 5px), radial-gradient(circle at 85% 25%, #d4c98a 0 5px, transparent 6px), #f0ebe1" },
}

const FALLBACK: SwatchStyle = {
  background: "linear-gradient(135deg, #d0d0d0 0%, #808080 100%)",
}

export const MaterialPreview = memo(function MaterialPreview({
  materialId,
  className,
}: MaterialPreviewProps) {
  const mat = getMaterial(materialId)
  const swatch = SWATCHES[materialId] ?? FALLBACK
  return (
    <div
      aria-hidden="true"
      title={mat?.label}
      className={cn(
        "rounded-md border border-black/10 dark:border-white/10 overflow-hidden",
        className,
      )}
      style={{
        background: swatch.background,
        boxShadow: swatch.boxShadow,
      }}
    />
  )
})
