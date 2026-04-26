import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // -------------------- Editorial / Fashion --------------------
  "fashion-editorial": { label: "Модная редакция", description: "Высокая мода, журнальный разворот" },
  "vogue-editorial": { label: "Редакция Vogue", description: "Обложка в стиле Vogue" },
  "magazine-cover": { label: "Обложка журнала", description: "Тесно скомпонованная обложка" },
  "lookbook": { label: "Лукбук", description: "Чистый снимок наряда для лукбука" },
  "ecommerce-flatlay": { label: "Плоская выкладка для e-commerce", description: "Плоская выкладка продукта сверху" },
  "beauty-editorial": { label: "Бьюти-редакция", description: "Макро-крупный план для бьюти / ухода" },
  "campaign-advertising": { label: "Кампания / Реклама", description: "Отполированный имиджевый снимок бренда" },

  // -------------------- Brand / Editorial Reference (proper nouns kept English) --------------------
  "brand-vogue": { label: "Подпись Vogue", description: "Фирменный стиль редакции Vogue" },
  "brand-dior": { label: "Подпись Dior", description: "Редакция Dior — chiaroscuro и силуэт" },
  "brand-jil-sander": { label: "Минимализм Jil Sander", description: "Jil Sander — минималистичный архитектурный приглушённый" },
  "brand-vivienne-tam": { label: "Стиль Vivienne Tam", description: "Vivienne Tam — ориенталистская богатая мода" },
  "brand-jacquemus": { label: "Стиль Jacquemus", description: "Jacquemus — залитый солнцем сюрреалистичный игривый" },
  "brand-helmut-newton": { label: "Стиль Helmut Newton", description: "Helmut Newton — высококонтрастная Ч/Б провокация" },
  "brand-harpers-bazaar": { label: "Стиль Harper's Bazaar", description: "Harper's Bazaar — высокомодный глянцевый" },

  // -------------------- Documentary / Candid --------------------
  "paparazzi": { label: "Папарацци", description: "Таблоидная съёмка со вспышкой" },
  "street-photography": { label: "Стрит-фото", description: "Непостановочный городской уличный кадр" },
  "candid-journalism": { label: "Непостановочная журналистика", description: "Непостановочный фотожурналистский момент" },
  "photojournalism": { label: "Фотожурналистика", description: "Редакторский новостной репортаж" },
  "documentary": { label: "Документальный", description: "Длинноформатный документальный портрет" },
  "snapshot": { label: "Снимок", description: "Случайный любительский снимок" },

  // -------------------- Studio / Formal --------------------
  "corporate-headshot": { label: "Корпоративный портрет", description: "Портрет в стиле LinkedIn" },
  "personal-branding": { label: "Личный брендинг", description: "Современный портрет для личного бренда" },
  "yearbook": { label: "Альбом выпускника", description: "Школьный портрет для альбома" },
  "id-passport": { label: "ID / Паспорт", description: "Регламентное паспортное фото" },
  "mugshot": { label: "Полицейское фото", description: "Портрет в стиле полицейской фиксации" },
  "wedding-portrait": { label: "Свадебный портрет", description: "Романтичный свадебный портрет" },
  "family-portrait": { label: "Семейный портрет", description: "Постановочный групповой семейный снимок" },
  "glamour-portrait": { label: "Гламурный портрет", description: "Гламурный портрет с мягким фокусом" },
  "film-noir": { label: "Фильм-нуар", description: "Портрет в стиле нуар с жёсткими тенями" },

  // -------------------- Selfie sub-types --------------------
  "mirror-selfie": { label: "Селфи в зеркале", description: "Селфи с телефоном в зеркале в полный рост" },
  "gym-mirror-selfie": { label: "Селфи в зеркале спортзала", description: "Селфи в зеркале раздевалки спортзала" },
  "front-cam-selfie": { label: "Селфи фронтальной камерой", description: "Селфи на вытянутой руке фронтальной камерой" },
  "bathroom-mirror-selfie": { label: "Селфи в зеркале ванной", description: "Селфи в зеркале ванной со вспышкой" },
  "bereal-dual": { label: "BeReal двойное", description: "Одновременный двойной кадр перед+за" },
  "flip-cam-selfie": { label: "Селфи флип-камерой", description: "Случайное селфи флип-камерой низкого качества" },
  "group-selfie": { label: "Групповое селфи", description: "Селфи на телефон с несколькими людьми" },
  "lofi-baddie-selfie": { label: "Лоу-фай селфи 2010-х", description: "Селфи на ранний iPhone в плохом освещении" },

  // -------------------- Print / Context --------------------
  "album-cover": { label: "Обложка альбома", description: "Квадратная композиция обложки альбома" },
  "movie-poster": { label: "Постер фильма", description: "Кинематографический постер фильма" },
  "advertising": { label: "Реклама", description: "Глянцевая рекламная фотография кампании" },
  "food-photography": { label: "Фотография еды", description: "Снимок еды сверху или под 45 градусов" },
  "real-estate": { label: "Недвижимость", description: "Широкоугольный архитектурный интерьер" },
  "sports-action": { label: "Спортивная съёмка", description: "Замёрзший спортивный момент в телеобъектив" },
}

export default map
