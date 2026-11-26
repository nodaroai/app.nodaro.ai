import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // ── Disaster ──
  "earthquake-tremor": { label: "רעידת אדמה קלה", description: "רעידת קרקע קלה, חפצים תלויים מתנדנדים" },
  "earthquake-major": { label: "רעידת אדמה חזקה", description: "קרקע נסדקת, הריסות נופלות" },
  "building-collapse": { label: "התמוטטות בניין", description: "מבנה מתפורר תוך כדי נפילה" },
  "tsunami-wave": { label: "גל צונאמי", description: "קיר מים מתנשא שמסתער קדימה" },
  "tornado": { label: "טורנדו", description: "ענן משפך נוגע בקרקע" },
  "hurricane": { label: "הוריקן", description: "רוחות מייללות מכופפות עצים, גשם זלעפות" },
  "blizzard-whiteout": { label: "סופת שלג מסנוורת", description: "שלג כבד וראות אפסית" },
  "sandstorm": { label: "סופת חול", description: "קיר של אבק כתום בולע את הסצנה" },
  "dust-storm-haboob": { label: "סופת אבק (Haboob)", description: "חזית אבק מדברית מתנשאת" },
  "wildfire-distant": { label: "שריפת יער מרוחקת", description: "זוהר כתום + עשן באופק" },
  "wildfire-engulfing": { label: "שריפת יער משתוללת", description: "להבות מתקרבות, ריצוד חום עז" },
  "volcanic-eruption": { label: "התפרצות הר געש", description: "לבה פורצת, ענן אפר" },
  "lava-flow": { label: "זרימת לבה", description: "נהר לבה זוהר זוחל על פני הקרקע" },
  "ash-rain": { label: "גשם אפר", description: "אפר אפור אפוקליפטי נופל כשלג" },
  "avalanche": { label: "מפולת שלגים", description: "קיר של שלג גולש במורד ההר" },
  "hailstorm": { label: "סופת ברד", description: "אבני ברד גדולות מקפצות ממשטחים" },

  // ── Fire & Blasts ──
  "explosion-small": { label: "פיצוץ קטן", description: "פיצוץ מרוכז עם הבזק במוקדו" },
  "explosion-large": { label: "פיצוץ גדול", description: "כדור אש בגודל רכב עם שברים" },
  "explosion-massive": { label: "פיצוץ אדיר", description: "כדור אש שמחריב בניינים, וגל הדף" },
  "nuclear-detonation": { label: "התפוצצות גרעינית", description: "ענן פטרייה + הבזק מסנוור באופק" },
  "fireball-airborne": { label: "כדור אש באוויר", description: "כדור להבה מתגלגל באוויר" },
  "gas-explosion": { label: "פיצוץ גז", description: "פרץ אש בוהק של גז פרופאן" },
  "oil-fire": { label: "שריפת נפט", description: "להבות גבוהות שמנוניות + עשן שחור סמיך" },
  "blazing-inferno": { label: "תופת בוערת", description: "קיר של אש בולע הכול" },
  "flame-burst": { label: "פרץ להבה", description: "סילון אש מהיר וממוקד" },
  "ember-shower": { label: "מטר גחלים", description: "מפל של גחלים כתומות זוהרות" },
  "smoke-pillar": { label: "עמוד עשן", description: "עמוד אנכי גבוה של עשן שחור" },
  "mushroom-cloud": { label: "ענן פטרייה", description: "ענן פיצוץ קלאסי עם כיפה וגזע" },

  // ── Electric ──
  "lightning-bolt": { label: "ברק", description: "פריקה מסתעפת על פני שמיים סוערים" },
  "lightning-strike-impact": { label: "פגיעת ברק", description: "ברק פוגע בקרקע בפרץ אור" },
  "lightning-storm": { label: "סופת ברקים", description: "פגיעות ברק רבות בו־זמנית" },
  "ball-lightning": { label: "ברק כדורי", description: "כדור זוהר של פלזמה חשמלית שמרחף באוויר" },
  "plasma-arc": { label: "קשת פלזמה", description: "קשת מתח גבוה רציפה בין שתי נקודות" },
  "taser-sparks": { label: "ניצוצות טייזר", description: "פריקה חשמלית מרוכזת ומפצפצת במגע" },
  "electric-discharge": { label: "פריקה חשמלית", description: "פרץ של קשתות חשמל ממכשיר תקול" },
  "transformer-blowout": { label: "פיצוץ שנאי", description: "פיצוץ כחול־לבן בראש עמוד חשמל" },
  "st-elmos-fire": { label: "אש סנט אלמו", description: "זוהר פלזמה כחול מצמרר על קצוות מתכת" },
  "static-shock-burst": { label: "פרץ חשמל סטטי", description: "ניצוץ זעיר של חשמל סטטי, גלוי לעין" },

  // ── Combat ──
  "muzzle-flash": { label: "הבזק לוע", description: "הבזק כתום עז מקנה כלי הנשק" },
  "gunshot-impact": { label: "פגיעת ירייה", description: "כדור פוגע במשטח ומתיז שברים" },
  "bullet-trail": { label: "שובל כדור", description: "פס גלוי שכדור משאיר באוויר" },
  "sword-spark": { label: "ניצוצות חרב", description: "מטר ניצוצות חיכוך מתכת על מתכת בתקריב מאקרו" },
  "blade-clash": { label: "התנגשות להבים", description: "שני להבים מתנגשים ויוצרים גל הדף" },
  "ricochet-spark": { label: "ניצוץ ריקושט", description: "כדור ניתז ממתכת ומעיף ניצוצות" },
  "debris-field": { label: "שדה שברים", description: "רסיסים מתפזרים שקפאו באוויר" },
  "glass-shatter-airborne": { label: "התנפצות זכוכית באוויר", description: "זכוכית מתפוצצת לרסיסים מרחפים" },
  "shockwave-ground": { label: "גל הדף קרקעי", description: "טבעת גלויה שמתרחבת בגובה הקרקע" },
  "sonic-boom": { label: "בום על־קולי", description: "חרוט של אוויר דחוס במהירות על־קולית" },
  "smoke-grenade": { label: "רימון עשן", description: "עשן צבעוני סמיך מתפרץ החוצה" },
  "flashbang": { label: "רימון הלם", description: "פרץ אור לבן מסנוור" },
  "blood-spray": { label: "התזת דם", description: "קשת קולנועית של טיפות דם" },
  "arrow-hit-spark": { label: "ניצוץ פגיעת חץ", description: "חץ ננעץ וניצוצות קטנים ניתזים בנקודת הפגיעה" },

  // ── Sci-Fi ──
  "laser-blast": { label: "ירי לייזר", description: "אלומת אנרגיה בהירה וקוהרנטית" },
  "energy-beam": { label: "קרן אנרגיה", description: "קרן רחבה ופועמת של אנרגיית פלזמה" },
  "plasma-bolt": { label: "יריית פלזמה", description: "קליע זוהר שמשאיר שובל אדים" },
  "force-field-shimmer": { label: "ריצוד שדה כוח", description: "מחסום אנרגיה שקוף בדוגמת משושים" },
  "force-field-impact": { label: "פגיעה בשדה כוח", description: "אדווה גלויה בנקודה שבה הקליע פוגע במגן" },
  "portal-opening": { label: "פתיחת פורטל", description: "מערבולת אנרגיה קורעת את החלל" },
  "warp-distortion": { label: "עיוות וורפ", description: "מרחב־זמן מתעקם סביב עצם" },
  "hologram-flicker": { label: "ריצוד הולוגרמה", description: "הקרנה שקופה עם תקלות תמונה" },
  "ion-storm": { label: "סופת יונים", description: "שדה מפצפץ של חלקיקים טעונים על רקע קוסמי" },
  "antimatter-flash": { label: "הבזק אנטי־חומר", description: "פרץ של אנרגיה לבנה טהורה הקורע את המציאות" },

  // ── Magic ──
  "fireball-spell": { label: "כישוף כדור אש", description: "כדור אש מסתחרר שנזרק מהיד" },
  "magic-aura": { label: "הילה קסומה", description: "הילת אנרגיה זוהרת סביב דמות" },
  "summoning-glyph": { label: "סמל זימון", description: "מעגל קסם זוהר על הקרקע" },
  "lightning-magic": { label: "קסם ברקים", description: "ברקי כישוף מזנקים מידי המכשף" },
  "ice-shard-burst": { label: "פרץ רסיסי קרח", description: "רסיסים גבישיים מתפזרים החוצה" },
  "energy-rune": { label: "רונת אנרגיה", description: "סמל קסם זוהר תלוי באוויר" },
  "portal-magic": { label: "פורטל קסם", description: "פתח מיסטי מסתחרר בחלל" },
  "healing-glow": { label: "זוהר ריפוי", description: "אור זהוב חמים נובע מהמכשף" },
  "dark-vortex": { label: "מערבולת אפלה", description: "תהום מאיימת שמסתחררת בגווני שחור וסגול" },
  "light-explosion": { label: "התפוצצות אור", description: "פרץ של זוהר לבן־זהוב טהור" },
}

export default map
