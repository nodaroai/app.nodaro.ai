import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // -------------------- Indoor --------------------
  "coffee-shop": { label: "Кофейня", description: "Уютный интерьер кафе" },
  "library": { label: "Библиотека", description: "Грандиозная библиотека с высокими полками" },
  "office": { label: "Современный офис", description: "Светлый стеклянный современный офис" },
  "home-office": { label: "Домашний кабинет", description: "Уютное домашнее рабочее место" },
  "bedroom": { label: "Спальня", description: "Интимная спальня" },
  "living-room": { label: "Гостиная", description: "Уютная жилая гостиная" },
  "kitchen": { label: "Кухня", description: "Тёплая домашняя кухня с утренним светом" },
  "hotel-room": { label: "Гостиничный номер", description: "Элегантный гостиничный номер с видом на город" },
  "restaurant": { label: "Ресторан", description: "Интимный ресторан при свечах" },
  "nightclub": { label: "Ночной клуб", description: "Тёмный клуб с лазерами и дымом" },
  "gym": { label: "Спортзал", description: "Современный фитнес-зал" },
  "classroom": { label: "Класс", description: "Светлый школьный класс" },
  "hospital": { label: "Больница", description: "Стерильный больничный коридор" },
  "laboratory": { label: "Лаборатория", description: "Исследовательская лаборатория со светящимся оборудованием" },
  "courtroom": { label: "Зал суда", description: "Зал суда с деревянными панелями" },
  "warehouse": { label: "Промышленный склад", description: "Огромный склад с потолочными окнами" },
  "subway-car": { label: "Вагон метро", description: "Движущийся интерьер метро" },
  "taxi": { label: "Салон такси", description: "Заднее сиденье городского такси ночью" },
  "cathedral": { label: "Собор", description: "Интерьер готического собора" },
  "art-gallery": { label: "Художественная галерея", description: "Минималистичная галерея в стиле white-cube" },

  // -------------------- Urban --------------------
  "city-street": { label: "Городская улица", description: "Оживлённая городская улица" },
  "rooftop": { label: "Крыша", description: "Терраса на крыше с видом на город" },
  "back-alley": { label: "Задний переулок", description: "Грубый узкий переулок" },
  "neon-alley": { label: "Неоновый переулок", description: "Залитый дождём неоновый переулок" },
  "park": { label: "Городской парк", description: "Зелёный городской парк с дорожками" },
  "backyard": { label: "Задний двор / Патио", description: "Деревянная палуба патио с гирляндами" },
  "highway": { label: "Открытое шоссе", description: "Размашистое шоссе до горизонта" },
  "bridge": { label: "Висячий мост", description: "Длинный висячий мост через воду" },
  "train-station": { label: "Железнодорожный вокзал", description: "Платформа с ожидающим поездом" },
  "airport": { label: "Терминал аэропорта", description: "Огромный терминал с изогнутым стеклом" },
  "parking-lot": { label: "Парковка", description: "Пригородная парковка в сумерках" },
  "penthouse": { label: "Пентхаус", description: "Роскошный пентхаус с видом на город" },
  "gas-station": { label: "Заправка", description: "Одинокая заправка на шоссе ночью" },

  // -------------------- Nature --------------------
  "forest": { label: "Лесная поляна", description: "Залитая солнцем мшистая поляна" },
  "beach": { label: "Пляж", description: "Широкий песчаный пляж с прибоем" },
  "mountain-peak": { label: "Горная вершина", description: "Скалистая альпийская вершина" },
  "desert": { label: "Пустынные дюны", description: "Колышимые ветром пустынные дюны" },
  "jungle": { label: "Джунгли", description: "Густые влажные джунгли" },
  "grassland": { label: "Луга", description: "Открытые продуваемые ветром луга" },
  "snowy-tundra": { label: "Снежная тундра", description: "Замёрзшая ветром изваянная тундра" },
  "lake-shore": { label: "Берег озера", description: "Тихий берег горного озера" },
  "riverbank": { label: "Берег реки", description: "Извилистая река с ивами" },
  "waterfall": { label: "Водопад", description: "Каскад через мшистые скалы" },
  "cave": { label: "Пещера", description: "Скалистая пещера с лучами дневного света" },
  "western-canyon": { label: "Каньон Запада", description: "Краснокаменное плато с извилистой рекой" },

  // -------------------- Fantastical --------------------
  "alien-planet": { label: "Инопланетная планета", description: "Потусторонний пейзаж с двумя лунами" },
  "spaceship-interior": { label: "Интерьер космического корабля", description: "Гладкий коридор звездолёта" },
  "underwater": { label: "Под водой", description: "Залитая солнцем глубоководная сцена" },
  "fantasy-castle": { label: "Сказочный замок", description: "Раскинувшийся внутренний двор замка" },
  "medieval-village": { label: "Средневековая деревня", description: "Мощёная брусчаткой деревенская площадь" },
  "ancient-ruins": { label: "Древние руины", description: "Заросшие лозой каменные руины" },
  "cyberpunk-city": { label: "Киберпанк-город", description: "Раскинувшийся неоновый мегаполис" },
  "haunted-mansion": { label: "Особняк с привидениями", description: "Разрушающийся готический особняк" },
  "dreamscape": { label: "Сновидческий пейзаж", description: "Сюрреалистичные парящие острова" },
  "wasteland": { label: "Постапокалиптическая пустошь", description: "Ржавая пасмурная пустошь" },
}

export default map
