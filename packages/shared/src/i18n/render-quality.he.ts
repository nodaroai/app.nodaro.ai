import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "unreal-engine-5": { description: "מראה UE5 של path-tracing בזמן אמת" },
  "blender-cycles": { description: "Path tracing לא מוטה של Cycles" },
  "octane-render": { description: "GPU spectral path tracing" },
  "redshift": { description: "Renderer מוטה GPU להפקה" },
  "houdini-mantra": { description: "רנדור פיזי ברמת VFX" },

  "raytracing": { label: "Ray Tracing", description: "השתקפויות וצללים מדויקים" },
  "physically-based-rendering": { label: "PBR", description: "חומרים מבוססי-פיזיקה" },
  "global-illumination": { label: "Global Illumination", description: "קפיצת אור ריאליסטית" },
  "lumen-reflections": { label: "Lumen Reflections", description: "GI דינמי בזמן אמת" },

  "8k-uhd": { label: "8K UHD", description: "רזולוציית 8K חדה במיוחד" },
  "4k-uhd": { label: "4K UHD", description: "רזולוציית 4K חדה" },
  "16k-megapixel": { label: "16K Megapixel", description: "פירוט ברזולוציה גבוהה במיוחד" },
  "ultra-detailed": { label: "פרטי במיוחד", description: "רנדור עם פירוט מקסימלי" },

  "raw-photo": { label: "תמונה גולמית", description: "תחושה צילומית לא מעובדת" },
  "masterpiece": { label: "יצירת מופת", description: "חותם איכות של יד מומחה" },
  "award-winning": { label: "זוכה פרסים", description: "רמה של מעגל פרסים" },
  "volumetric-lighting": { label: "Volumetric Lighting", description: "פירי אור וולומטרי מסוג קרני אלוהים" },
  "photon-mapping": { label: "Photon Mapping", description: "תאורה גלובלית photon-mapped מודעת ל-caustics" },
  "ai-upscaled": { label: "AI Upscaled", description: "שיפור פירוט בהגדלה ברשת נוירונים" },
  "denoised": { label: "Denoised", description: "רנדור נקי, ללא רעש, מבריק" },
}

export default map
