import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Editorial / Fashion
  "fashion-editorial": { label: "אדיטוריאל אופנה", description: "כפולת מגזין של אופנה גבוהה" },
  "vogue-editorial": { label: "אדיטוריאל Vogue", description: "אדיטוריאל שער בסגנון Vogue" },
  "magazine-cover": { label: "שער מגזין", description: "קומפוזיציית שער בפריים צמוד" },
  "lookbook": { label: "לוקבוק", description: "צילום תלבושת נקי בסגנון לוקבוק" },
  "ecommerce-flatlay": { label: "Flat Lay של איקומרס", description: "Flat lay של מוצר מלמעלה" },
  "beauty-editorial": { label: "אדיטוריאל ביוטי", description: "Close-up מאקרו של ביוטי / טיפוח עור" },
  "campaign-advertising": { label: "קמפיין / פרסומת", description: "תמונת קמפיין מותג מלוטשת" },

  "brand-vogue": { label: "סגנון Vogue", description: "סגנון אדיטוריאל מובהק של מגזין Vogue" },
  "brand-dior": { label: "סגנון Dior", description: "אדיטוריאל Dior — chiaroscuro וצללית" },
  "brand-jil-sander": { label: "מינימליזם של Jil Sander", description: "Jil Sander — מינימליסטי, אדריכלי, עמום" },
  "brand-vivienne-tam": { label: "סגנון Vivienne Tam", description: "Vivienne Tam — אופנה אוריינטליסטית מקושטת" },
  "brand-jacquemus": { label: "סגנון Jacquemus", description: "Jacquemus — סוריאליסטי, שטוף שמש, שובב" },
  "brand-helmut-newton": { label: "סגנון Helmut Newton", description: "Helmut Newton — שחור-לבן בקונטרסט גבוה ופרובוקציה" },
  "brand-harpers-bazaar": { label: "סגנון Harper's Bazaar", description: "Harper's Bazaar — אופנה גבוהה מבריקה" },

  // Documentary
  "paparazzi": { label: "פפראצי", description: "צילום candid של צהובונים עם פלאש שרוף" },
  "street-photography": { label: "צילום רחוב", description: "פריים רחוב אורבני לא מבוים" },
  "candid-journalism": { label: "ז'ורנליזם candid", description: "רגע פוטו-ז'ורנליסטי לא מבוים" },
  "photojournalism": { label: "פוטו-ז'ורנליזם", description: "רפורטאז'ה אדיטוריאלית ברמת חדשות" },
  "documentary": { label: "דוקומנטרי", description: "פורטרט דוקומנטרי בפורמט ארוך" },
  "snapshot": { label: "סנאפשוט", description: "סנאפשוט חובבני קז'ואל" },

  // Studio / Formal
  "corporate-headshot": { label: "פורטרט עסקי", description: "פורטרט בסגנון LinkedIn" },
  "personal-branding": { label: "מיתוג אישי", description: "פורטרט מיתוג אישי מודרני" },
  "yearbook": { label: "ספר מחזור", description: "פורטרט לספר מחזור בית-ספרי" },
  "id-passport": { label: "תעודה / דרכון", description: "תמונת דרכון תקנית" },
  "mugshot": { label: "תמונת מעצר", description: "פורטרט בסגנון רישום משטרתי" },
  "wedding-portrait": { label: "פורטרט חתונה", description: "פורטרט רומנטי בסגנון כלה" },
  "family-portrait": { label: "פורטרט משפחתי", description: "צילום קבוצתי משפחתי מבוים" },
  "glamour-portrait": { label: "פורטרט זוהר", description: "פורטרט זוהר עם פוקוס רך" },
  "film-noir": { label: "Film Noir", description: "פורטרט noir עם צללים חדים" },

  // Selfie
  "mirror-selfie": { label: "סלפי במראה", description: "סלפי גוף מלא עם טלפון במראה" },
  "gym-mirror-selfie": { label: "סלפי במראה של חדר כושר", description: "סלפי במראה של חדר הלבשה בחדר כושר" },
  "front-cam-selfie": { label: "סלפי מצלמה קדמית", description: "סלפי מצלמה קדמית בטווח זרוע" },
  "bathroom-mirror-selfie": { label: "סלפי במראה של חדר אמבטיה", description: "סלפי במראה של חדר אמבטיה עם פלאש" },
  "bereal-dual": { label: "BeReal Dual", description: "פריים כפול קדמי+אחורי בו זמנית" },
  "flip-cam-selfie": { label: "סלפי Flip-Cam", description: "Flip cam מקרי באיכות נמוכה" },
  "group-selfie": { label: "סלפי קבוצתי", description: "סלפי טלפון של מספר סובייקטים" },
  "lofi-baddie-selfie": { label: "סלפי Lo-Fi של שנות ה-2010", description: "סלפי iPhone מוקדם באור נמוך" },

  // Print / Context
  "album-cover": { label: "עטיפת אלבום", description: "קומפוזיציה מרובעת של עטיפת אלבום" },
  "movie-poster": { label: "פוסטר סרט", description: "פוסטר קולנועי לבתי הקולנוע" },
  "advertising": { label: "פרסומת", description: "צילום מבריק של קמפיין פרסומי" },
  "food-photography": { label: "צילום אוכל", description: "צילום אוכל מלמעלה או בזווית 45 מעלות" },
  "real-estate": { label: "נדל\"ן", description: "צילום פנים אדריכלי רחב" },
  "sports-action": { label: "אקשן ספורט", description: "רגע ספורט קפוא ב-telephoto" },
  "point-and-shoot": { label: "מצלמת כיס / חד-פעמית", description: "אסתטיקה של מצלמה חד-פעמית, פלאש קשה, קז'ואל" },
  "lifestyle-blog": { label: "בלוג לייפסטייל", description: "תחושת בלוג בית / קפה באור טבעי רך" },
  "product-shot": { label: "צילום מוצר", description: "מוצר איקומרס נקי ומבודד על רקע נייטרלי" },
}

export default map
