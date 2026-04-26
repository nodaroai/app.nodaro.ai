import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "unreal-engine-5": { description: "Look UE5 con trazado de rayos en tiempo real" },
  "blender-cycles": { description: "Trazado de rayos sin sesgo en Cycles" },
  "octane-render": { description: "Trazado espectral de rayos en GPU" },
  "redshift": { description: "Renderizador GPU con sesgo de producción" },
  "houdini-mantra": { description: "Renderizado físico con calidad VFX" },

  "raytracing": { label: "Trazado de Rayos", description: "Reflejos + sombras precisas" },
  "physically-based-rendering": { label: "PBR", description: "Materiales físicamente basados" },
  "global-illumination": { label: "Iluminación Global", description: "Rebote realista de luz" },
  "lumen-reflections": { label: "Reflejos Lumen", description: "GI dinámico en tiempo real" },

  "8k-uhd": { label: "8K UHD", description: "Resolución 8K ultranítida" },
  "4k-uhd": { label: "4K UHD", description: "Resolución 4K crujiente" },
  "16k-megapixel": { label: "16K Megapíxel", description: "Detalle de resolución insanamente alta" },
  "ultra-detailed": { label: "Ultra Detallado", description: "Renderizado con máximo microdetalle" },

  "raw-photo": { label: "Foto en Crudo", description: "Sensación fotográfica sin procesar" },
  "masterpiece": { label: "Obra Maestra", description: "Sello de calidad de mano experta" },
  "award-winning": { label: "Premiado", description: "Calibre de circuito de premios" },

  // -------------------- Round 2 --------------------
  "volumetric-lighting": { label: "Iluminación Volumétrica", description: "Rayos volumétricos tipo god-ray" },
  "photon-mapping": { label: "Photon Mapping", description: "Iluminación global con photon mapping y cáusticas" },
  "ai-upscaled": { label: "Escalado con IA", description: "Mejora de detalle escalada por red neuronal" },
  "denoised": { label: "Sin Ruido", description: "Renderizado limpio prístino con ruido eliminado" },
}

export default map
