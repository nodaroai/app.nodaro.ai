import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "unreal-engine-5": { description: "מראה UE5 של path-tracing בזמן אמת" },
  "blender-cycles": { description: "Path tracing לא מוטה של Cycles" },
  "octane-render": { description: "Path tracing ספקטרלי ב־GPU" },
  "redshift": { description: "מנוע רינדור מוטה שרץ על GPU, לעבודות הפקה" },
  "houdini-mantra": { description: "רינדור פיזיקלי ברמת VFX" },
  "arnold-render": { description: "מנוע path tracing ל־VFX, סטנדרט בתעשייה" },
  "corona-renderer": { description: "מנוע רינדור לא מוטה פוטוריאליסטי להדמיות אדריכליות" },
  "vray": { description: "מנוע רינדור סטנדרטי בתעשייה למוצרים, הדמיות אדריכליות ו־VFX" },
  "aces": { description: "ניהול צבע ACES ברמה קולנועית" },

  "raytracing": { label: "Ray Tracing", description: "השתקפויות וצללים מדויקים" },
  "physically-based-rendering": { label: "PBR", description: "חומרים מבוססי־פיזיקה" },
  "global-illumination": { label: "תאורה גלובלית", description: "החזרי אור ריאליסטיים" },
  "lumen-reflections": { label: "Lumen Reflections", description: "GI דינמי בזמן אמת" },

  "8k-uhd": { label: "8K UHD", description: "רזולוציית 8K חדה במיוחד" },
  "4k-uhd": { label: "4K UHD", description: "רזולוציית 4K חדה" },
  "16k-megapixel": { label: "16K Megapixel", description: "פירוט ברזולוציה גבוהה במיוחד" },
  "ultra-detailed": { label: "מפורט במיוחד", description: "רינדור בפירוט מקסימלי, עד הפרט הקטן" },

  "raw-photo": { label: "תמונה גולמית", description: "מראה של צילום גולמי, ללא עיבוד" },
  "masterpiece": { label: "יצירת מופת", description: "איכות של עבודת אמן" },
  "award-winning": { label: "זוכה פרסים", description: "ברמה של זוכי פרסים" },
  "volumetric-lighting": { label: "תאורה וולומטרית", description: "אלומות אור וולומטריות (god rays) שחוצות את האוויר" },
  "photon-mapping": { label: "Photon Mapping", description: "תאורה גלובלית ב־photon mapping, כולל caustics" },
  "ai-upscaled": { label: "מוגדל ב־AI", description: "הגדלה ברשת נוירונים שמשפרת את הפירוט, ברזולוציה גבוהה וחדה" },
  "denoised": { label: "מנוקה מרעש", description: "רינדור נקי מרעש, בלי גרגירים או נקודות" },
}

export default map
