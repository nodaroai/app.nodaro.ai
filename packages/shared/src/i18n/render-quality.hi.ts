import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // ---------------------------- Engines ----------------------------
  "unreal-engine-5": { description: "Real-time path-traced UE5 look" },
  "blender-cycles": { description: "Cycles unbiased path tracing" },
  "octane-render": { description: "GPU spectral path tracing" },
  "redshift": { description: "Production GPU biased renderer" },
  "houdini-mantra": { description: "VFX-grade physical rendering" },

  // ---------------------------- Render-quality keywords ----------------------------
  "raytracing": { label: "Ray Tracing", description: "सटीक reflections + shadows" },
  "physically-based-rendering": { label: "PBR", description: "Physically-based materials" },
  "global-illumination": { label: "Global Illumination", description: "वास्तविक light bounce" },
  "lumen-reflections": { label: "Lumen Reflections", description: "Real-time dynamic GI" },

  // ---------------------------- Resolution / Detail ----------------------------
  "8k-uhd": { label: "8K UHD", description: "अल्ट्रा-शार्प 8K resolution" },
  "4k-uhd": { label: "4K UHD", description: "Crisp 4K resolution" },
  "16k-megapixel": { label: "16K Megapixel", description: "अत्यधिक उच्च-resolution detail" },
  "ultra-detailed": { label: "Ultra Detailed", description: "अधिकतम micro-detail rendering" },

  // ---------------------------- Style stamps ----------------------------
  "raw-photo": { label: "Raw Photo", description: "Unprocessed photographic एहसास" },
  "masterpiece": { label: "Masterpiece", description: "विशेषज्ञ-स्तर का quality stamp" },
  "award-winning": { label: "Award Winning", description: "Award-circuit caliber" },
}

export default map
