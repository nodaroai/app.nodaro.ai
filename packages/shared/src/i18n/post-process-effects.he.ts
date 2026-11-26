import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  "vignette-soft": { label: "ויניטה רכה", description: "החשכת פינות עדינה" },
  "vignette-heavy": { label: "ויניטה כבדה", description: "פינות שחורות דרמטיות" },
  "dodge-and-burn": { label: "Dodge & Burn", description: "פיסול אורות וצללים" },
  "film-grain-fine": { label: "גרגירי פילם דקים", description: "גרגירים דקים בסגנון 35mm" },
  "film-grain-heavy": { label: "גרגירי פילם כבדים", description: "גרגירים גסים מפיתוח push" },
  "halation-glow": { label: "זוהר Halation", description: "הילה אדומה זוהרת סביב האורות, בסגנון Cinestill" },
  "bloom-glow": { label: "זוהר Bloom", description: "Bloom של היילייטים חולמני ורומנטי" },
  "chromatic-aberration": { label: "סטייה כרומטית", description: "הילה אדומה/טורקיז על קצוות" },
  "light-leak": { label: "דליפת אור", description: "פס אור חם לרוחב הפריים" },
  "film-burn": { label: "צריבת פילם", description: "פלייר בפינת הפריים, בסגנון Super-8 וינטג׳" },
  "scratched-emulsion": { label: "אמולסיה שרוטה", description: "שריטות ואבק של פילם ישן" },
  "color-fringe": { label: "הילה צבעונית", description: "הילה עדינה בקונטרסט גבוה" },
  "soft-focus-diffusion": { label: "פוקוס רך מפוזר", description: "Bloom חולמני מעורפל בהיילייטים" },
  "contrast-boost": { label: "הגברת קונטרסט", description: "צללים סגורים והיילייטים מוגברים" },
  "sharpening": { label: "חידוד כבד", description: "חידוד קצוות אגרסיבי, מיקרו־פרטים חדים" },
  "clarity-boost": { label: "הגברת צלילות", description: "שיפור צלילות גוונים בינוניים, הגברת קונטרסט מקומי" },
  "dehaze": { label: "הסרת אובך", description: "הסרת אובך: פחות רכות ויותר קונטרסט מבעד לערפל" },
  "lift-gamma-gain": { label: "Lift-Gamma-Gain", description: "גריידינג בשלושה גלגלי צבע: lift בצללים, gamma בגוונים הבינוניים, gain בהיילייטים" },
}

export default map
