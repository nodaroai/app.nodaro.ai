import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Engines (engine names kept as proper brand names)
  "unreal-engine-5": { description: "Look UE5 path-traced en temps réel" },
  "blender-cycles": { description: "Path tracing non biaisé Cycles" },
  "octane-render": { description: "Path tracing spectral GPU" },
  "redshift": { description: "Moteur de production GPU biaisé" },
  "houdini-mantra": { description: "Rendu physique de qualité VFX" },
  // Render-quality keywords
  "raytracing": { label: "Ray tracing", description: "Reflets et ombres précis" },
  "physically-based-rendering": { label: "PBR", description: "Matériaux physiquement réalistes" },
  "global-illumination": { label: "Illumination globale", description: "Rebond de lumière réaliste" },
  "lumen-reflections": { description: "Illumination globale dynamique en temps réel" },
  // Resolution / Detail (technical units kept)
  "8k-uhd": { description: "Résolution 8K ultra-nette" },
  "4k-uhd": { description: "Résolution 4K nette" },
  "16k-megapixel": { description: "Détail folle haute résolution" },
  "ultra-detailed": { label: "Ultra détaillé", description: "Rendu micro-détail maximal" },
  // Style stamps
  "raw-photo": { label: "Photo brute", description: "Sensation photographique non traitée" },
  "masterpiece": { label: "Chef-d'œuvre", description: "Sceau de qualité main d'expert" },
  "award-winning": { label: "Primé", description: "Calibre des circuits de prix" },
}

export default map
