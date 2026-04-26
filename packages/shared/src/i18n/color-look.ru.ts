import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Palette
  "warm": { label: "Тёплый", description: "Тёплые оранжево-красные тона" },
  "cool": { label: "Холодный", description: "Прохладные сине-бирюзовые тона" },
  "teal-orange": { label: "Бирюзовый и оранжевый", description: "Голливудская дополняющая цветокоррекция" },
  "split-toning": { label: "Сплит-тонирование", description: "Прохладные тени, тёплые света" },
  "selective-color": { label: "Избирательный цвет", description: "Ч/Б с одним акцентным цветом" },
  "faded-matte": { label: "Выцветший матовый", description: "Поднятые чёрные, молочные приглушённые тона" },
  "log-flat": { label: "Лог / Плоский", description: "Нейтральный пред-грейдинг S-Log/V-Log" },
  "desaturated": { label: "Десатурация", description: "Низкая насыщенность, приглушённый" },
  "monochrome-bw": { label: "Монохром Ч/Б", description: "Чистый чёрно-белый" },
  "sepia": { label: "Сепия", description: "Винтажный коричневый тон" },
  "pastel": { label: "Пастель", description: "Мягкие низкоконтрастные пастельные тона" },
  "high-contrast": { label: "Высокий контраст", description: "Яркий контраст, глубокие чёрные" },
  "vibrant": { label: "Насыщенный", description: "Сильно насыщенные цвета" },

  // Film emulation — brand names kept English
  "kodak-portra": { description: "Мягкие тона кожи, тонкое зерно" },
  "kodak-ektar": { description: "Насыщенный, тонкое зерно" },
  "kodak-vision3": { description: "Кинематографическая киноплёнка" },
  "fuji-pro-400h": { description: "Пастельные зелёные и небо" },
  "cinestill-800t": { description: "Вольфрамовая плёнка с красной гало" },
  "bleach-bypass": { label: "Bleach Bypass", description: "Высокий контраст, десатурированный" },
  "technicolor": { label: "Technicolor 3-strip", description: "Яркий ретро-Technicolor" },
  "two-strip-technicolor": { label: "Two-Strip Technicolor", description: "Красно-синий Technicolor 1920-30-х" },
  "eastman-color": { description: "Тёплая выцветшая плёнка 1950-60-х" },
  "hand-tinted": { label: "Раскрашенный вручную", description: "Ч/Б с вручную нанесённым цветом" },
  "agfa-orwo": { description: "Прохладные восточноевропейские зелёные" },
  "day-for-night": { label: "День под ночь", description: "Дневная съёмка с ночной цветокоррекцией" },
  "cross-processed": { label: "Cross-Processed", description: "Цветовые сдвиги от xpro" },

  // Social-preset
  "instagram-warm": { label: "Тёплый Instagram", description: "Тёплый фильтр в стиле Valencia" },
  "tiktok-saturated": { label: "Насыщенный TikTok", description: "Яркая контрастная социальная палитра" },
  "youtube-vlog-flat": { label: "YouTube Vlog Flat", description: "Чистая плоская цветокоррекция влога" },
  "iphone-hdr": { description: "Вычислительный HDR-вид" },
  "y2k-saturated": { label: "Y2K насыщенный", description: "Цифровая поп-эстетика начала 2000-х" },
  "mtv-90s-vhs": { label: "MTV 90s VHS", description: "Перенасыщенная хрома VHS 90-х" },
  "polaroid-faded": { label: "Polaroid выцветший", description: "Выцветший Polaroid с пурпурным оттенком" },
  "lifestyle-warm-magazine": { label: "Тёплый лайфстайл-журнал", description: "Современная тёплая редакторская цветокоррекция" },
  "kodachrome-64": { description: "Насыщенные красные и янтарные света, винтажная теплота NatGeo" },
  "ektachrome-100": { description: "Прохладные чистые синие, чёткость слайд-плёнки" },
  "kodak-tri-x-400": { description: "Ч/Б уличная съёмка с пуш-зерном, грубый 35 мм" },
  "aerochrome": { label: "Aerochrome / Color IR", description: "Сюрреалистичная розово-пурпурная листва, ложноцветный пейзаж" },
  "fuji-instax": { description: "Мягкие пастельные средние тона, квадратная мгновенная плёнка" },
  "cinestill-50d": { description: "Дневная кинематографическая плёнка, контролируемые синие, ощущение Вонг Кар-Вая" },
  "expired-film": { label: "Просроченная плёнка", description: "Цветовые сдвиги, переэкспонированные пурпурные, световые засветки" },
}

export default map
