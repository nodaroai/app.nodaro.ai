import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "unreal-engine-5": { description: "מראה UE5 של path-tracing בזמן אמת" },
  "blender-cycles": { description: "Path tracing לא מוטה של Cycles" },
  "octane-render": { description: "Path tracing ספקטרלי ב-GPU" },
  "redshift": { description: "Renderer מוטה GPU להפקה" },
  "houdini-mantra": { description: "רנדור פיזי ברמת VFX" },
  "arnold-render": { description: "Path tracer ל-VFX בתקן התעשייה" },
  "corona-renderer": { description: "Renderer לא מוטה פוטוריאליסטי ל-archviz" },
  "vray": { description: "Renderer הפקה למוצר / archviz / VFX בתקן התעשייה" },
  "aces": { description: "ניהול צבע ACES ברמה קולנועית" },

  "raytracing": { label: "Ray Tracing", description: "השתקפויות וצללים מדויקים" },
  "physically-based-rendering": { label: "PBR", description: "חומרים מבוססי-פיזיקה" },
  "global-illumination": { label: "תאורה גלובלית", description: "החזרי אור ריאליסטיים" },
  "lumen-reflections": { label: "Lumen Reflections", description: "GI דינמי בזמן אמת" },

  "8k-uhd": { label: "8K UHD", description: "רזולוציית 8K חדה במיוחד" },
  "4k-uhd": { label: "4K UHD", description: "רזולוציית 4K חדה" },
  "16k-megapixel": { label: "16K Megapixel", description: "פירוט ברזולוציה גבוהה במיוחד" },
  "ultra-detailed": { label: "מפורט במיוחד", description: "רנדור עם פירוט מקסימלי" },

  "raw-photo": { label: "תמונה גולמית", description: "תחושה צילומית לא מעובדת" },
  "masterpiece": { label: "יצירת מופת", description: "חותם איכות של יד מומחה" },
  "award-winning": { label: "זוכה פרסים", description: "ברמה של זוכי פרסים" },
  "volumetric-lighting": { label: "Volumetric Lighting", description: "פירי אור וולומטריים (god rays) החותכים את האטמוספרה" },
  "photon-mapping": { label: "Photon Mapping", description: "תאורה גלובלית photon-mapped מודעת ל-caustics" },
  "ai-upscaled": { label: "מוגדל ב-AI", description: "שיפור פירוט בהגדלה ברשת נוירונים" },
  "denoised": { label: "מנוקה מרעש", description: "רנדור נקי ללא רעש, ללא גרגירים או נקודות" },
}

export default map
