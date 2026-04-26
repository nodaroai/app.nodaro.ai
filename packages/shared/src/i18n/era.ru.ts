import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // -------------------- 20th-century decades --------------------
  "1920s-flapper": {
    label: "Эпоха флэпперов 1920-х",
    description: "Гламур джаз-эпохи и подпольных баров",
  },
  "1930s-art-deco": {
    label: "Ар-деко 1930-х",
    description: "Обтекаемый гламур деко",
  },
  "1940s-wartime": {
    label: "Военные 1940-е",
    description: "Военная утилитарность и причёски victory rolls",
  },
  "1950s-diner": {
    label: "1950-е, закусочные / пин-ап",
    description: "Хромированные закусочные и пышные причёски пин-апа",
  },
  "1960s-mod": {
    label: "Мод 1960-х",
    description: "Графический мод свингующего Лондона",
  },
  "1970s-disco": {
    label: "Диско 1970-х",
    description: "Блеск зеркальных шаров Studio 54",
  },
  "1980s-neon": {
    label: "Неон 1980-х",
    description: "Излишества MTV-неона и пиджаков с подплечниками",
  },
  "1990s-mall": {
    label: "Молл 1990-х",
    description: "Гранж и поп торговых центров 90-х",
  },
  "2000s-y2k": {
    label: "Таблоиды / Y2K 2000-х",
    description: "Папарацци-вспышка и низкая посадка",
  },

  // -------------------- Pre-modern --------------------
  "medieval": {
    label: "Средневековье",
    description: "Европейское средневековье каменных замков",
  },
  "renaissance": {
    label: "Возрождение",
    description: "Флорентийское великолепие бархата и фресок",
  },
  "victorian": {
    label: "Викторианская эпоха",
    description: "Газовый свет, корсеты и кружево XIX века",
  },
  "edwardian": {
    label: "Эдвардианская эпоха",
    description: "Утончённость чайного сада прекрасной эпохи",
  },
  "wild-west": {
    label: "Дикий Запад",
    description: "Выжженная солнцем фронтирная Америка ковбоев",
  },
  "ancient-rome": {
    label: "Древний Рим",
    description: "Мраморноколонный имперский Рим",
  },
  "ancient-egypt": {
    label: "Древний Египет",
    description: "Фараонское золото и лён Нила",
  },
  "feudal-japan": {
    label: "Феодальная Япония",
    description: "Самураи и гейши периода Эдо",
  },
  "roaring-prewar": {
    label: "Довоенная роскошь",
    description: "Грань ар-нуво конца 1910-х",
  },

  // -------------------- Speculative --------------------
  "near-future": {
    label: "Ближайшее будущее",
    description: "Правдоподобное будущее через 5-15 лет",
  },
  "far-future": {
    label: "Далёкое будущее",
    description: "Космическая эпоха через столетия",
  },
  "dieselpunk": {
    description: "Индустриальная альтистория 1930-40-х",
  },
  "atompunk": {
    description: "Космическая эпоха оптимизма 1950-х",
  },
  "cyberpunk-future": {
    label: "Киберпанк-будущее",
    description: "Хай-тек низкая жизнь неонового мегаполиса",
  },
  "post-apocalyptic": {
    label: "Постапокалипсис",
    description: "Выживание в пустоши собирателями",
  },
  "retrofuturism": {
    label: "Ретрофутуризм",
    description: "Ностальгия по вчерашнему завтра",
  },
}

export default map
