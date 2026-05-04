import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // ── Disaster ──
  "earthquake-tremor": { label: "רעש אדמה קל", description: "רעידת קרקע קלה, חפצים תלויים מתנדנדים" },
  "earthquake-major": { label: "רעידת אדמה חזקה", description: "קרקע נסדקת, פסולת נופלת" },
  "building-collapse": { label: "התמוטטות בניין", description: "מבנה מתפורר תוך כדי נפילה" },
  "tsunami-wave": { label: "גל צונאמי", description: "קיר עצום של מים שניתך" },
  "tornado": { label: "טורנדו", description: "ענן משפך נוגע בקרקע" },
  "hurricane": { label: "הוריקן", description: "רוחות מייללות מכופפות עצים, יריעות גשם" },
  "blizzard-whiteout": { label: "סופת שלג מסנוורת", description: "שלג כבד מבטל את הראות" },
  "sandstorm": { label: "סופת חול", description: "קיר של אבק כתום בולע את הסצנה" },
  "dust-storm-haboob": { label: "סופת אבק (Haboob)", description: "חזית אבק מדברית מתנשאת" },
  "wildfire-distant": { label: "שריפת יער מרוחקת", description: "זוהר כתום + עשן באופק" },
  "wildfire-engulfing": { label: "שריפה בולעת", description: "להבות מתקרבות, ריצוד חום עז" },
  "volcanic-eruption": { label: "התפרצות וולקנית", description: "לבה פורצת, ענן אפר" },
  "lava-flow": { label: "זרימת לבה", description: "נהר מותך זוהר זוחל על הקרקע" },
  "ash-rain": { label: "גשם אפר", description: "אפר אפור אפוקליפטי נופל כשלג" },
  "avalanche": { label: "מפולת שלגים", description: "קיר של שלג גולש במורד ההר" },
  "hailstorm": { label: "סופת ברד", description: "אבני ברד גדולות מקפצות ממשטחים" },

  // ── Fire & Blasts ──
  "explosion-small": { label: "פיצוץ קטן", description: "פיצוץ קומפקטי עם הבזק מוקדי" },
  "explosion-large": { label: "פיצוץ גדול", description: "כדור אש בגודל רכב עם פסולת" },
  "explosion-massive": { label: "פיצוץ אדיר", description: "כדור אש מפלס בניינים עם גל הדף" },
  "nuclear-detonation": { label: "התפוצצות גרעינית", description: "ענן פטרייה + הבזק מסנוור באופק" },
  "fireball-airborne": { label: "כדור אש באוויר", description: "כדור להבה מתגלגל באוויר" },
  "gas-explosion": { label: "פיצוץ גז", description: "פיצוץ בהיר בסגנון פרופאן" },
  "oil-fire": { label: "שריפת נפט", description: "להבות גבוהות שמנוניות + עשן שחור סמיך" },
  "blazing-inferno": { label: "תופת בוערת", description: "קיר של אש בולע הכל" },
  "flame-burst": { label: "פרץ להבה", description: "סילון אש מהיר וממוקד" },
  "ember-shower": { label: "מקלחת גחלים", description: "מפל של גחלים כתומות זוהרות" },
  "smoke-pillar": { label: "עמוד עשן", description: "עמוד אנכי גבוה של עשן שחור" },
  "mushroom-cloud": { label: "ענן פטרייה", description: "ענן פיצוץ קלאסי עם כיפה וגזע" },

  // ── Electric ──
  "lightning-bolt": { label: "ברק", description: "פריקה מסתעפת על פני שמיים סוערים" },
  "lightning-strike-impact": { label: "פגיעת ברק", description: "ברק פוגע בקרקע עם פיצוץ של אור" },
  "lightning-storm": { label: "סופת ברקים", description: "מספר פגיעות בו-זמנית" },
  "ball-lightning": { label: "ברק כדורי", description: "כדור פלזמה זוהר חשמלי מרחף באוויר" },
  "plasma-arc": { label: "קשת פלזמה", description: "קשת מתח גבוה רציפה בין שתי נקודות" },
  "taser-sparks": { label: "ניצוצות טייזר", description: "פריקה חשמלית קומפקטית מפצפצת במגע" },
  "electric-discharge": { label: "פריקה חשמלית", description: "פרץ של אנרגיה מקושתת ממכשיר תקול" },
  "transformer-blowout": { label: "פיצוץ שנאי", description: "פיצוץ כחול-לבן בראש עמוד חשמל" },
  "st-elmos-fire": { label: "אש סנט אלמו", description: "זוהר פלזמה כחול מצמרר על קצוות מתכת" },
  "static-shock-burst": { label: "התפרצות שוק סטטי", description: "ניצוץ קטן ונראה של חשמל סטטי" },

  // ── Combat ──
  "muzzle-flash": { label: "הבזק לוע", description: "הבזק כתום עז מקנה כלי הנשק" },
  "gunshot-impact": { label: "פגיעת ירייה", description: "כדור פוגע במשטח עם תרסיס פסולת" },
  "bullet-trail": { label: "שובל כדור", description: "פס נראה של כדור באוויר" },
  "sword-spark": { label: "ניצוצות חרב", description: "מקלחת מאקרו של ניצוצות חיכוך מתכת על מתכת" },
  "blade-clash": { label: "התנגשות להבים", description: "שני להבים נפגשים עם גל הדף" },
  "ricochet-spark": { label: "ניצוץ ריקושט", description: "כדור מקפץ ממתכת עם ניצוצות" },
  "debris-field": { label: "שדה פסולת", description: "רסיסים קפואים באוויר מתפזרים" },
  "glass-shatter-airborne": { label: "התנפצות זכוכית באוויר", description: "זכוכית מתפוצצת לרסיסים מרחפים" },
  "shockwave-ground": { label: "גל הדף קרקעי", description: "טבעת מתרחבת נראית בגובה הקרקע" },
  "sonic-boom": { label: "בום קולי", description: "חרוט של אוויר דחוס במהירות על-קולית" },
  "smoke-grenade": { label: "רימון עשן", description: "עשן צבעוני סמיך מתפרץ החוצה" },
  "flashbang": { label: "רימון הלם", description: "פרץ אור לבן מסנוור" },
  "blood-spray": { label: "תרסיס דם", description: "קשת קולנועית של טיפות דם" },
  "arrow-hit-spark": { label: "ניצוץ פגיעת חץ", description: "חץ נתקע עם ניצוצות קטנים בנקודת הפגיעה" },

  // ── Sci-Fi ──
  "laser-blast": { label: "ירי לייזר", description: "אלומה קוהרנטית בהירה של אנרגיה" },
  "energy-beam": { label: "קרן אנרגיה", description: "קרן רחבה ופועמת של אנרגיית פלזמה" },
  "plasma-bolt": { label: "פגז פלזמה", description: "פגז זוהר משאיר שובל של אדים" },
  "force-field-shimmer": { label: "ריצוד שדה כוח", description: "מחסום אנרגיה שקוף בדגם משושים" },
  "force-field-impact": { label: "פגיעה בשדה כוח", description: "אדווה נראית במקום פגיעת הפגז במגן" },
  "portal-opening": { label: "פתיחת פורטל", description: "מערבולת אנרגיה קורעת את החלל" },
  "warp-distortion": { label: "עיוות וורפ", description: "מרחב-זמן מתעקם סביב עצם" },
  "hologram-flicker": { label: "ריצוד הולוגרמה", description: "הקרנה שקופה עם תקלות תמונה" },
  "ion-storm": { label: "סופת יונים", description: "שדה מפצפץ של חלקיקים טעונים על רקע קוסמי" },
  "antimatter-flash": { label: "הבזק אנטי-חומר", description: "פרץ של אנרגיה לבנה טהורה הקורע את המציאות" },

  // ── Magic ──
  "fireball-spell": { label: "כישוף כדור אש", description: "כדור אש מסתחרר המוטל ביד" },
  "magic-aura": { label: "הילה קסומה", description: "הילת אנרגיה זוהרת סביב דמות" },
  "summoning-glyph": { label: "סמל זימון", description: "מעגל קסם זוהר על הקרקע" },
  "lightning-magic": { label: "קסם ברקים", description: "כישוף חשמלי מתקשת מידי המכשף" },
  "ice-shard-burst": { label: "פרץ רסיסי קרח", description: "רסיסים גבישיים מתפזרים החוצה" },
  "energy-rune": { label: "רונה אנרגטית", description: "סמל ארקיני זוהר תלוי באוויר" },
  "portal-magic": { label: "פורטל קסם", description: "פתח מיסטי מסתחרר בחלל" },
  "healing-glow": { label: "זוהר ריפוי", description: "אור זהוב חמים נובע מהמכשף" },
  "dark-vortex": { label: "מערבולת אפלה", description: "תהום מסתחררת שחורה-סגולה מאיימת" },
  "light-explosion": { label: "התפוצצות אור", description: "פרץ של זוהר לבן-זהוב טהור" },
}

export default map
