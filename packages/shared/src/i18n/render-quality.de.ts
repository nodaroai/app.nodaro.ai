import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "unreal-engine-5": { description: "Echtzeit-pathgetracter UE5-Look" },
  "blender-cycles": { description: "Cycles unverzerrtes Path Tracing" },
  "octane-render": { description: "GPU-Spektral-Path-Tracing" },
  "redshift": { description: "Produktions-GPU-biased Renderer" },
  "houdini-mantra": { description: "VFX-grade physikalisches Rendering" },
  "raytracing": { label: "Raytracing", description: "Genaue Reflexionen + Schatten" },
  "physically-based-rendering": { description: "Physikalisch basierte Materialien" },
  "global-illumination": { label: "Globale Beleuchtung", description: "Realistischer Lichtbounce" },
  "lumen-reflections": { description: "Echtzeit-dynamische GI" },
  "8k-uhd": { description: "Ultra-scharfe 8K-Auflösung" },
  "4k-uhd": { description: "Knackige 4K-Auflösung" },
  "16k-megapixel": { description: "Unfassbar hochauflösendes Detail" },
  "ultra-detailed": { label: "Ultra-Detailliert", description: "Maximales Mikrodetail-Rendering" },
  "raw-photo": { label: "Roh-Foto", description: "Unbearbeitetes fotografisches Gefühl" },
  "masterpiece": { label: "Meisterwerk", description: "Hand-eines-Experten-Qualitätsstempel" },
  "award-winning": { label: "Preisgekrönt", description: "Auszeichnungs-Kaliber" },
  "volumetric-lighting": { label: "Volumetrisches Licht", description: "God-Ray-volumetrische Lichtschächte" },
  "photon-mapping": { label: "Photon Mapping", description: "Kaustik-bewusste photongemappte globale Beleuchtung" },
  "ai-upscaled": { label: "KI-hochskaliert", description: "Mit neuronalem Netzwerk hochskalierte Detailverbesserung" },
  "denoised": { label: "Entrauscht", description: "Sauberes rauschbefreites makelloses Rendering" },
}

export default map
