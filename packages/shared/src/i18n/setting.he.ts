import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Indoor
  "coffee-shop": { label: "בית קפה", description: "פנים בית קפה נעים" },
  "library": { label: "ספרייה", description: "ספרייה מפוארת עם מדפים גבוהים" },
  "office": { label: "משרד מודרני", description: "משרד מודרני בהיר ומזוגג" },
  "home-office": { label: "משרד ביתי", description: "סביבת עבודה ביתית נעימה" },
  "bedroom": { label: "חדר שינה", description: "חדר שינה אינטימי" },
  "living-room": { label: "סלון", description: "סלון ביתי נעים" },
  "kitchen": { label: "מטבח", description: "מטבח ביתי חמים באור בוקר" },
  "hotel-room": { label: "חדר מלון", description: "חדר מלון אלגנטי עם נוף לעיר" },
  "restaurant": { label: "מסעדה", description: "מסעדה אינטימית לאור נרות" },
  "nightclub": { label: "מועדון לילה", description: "מועדון חשוך עם לייזרים ועשן" },
  "gym": { label: "חדר כושר", description: "חדר כושר מודרני" },
  "classroom": { label: "כיתה", description: "כיתת בית ספר בהירה" },
  "hospital": { label: "בית חולים", description: "מסדרון בית חולים סטרילי" },
  "laboratory": { label: "מעבדה", description: "מעבדת מחקר עם ציוד זוהר" },
  "courtroom": { label: "אולם בית משפט", description: "אולם בית משפט מצופה עץ" },
  "warehouse": { label: "מחסן תעשייתי", description: "מחסן ענק עם אשנבים" },
  "subway-car": { label: "קרון רכבת תחתית", description: "פנים רכבת תחתית בתנועה" },
  "taxi": { label: "פנים מונית", description: "מושב אחורי של מונית עירונית בלילה" },
  "cathedral": { label: "קתדרלה", description: "פנים קתדרלה גותית" },
  "art-gallery": { label: "גלריית אמנות", description: "גלריה מינימליסטית במראה white-cube" },

  // Urban
  "city-street": { label: "רחוב עירוני", description: "רחוב עירוני שוקק" },
  "rooftop": { label: "גג", description: "מרפסת גג מעל קו רקיע" },
  "back-alley": { label: "סמטה אחורית", description: "סמטה צרה ומלוכלכת" },
  "neon-alley": { label: "סמטת ניאון", description: "סמטה רטובה מגשם בניאון" },
  "park": { label: "פארק עירוני", description: "פארק עירוני ירוק עם שבילים" },
  "backyard": { label: "פטיו של חצר אחורית", description: "פטיו על דק עם אורות" },
  "highway": { label: "כביש מהיר פתוח", description: "כביש מהיר סוחף עד האופק" },
  "bridge": { label: "גשר תלוי", description: "גשר תלוי ארוך מעל מים" },
  "train-station": { label: "תחנת רכבת", description: "רציף עם רכבת ממתינה" },
  "airport": { label: "טרמינל שדה תעופה", description: "טרמינל ענק עם זכוכית מעוקלת" },
  "parking-lot": { label: "מגרש חניה", description: "מגרש חניה פרברי בשעת דמדומים" },
  "penthouse": { label: "פנטהאוז", description: "פנטהאוז יוקרתי עם נוף לקו רקיע" },
  "gas-station": { label: "תחנת דלק", description: "תחנת דלק בודדה על כביש מהיר בלילה" },

  // Nature
  "forest": { label: "קרחת יער", description: "קרחת יער מכוסה טחב באור שמש" },
  "beach": { label: "חוף ים", description: "חוף ים רחב עם גלים" },
  "mountain-peak": { label: "פסגת הר", description: "פסגה אלפינית סלעית" },
  "desert": { label: "דיונות מדבר", description: "דיונות מדבר מנושפות רוח" },
  "jungle": { label: "ג'ונגל", description: "פנים ג'ונגל לח וצפוף" },
  "grassland": { label: "ערבה", description: "ערבה פתוחה ומנושפת רוח" },
  "snowy-tundra": { label: "טונדרה מושלגת", description: "טונדרה קפואה מגולפת רוח" },
  "lake-shore": { label: "חוף אגם", description: "חוף אגם הררי שקט" },
  "riverbank": { label: "גדת נהר", description: "נהר מתפתל עם עצי ערבה" },
  "waterfall": { label: "מפל", description: "מפל זורם מעל צוקים מכוסי טחב" },
  "cave": { label: "מערה", description: "מערה סלעית עם פירי אור יום" },
  "western-canyon": { label: "קניון מערבי", description: "מסה אדומה עם נהר מתפתל" },

  // Fantastical
  "alien-planet": { label: "כוכב חייזרים", description: "נוף אחר-עולמי עם ירחים תאומים" },
  "spaceship-interior": { label: "פנים חללית", description: "מסדרון חללית חלק" },
  "underwater": { label: "מתחת למים", description: "סצנה מואר אוקיינוס עמוק" },
  "fantasy-castle": { label: "טירת פנטזיה", description: "חצר טירה משתרעת" },
  "medieval-village": { label: "כפר מימי הביניים", description: "כיכר כפר מרוצפת" },
  "ancient-ruins": { label: "חורבות עתיקות", description: "חורבות אבן חנוקות בגפנים" },
  "cyberpunk-city": { label: "עיר Cyberpunk", description: "קו רקיע של מגה-עיר ניאון משתרעת" },
  "haunted-mansion": { label: "אחוזה רדופה", description: "אחוזה גותית מתפוררת" },
  "dreamscape": { label: "נוף חלום", description: "איים מרחפים סוריאליסטיים" },
  "wasteland": { label: "אדמת בור פוסט-אפוקליפטית", description: "אדמת בור חלודה ומעוננת" },
}

export default map
