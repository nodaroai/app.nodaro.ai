import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Fabric
  "silk": { label: "משי", description: "משי חלק ומבריק" },
  "cotton": { label: "כותנה", description: "כותנה רכה מאט" },
  "denim": { label: "ג'ינס", description: "ג'ינס אינדיגו כבד" },
  "leather": { label: "עור", description: "עור עשיר וגמיש" },
  "velvet": { label: "קטיפה", description: "קטיפה רכה" },
  "satin": { label: "סאטן", description: "סאטן מבריק" },
  "lace": { label: "תחרה", description: "תחרה עדינה עם דוגמאות" },
  "wool": { label: "צמר", description: "צמר ארוג חמים" },
  "linen": { label: "פשתן", description: "פשתן טבעי עם טקסטורה" },
  "tweed": { label: "Tweed", description: "Tweed כפרי ארוג" },
  "cashmere": { label: "קשמיר", description: "קשמיר רך מפואר" },
  "chiffon": { label: "שיפון", description: "שיפון שקוף זורם" },
  "fur": { label: "פרווה", description: "פרווה עבה ורכה" },

  // Metal
  "gold": { label: "זהב", description: "זהב מלוטש" },
  "silver": { label: "כסף", description: "כסף מלוטש" },
  "bronze": { label: "ברונזה", description: "ברונזה יצוקה עם פטינה" },
  "chrome": { label: "כרום", description: "כרום היפר-משקף" },
  "copper": { label: "נחושת", description: "נחושת חמה עם פטינה" },
  "brass": { label: "פליז", description: "פליז עתיק" },
  "steel": { label: "פלדה", description: "פלדת אל-חלד מוברשת" },
  "iron": { label: "ברזל", description: "ברזל מחושל מחוספס" },
  "platinum": { label: "פלטינום", description: "פלטינום מבריק" },
  "titanium": { label: "טיטניום", description: "טיטניום תעשייתי מאט" },

  // Stone
  "marble": { label: "שיש", description: "שיש לבן עם ורידים" },
  "granite": { label: "גרניט", description: "גרניט מנומר מלוטש" },
  "obsidian": { label: "אובסידיאן", description: "אובסידיאן שחור מבריק" },
  "sandstone": { label: "אבן חול", description: "אבן חול חמה בשכבות" },
  "slate": { label: "צפחה", description: "צפחה כהה ושטוחה" },
  "jade": { label: "ג'ייד", description: "ג'ייד ירוק שקוף-למחצה" },
  "onyx": { label: "אוניקס", description: "אוניקס פסים מלוטש" },
  "concrete": { label: "בטון", description: "בטון תעשייתי יצוק" },

  // Wood
  "oak": { label: "אלון", description: "אלון עשיר עם גרגיר" },
  "mahogany": { label: "מהוגני", description: "מהוגני אדום עמוק" },
  "walnut": { label: "אגוז", description: "אגוז כהה" },
  "bamboo": { label: "במבוק", description: "במבוק בהיר עם מקטעים" },
  "birch": { label: "ליבנה", description: "ליבנה חיוור וחלק" },
  "driftwood": { label: "Driftwood", description: "Driftwood בלוי" },

  // Glass / Ceramic
  "glass": { label: "זכוכית", description: "זכוכית שקופה צלולה" },
  "stained-glass": { label: "ויטראז'", description: "ויטראז' בגווני אבן חן" },
  "crystal": { label: "קריסטל", description: "קריסטל צלול עם פאות" },
  "porcelain": { label: "פורצלן", description: "פורצלן לבן חלק" },
  "ceramic-glazed": { label: "קרמיקה מזוגגת", description: "קרמיקה מזוגגת אדמתית" },
  "terracotta": { label: "Terracotta", description: "Terracotta חמה לא מזוגגת" },

  // Natural
  "water": { label: "מים", description: "מים זורמים שקופים" },
  "fire": { label: "אש", description: "להבה חיה" },
  "ice": { label: "קרח", description: "קרח גבישי שקוף-למחצה" },
  "smoke": { label: "עשן", description: "עשן אתרי נסחף" },
  "sand": { label: "חול", description: "חול גרגירי דק" },
  "moss": { label: "טחב", description: "טחב חי עשיר" },
  "leaves": { label: "עלים", description: "עלי צמחים בשכבות" },

  // Exotic
  "holographic": { label: "הולוגרפי", description: "הולוגרמה איריסית" },
  "liquid-metal": { label: "מתכת נוזלית", description: "כרום נוזלי משקף" },
  "neon": { label: "זוהר ניאון", description: "צינורות ניאון זוהרים" },
  "translucent": { label: "שרף שקוף-למחצה", description: "שרף זוהר Frosted" },
  "mirror": { label: "מראה", description: "משטח מראה מושלם" },
  "plasma": { label: "פלזמה", description: "פלזמה חשמלית זוהרת" },
  "crystal-shard": { label: "שברי קריסטל", description: "קריסטל זוהר מנופץ" },
  "obsidian-glass": { label: "זכוכית אובסידיאן", description: "זכוכית געשית כהה" },
  "suede": { label: "זמש", description: "עור מנופץ רך, משטח קטיפתי מאט" },
  "mesh": { label: "רשת", description: "בד רשת שקוף, ספורטיבי / שכבה שקופה" },
  "patent-leather": { label: "עור פטנט", description: "עור משקף מבריק" },
  "terrazzo": { label: "טרצו", description: "אבן מורכבת עם שברי שיש/זכוכית משובצים" },
  "iridescent": { label: "איריסי", description: "משטח קשת מחליף צבעים" },
  "mother-of-pearl": { label: "אם הפנינה", description: "פנים פנימיים של קונכייה איריסית בגוון שמנת" },
  "carbon-fiber": { label: "סיבי פחמן", description: "קומפוזיט סיבי פחמן ארוג שחור" },
  "holographic-film": { label: "פילם הולוגרפי", description: "הולוגרמה שוברת אור עם נצנוץ קשת" },
  "subsurface": { label: "זוהר תת-פני", description: "אור זוהר מתחת לפני השטח" },
}

export default map
