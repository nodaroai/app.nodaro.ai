import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Editorial / Fashion
  "tim-walker": { description: "אופנת אגדה ציורית" },
  "paolo-roversi": { description: "זוהר Polaroid רך ואתרי" },
  "marta-bevacqua": { description: "פורטרטיקה ציורית חולמנית" },
  "patrick-demarchelier": { description: "פורטרט אופנה קלאסי מעודן" },
  "nick-knight": { description: "אופנה אוונגרדית מבריקה" },
  "mario-testino": { description: "אופנה זוהרת ושטופת שמש" },
  "steven-meisel": { description: "אדיטוריאל מלוטש מאמצע המאה" },
  "helmut-newton": { description: "פרובוקציה שחור-לבן נועזת" },
  "mario-sorrenti": { description: "אופנה אינטימית עם גרגירים" },
  "annie-leibovitz": { description: "פורטרט סלבריטאי קולנועי" },
  "felicia-simion": { description: "אמנות פסטורלית סוריאליסטית" },
  "oleg-oprisco": { description: "סטוריטלינג קולנועי עם גרגירי פילם" },
  "bella-kotak": { description: "פורטרטיקה פנטזיה-פולקלורית קסומה" },
  "yigal-ozeri": { description: "פורטרט מצויר היפר-ריאלי" },
  "jimmy-marble": { description: "אדיטוריאל בצבעי פסטל בהירים" },
  "rinko-kawauchi": { description: "צילום יומיומי שקט מלא אור" },
  "ellen-von-unwerth": { description: "אנרגיית pin-up רטרו שובבה" },

  // Documentary / Street
  "henri-cartier-bresson": { description: "צילום רחוב של הרגע המכריע" },
  "vivian-maier": { description: "רחוב אמריקני מאמצע המאה" },
  "saul-leiter": { description: "צבע ציורי של רחוב דרך זכוכית" },
  "daido-moriyama": { description: "רחוב טוקיו עם גרגירים בקונטרסט גבוה" },
  "robert-capa": { description: "פוטו-ז'ורנליזם קרבי עז" },
  "sebastiao-salgado": { description: "דוקומנטרי חברתי מונוכרומטי אפי" },
  "diane-arbus": { description: "פורטרט נוקב ומתעמת" },

  // Cinematographers
  "roger-deakins": { description: "נטורליזם קולנועי ציורי" },
  "emmanuel-lubezki": { description: "צילום קולנועי מרחף באור טבעי" },
  "greig-fraser": { description: "צילום ז'אנר קולנועי עשיר ומוחשי" },
  "christopher-doyle": { description: "אווירת ניאון רוויה בצילום יד" },

  // Concept
  "greg-rutkowski": { description: "אמנות קונספט פנטזיה ציורית אפית" },
  "magali-villeneuve": { description: "אמנות דמות פנטזיה הרואית" },
  "charlie-bowater": { description: "פורטרטיקה דיגיטלית אטמוספרית" },
  "sam-spratt": { description: "פורטרט אלגורי היפר-ריאלי" },
  "ruan-jia": { description: "פורטרט פנטזיה ציורי שופע" },
  "ilya-kuvshinov": { description: "פורטרט מסוגנן בהשפעת אנימה" },
  "wlop": { description: "פנטזיה ציורית אתרית" },
  "artgerm": { description: "Pinup מלוטש בהשפעת קומיקס" },

  // Illustrators
  "makoto-shinkai": { description: "שמיים ואור אנימה קולנועיים" },
  "studio-ghibli": { description: "חמימות Ghibli מצוירת ביד" },
  "alphonse-mucha": { description: "פאנל דקורטיבי art-nouveau" },
  "carne-griffiths": { description: "פורטרטיקה בוטנית עם דיו מתפשטת" },
  "conrad-roset": { description: "איור דמות בצבעי מים עדין" },
  "akihito-yoshida": { description: "מונוכרום שקט של דיו וגרגירים" },
  "karol-bak": { description: "מוזה מצוירת סימבוליסטית" },
  "ismail-inceoglu": { description: "נוף ציורי מיתי" },
  "stefan-gesell": { description: "פורטרטיקה סוריאליסטית כהה" },
  "andrew-atroshenko": { description: "ציור דמות אימפרסיוניסטי רומנטי" },
  "peter-gric": { description: "נוף סוריאליסטי אדריכלי" },
  "ingrid-baars": { description: "קולאז' אמנות-אופנה פיסולי" },
  "guido-van-helten": { description: "פורטרטיקה מונומנטלית של ציורי קיר" },
  "mapplethorpe": { description: "עירומים ופרחים פורמליסטיים באולפן בשחור-לבן" },
  "sherman": { description: "פורטרט עצמי קונספטואלי, מחקרי דמות" },
  "crewdson": { description: "פרברים קולנועיים, אווירת אימה" },
  "lachapelle": { description: "סלבריטאי סוריאליסטי / קמפ רווי צבע" },
  "klein": { description: "זוהר קשוח ואגרסיביות מבוקרת" },
  "lindbergh": { description: "אופנה מינימליסטית בשחור-לבן באור טבעי" },
  "tillmans": { description: "אינטימיות קווירית candid ופלאש קז'ואל" },
  "teller": { description: "סנאפשוט אנטי-זוהר בפלאש ישיר" },
  "penn": { description: "פורטרט אולפן מאופק מאמצע המאה" },
  "mcginley": { description: "נעורים נטורליסטיים + עירום בנוף, candid עם flare של שמש" },
  "mitchell": { description: "פורטרטיקה שחורה עכשווית, אור טבעי רך, אופנה פוגשת דוקומנטרי" },
  "collins": { description: "אופנה חולמנית רוויית ורוד במבט נשי, 35mm מעורפל" },
  "weston": { description: "טבע דומם מודרניסטי בשחור-לבן, עירומים פיסוליים, פורמליזם חד" },
  "beaton": { description: "פורטרטיקה מתקופת הוליווד הקלאסית, ביום תיאטרלי, רקעים מפוארים" },
}

export default map
