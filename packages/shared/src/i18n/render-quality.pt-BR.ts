import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Engines — render engine names kept in English
  "unreal-engine-5": { description: "Visual do UE5 com path tracing em tempo real" },
  "blender-cycles": { description: "Path tracing imparcial do Cycles" },
  "octane-render": { description: "Path tracing espectral em GPU" },
  "redshift": { description: "Renderizador GPU enviesado de produção" },
  "houdini-mantra": { description: "Renderização física padrão VFX" },
  "arnold-render": { description: "Path tracer VFX padrão da indústria" },
  "corona-renderer": { description: "Renderizador imparcial fotorrealista para archviz" },
  "vray": { description: "Renderizador padrão da indústria para produto / archviz / VFX" },
  "aces": { description: "Gerenciamento de cor ACES com qualidade de cinema" },

  // Render-quality keywords
  "raytracing": { label: "Ray tracing", description: "Reflexos + sombras precisos" },
  "physically-based-rendering": { description: "Materiais baseados em física" },
  "global-illumination": { label: "Iluminação global", description: "Rebatimento realista da luz" },
  "lumen-reflections": { label: "Reflexos Lumen", description: "GI dinâmica em tempo real" },

  // Resolution / Detail — units kept in English
  "8k-uhd": { description: "Resolução 8K ultranítida" },
  "4k-uhd": { description: "Resolução 4K nítida" },
  "16k-megapixel": { description: "Resolução insanamente alta" },
  "ultra-detailed": { label: "Ultradetalhado", description: "Renderização com microdetalhes ao máximo" },

  // Style stamps
  "raw-photo": { label: "Foto RAW", description: "Sensação fotográfica não processada" },
  "masterpiece": { label: "Obra-prima", description: "Carimbo de qualidade de mestre" },
  "award-winning": { label: "Premiado", description: "Qualidade digna de prêmios" },
  "volumetric-lighting": { label: "Iluminação volumétrica", description: "Feixes volumétricos de luz formando god rays" },
  "photon-mapping": { label: "Photon mapping", description: "Renderizador de iluminação global por photon mapping, com cáusticas" },
  "ai-upscaled": { label: "Upscaling por IA", description: "Aprimoramento de detalhes via upscaling por rede neural" },
  "denoised": { label: "Sem ruído", description: "Renderização limpa, impecável, com remoção de ruído" },
}

export default map
