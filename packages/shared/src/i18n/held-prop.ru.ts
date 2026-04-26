import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // -------------------- Devices / Phones --------------------
  "smartphone": { label: "Смартфон", description: "Современный телефон в руке" },
  "smartphone-raised": { label: "Поднятый телефон", description: "Телефон поднят в момент съёмки" },
  "polaroid-camera": { label: "Камера Polaroid", description: "Винтажная камера моментальной съёмки" },
  "vintage-camera": { label: "Винтажная камера", description: "Старая плёночная камера с ремнём" },
  "dslr-camera": { label: "Зеркальная камера", description: "Современная зеркальная / беззеркальная камера" },
  "video-camera": { label: "Видеокамера", description: "Наплечная видеокамера" },
  "microphone": { label: "Микрофон", description: "Ручной вокальный микрофон" },
  "megaphone": { label: "Мегафон", description: "Рупор / мегафон" },
  "smartwatch": { label: "Умные часы", description: "Поднятая рука с умными часами" },

  // -------------------- Drinks --------------------
  "coffee-cup": { label: "Кофейная чашка", description: "Керамическая кофейная чашка" },
  "takeaway-coffee": { label: "Кофе на вынос", description: "Бумажный стаканчик кофе на вынос" },
  "wine-glass": { label: "Бокал для вина", description: "Бокал красного вина на ножке" },
  "champagne-flute": { label: "Бокал для шампанского", description: "Высокий бокал для шампанского" },
  "martini-glass": { label: "Бокал для мартини", description: "Классический бокал для мартини" },
  "cocktail-glass": { label: "Бокал для коктейля", description: "Низкий бокал с коктейлем" },
  "beer-bottle": { label: "Бутылка пива", description: "Коричневая бутылка пива" },
  "water-bottle": { label: "Бутылка воды", description: "Многоразовая бутылка для воды" },

  // -------------------- Smoking --------------------
  "cigarette": { label: "Сигарета", description: "Зажжённая сигарета между пальцами" },
  "cigar": { label: "Сигара", description: "Толстая зажжённая сигара" },
  "vape-pen": { label: "Вейп-ручка", description: "Тонкая вейп-ручка" },
  "joint": { label: "Косяк", description: "Самокрутка" },

  // -------------------- Reading / Writing --------------------
  "book": { label: "Книга", description: "Открытая книга в твёрдом переплёте" },
  "magazine": { label: "Журнал", description: "Глянцевый сложенный журнал" },
  "newspaper": { label: "Газета", description: "Сложенная широкоформатная газета" },
  "notebook": { label: "Блокнот", description: "Открытый блокнот в линейку" },
  "pen": { label: "Ручка", description: "Ручка, готовая к письму" },
  "marker": { label: "Маркер", description: "Толстый маркер на середине штриха" },
  "paintbrush": { label: "Кисть", description: "Кисть, набранная краской" },
  "chalk": { label: "Мел", description: "Белый кусочек мела" },

  // -------------------- Bags / Accessories --------------------
  "handbag": { label: "Сумочка", description: "Дизайнерская сумочка" },
  "tote-bag": { label: "Сумка-тоут", description: "Мягкая холщовая сумка-тоут" },
  "briefcase": { label: "Портфель", description: "Жёсткий портфель" },
  "umbrella": { label: "Зонт", description: "Открытый чёрный зонт" },
  "fan-folding": { label: "Складной веер", description: "Открытый расписанный вручную веер" },

  // -------------------- Floral / Nature --------------------
  "bouquet": { label: "Букет", description: "Смешанный букет цветов" },
  "single-rose": { label: "Одна роза", description: "Одна длинностебельная роза" },
  "sunflower": { label: "Подсолнух", description: "Один высокий подсолнух" },
  "leaf": { label: "Лист", description: "Один большой лист" },
  "fruit-apple": { label: "Яблоко", description: "Одно свежее яблоко" },

  // -------------------- Instruments / Performance --------------------
  "guitar": { label: "Гитара", description: "Гитара, перекинутая через тело" },
  "violin": { label: "Скрипка", description: "Скрипка под подбородком" },
  "saxophone": { label: "Саксофон", description: "Саксофон, поднесённый к губам" },
  "drumsticks": { label: "Барабанные палочки", description: "Пара скрещённых барабанных палочек" },
  "sheet-music": { label: "Нотные листы", description: "Сложенные нотные листы" },

  // -------------------- Companion --------------------
  "small-dog": { label: "Маленькая собака", description: "Маленькая собака на руках" },
  "cat": { label: "Кошка", description: "Кошка, перекинутая через руку" },
  "plush-toy": { label: "Плюшевая игрушка", description: "Мягкая обнятая плюшевая игрушка" },

  // -------------------- Occupational / Weapon --------------------
  "katana": { label: "Катана", description: "Японский меч с одним лезвием" },
  "pointer-stick": { label: "Указка", description: "Телескопическая указка" },
  "gavel": { label: "Судейский молоток", description: "Деревянный судейский молоток" },
  "wine-bottle": { label: "Бутылка вина", description: "Полная бутылка с фольгой на горлышке" },
  "parasol": { label: "Зонтик от солнца", description: "Декоративный зонтик, защищающий от солнца" },
  "locket": { label: "Медальон", description: "Открытый винтажный медальон-кулон в пальцах" },
  "lighter": { label: "Зажигалка", description: "Хромированная зажигалка с большим пальцем у пламени" },
  "lantern": { label: "Фонарь", description: "Винтажный ручной фонарь с тёплым янтарным свечением" },
  "flashlight": { label: "Фонарик", description: "Современный фонарик с лучом, исследование или мистика" },
  "compass": { label: "Компас", description: "Ручной морской компас, исследование" },
  "bow-and-arrow": { label: "Лук со стрелой", description: "Натянутый лук с наложенной стрелой" },
  "shield": { label: "Щит", description: "Ручной щит, средневековый или фэнтезийный" },
}

export default map
