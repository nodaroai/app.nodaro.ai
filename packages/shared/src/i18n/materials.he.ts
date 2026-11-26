import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Fabric
  "silk": { label: "משי", description: "משי חלק ומבריק" },
  "cotton": { label: "כותנה", description: "כותנה רכה מאט" },
  "denim": { label: "ג׳ינס", description: "ג׳ינס אינדיגו כבד" },
  "leather": { label: "עור", description: "עור איכותי וגמיש" },
  "velvet": { label: "קטיפה", description: "קטיפה רכה" },
  "satin": { label: "סאטן", description: "סאטן מבריק" },
  "lace": { label: "תחרה", description: "תחרה עדינה עם דוגמאות" },
  "wool": { label: "צמר", description: "צמר ארוג חמים" },
  "linen": { label: "פשתן", description: "פשתן טבעי עם טקסטורה" },
  "tweed": { label: "טוויד", description: "טוויד כפרי ארוג" },
  "cashmere": { label: "קשמיר", description: "קשמיר רך ויוקרתי" },
  "chiffon": { label: "שיפון", description: "שיפון שקוף זורם" },
  "fur": { label: "פרווה", description: "פרווה עבה ורכה" },

  // Metal
  "gold": { label: "זהב", description: "זהב מלוטש" },
  "silver": { label: "כסף", description: "כסף מלוטש" },
  "bronze": { label: "ברונזה", description: "ברונזה יצוקה עם פטינה" },
  "chrome": { label: "כרום", description: "כרום מבריק כמו מראה" },
  "copper": { label: "נחושת", description: "נחושת חמה עם פטינה" },
  "brass": { label: "פליז", description: "פליז עתיק" },
  "steel": { label: "פלדה", description: "פלדת אל־חלד מוברשת" },
  "iron": { label: "ברזל", description: "ברזל מחושל מחוספס" },
  "platinum": { label: "פלטינה", description: "פלטינה מבריקה" },
  "titanium": { label: "טיטניום", description: "טיטניום תעשייתי מאט" },

  // Stone
  "marble": { label: "שיש", description: "שיש לבן עם עורקים" },
  "granite": { label: "גרניט", description: "גרניט מנומר מלוטש" },
  "obsidian": { label: "אובסידיאן", description: "אובסידיאן שחור מבריק" },
  "sandstone": { label: "אבן חול", description: "אבן חול חמה בשכבות" },
  "slate": { label: "צפחה", description: "צפחה כהה ושטוחה" },
  "jade": { label: "ג׳ייד", description: "ג׳ייד ירוק שקוף־למחצה" },
  "onyx": { label: "אוניקס", description: "אוניקס מפוספס מלוטש" },
  "concrete": { label: "בטון", description: "בטון תעשייתי יצוק" },

  // Wood
  "oak": { label: "אלון", description: "אלון עם סיבים עשירים ובולטים" },
  "mahogany": { label: "מהוגני", description: "מהוגני אדום עמוק" },
  "walnut": { label: "אגוז", description: "אגוז כהה" },
  "bamboo": { label: "במבוק", description: "במבוק בהיר עם מקטעים" },
  "birch": { label: "ליבנה", description: "עץ ליבנה בהיר וחלק" },
  "driftwood": { label: "עץ סחף", description: "עץ סחף בלוי" },

  // Glass / Ceramic
  "glass": { label: "זכוכית", description: "זכוכית שקופה צלולה" },
  "stained-glass": { label: "ויטראז'", description: "ויטראז׳ בגווני אבני חן" },
  "crystal": { label: "קריסטל", description: "קריסטל צלול ומלוטש" },
  "porcelain": { label: "פורצלן", description: "פורצלן לבן חלק" },
  "ceramic-glazed": { label: "קרמיקה מזוגגת", description: "קרמיקה מזוגגת בגווני אדמה" },
  "terracotta": { label: "טרקוטה", description: "טרקוטה לא מזוגגת בגוון חם" },

  // Natural
  "water": { label: "מים", description: "מים זורמים שקופים" },
  "fire": { label: "אש", description: "להבה חיה" },
  "ice": { label: "קרח", description: "קרח גבישי שקוף־למחצה" },
  "smoke": { label: "עשן", description: "עשן אוורירי שנסחף ברוח" },
  "sand": { label: "חול", description: "חול גרגירי דק" },
  "moss": { label: "טחב", description: "טחב חי ושופע" },
  "leaves": { label: "עלים", description: "עלי צמחים בשכבות" },

  // Exotic
  "holographic": { label: "הולוגרפי", description: "הולוגרמה ססגונית" },
  "liquid-metal": { label: "מתכת נוזלית", description: "כרום נוזלי משקף" },
  "neon": { label: "זוהר ניאון", description: "צינורות ניאון זוהרים" },
  "translucent": { label: "שרף שקוף־למחצה", description: "שרף חלבי זוהר" },
  "mirror": { label: "מראה", description: "משטח מראה מושלם" },
  "plasma": { label: "פלזמה", description: "פלזמה חשמלית זוהרת" },
  "crystal-shard": { label: "שברי קריסטל", description: "קריסטל זוהר מנופץ" },
  "obsidian-glass": { label: "זכוכית אובסידיאן", description: "זכוכית געשית כהה" },
  "suede": { label: "זמש", description: "זמש רך ומוברש במרקם קטיפתי מט" },
  "mesh": { label: "רשת", description: "בד רשת שקוף" },
  "patent-leather": { label: "עור לכה", description: "עור לכה מבריק במיוחד" },
  "terrazzo": { label: "טרצו", description: "אבן מורכבת עם שברי שיש/זכוכית משובצים" },
  "iridescent": { label: "ססגוני", description: "משטח ססגוני שצבעו משתנה לפי הזווית" },
  "mother-of-pearl": { label: "אם הפנינה", description: "שכבה פנימית פנינית של קונכייה" },
  "carbon-fiber": { label: "סיבי פחמן", description: "סיבי פחמן שחורים ארוגים" },
  "holographic-film": { label: "פילם הולוגרפי", description: "הולוגרמה שוברת אור עם נצנוץ קשת" },
  "subsurface": { label: "זוהר פנימי", description: "אור זוהר מתחת לפני השטח" },
}

export default map
