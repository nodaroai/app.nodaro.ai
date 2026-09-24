import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "ultra-wide-14mm": { label: "אולטרה-רחב (14mm)", description: "זווית רחבה קיצונית, פרספקטיבה מוגזמת" },
  "wide-24mm": { label: "רחב (24mm)", description: "שדה ראייה רחב, סביבתי" },
  "standard-35mm": { label: "סטנדרט (35mm)", description: "פרספקטיבה טבעית, מראה דוקומנטרי" },
  "normal-50mm": { label: "נורמלי (50mm)", description: "הקרוב ביותר לתפיסת העין האנושית" },
  "portrait-85mm": { label: "פורטרט (85mm)", description: "דחיסה מחמיאה, בוקה קרמי" },
  "telephoto-135mm": { label: "טלה (135mm)", description: "עומק דחוס, סובייקט מבודד" },
  "super-telephoto-400mm": { label: "סופר-טלה (400mm)", description: "דחיסה קיצונית, סובייקט רחוק" },
  "fisheye": { label: "Fisheye", description: "עיוות חצי-כדורי 180°" },
  "anamorphic": { label: "Anamorphic", description: "קולנועי במסך רחב, בוקה אובלי" },
  "macro": { label: "Macro", description: "תקריב קיצוני של פרט קטן" },
  "tilt-shift": { label: "Tilt-shift", description: "פוקוס סלקטיבי, אפקט מיניאטורה" },
  "shallow-dof": { label: "DOF רדוד", description: "פוקוס דק כתער, בוקה חולמני" },
  "canon-k35": { description: "קולנועי וינטג', עור עדין וחם" },
  "cooke-s4": { description: "מראה Cooke — עור ציורי קרמי" },
  "helios-44": { description: "בוקה מסולסל סובייטי וינטג'" },
  "petzval": { description: "סחרור אולטרא-וינטג', דעיכה דרמטית" },
  "probe": { label: "עדשת גשש", description: "מאקרו צינורי — דרך חורים ומעברים צרים" },
  "cctv": { label: "מצלמת אבטחה", description: "מראה צילומי מצלמת אבטחה" },
}

export default map
