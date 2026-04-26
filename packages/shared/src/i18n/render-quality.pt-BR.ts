import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Engines — render engine names kept in English
  "unreal-engine-5": { description: "Visão UE5 com path tracing em tempo real" },
  "blender-cycles": { description: "Path tracing imparcial do Cycles" },
  "octane-render": { description: "Path tracing espectral em GPU" },
  "redshift": { description: "Renderizador GPU enviesado de produção" },
  "houdini-mantra": { description: "Renderização física padrão VFX" },

  // Render-quality keywords
  "raytracing": { label: "Ray Tracing", description: "Reflexos + sombras precisos" },
  "physically-based-rendering": { description: "Materiais fisicamente baseados" },
  "global-illumination": { label: "Iluminação Global", description: "Refração realista de luz" },
  "lumen-reflections": { label: "Reflexos Lumen", description: "GI dinâmica em tempo real" },

  // Resolution / Detail — units kept in English
  "8k-uhd": { description: "Resolução 8K ultranítida" },
  "4k-uhd": { description: "Resolução 4K nítida" },
  "16k-megapixel": { description: "Resolução insanamente alta" },
  "ultra-detailed": { label: "Ultra Detalhado", description: "Renderização com microdetalhes ao máximo" },

  // Style stamps
  "raw-photo": { label: "Foto Crua", description: "Sensação fotográfica não processada" },
  "masterpiece": { label: "Obra-Prima", description: "Carimbo de qualidade de mestre" },
  "award-winning": { label: "Premiado", description: "Calibre de circuito de prêmios" },
}

export default map
