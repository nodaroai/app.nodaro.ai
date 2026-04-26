import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Time of day
  "sunrise": { label: "Восход", description: "Тёплое низкое солнце, длинные тени" },
  "golden-hour": { label: "Золотой час", description: "Тёплое сияние заката" },
  "noon": { label: "Полдень", description: "Жёсткое верхнее полуденное солнце" },
  "harsh-midday": { label: "Жёсткий полдень", description: "Выжженное белое полуденное солнце в зените" },
  "overcast": { label: "Пасмурно", description: "Мягкий рассеянный дневной свет" },
  "blue-hour": { label: "Синий час", description: "Прохладные сумерки" },
  "twilight": { label: "Сумерки", description: "Между синим часом и ночью" },
  "night": { label: "Ночь", description: "Глубокая ночь, низкая освещённость" },
  "moonlight": { label: "Лунный свет", description: "Прохладная сине-лунная сцена" },
  "neon-night": { label: "Неоновая ночь", description: "Насыщенная неоновая городская ночь" },

  // Style
  "three-point": { label: "Трёхточечная", description: "Классика: ключевой + заполняющий + задний" },
  "rembrandt": { label: "Рембрандт", description: "Треугольник света на щеке" },
  "chiaroscuro": { description: "Сильный контраст света и тени" },
  "silhouette": { label: "Силуэт", description: "Объект как чистая форма" },
  "high-key": { description: "Яркий, низкий контраст" },
  "low-key": { description: "Тёмный, высокий контраст" },
  "split": { label: "Расщеплённый", description: "Лицо наполовину освещено, наполовину в тени" },
  "hard": { label: "Жёсткий", description: "Резкие тени с чёткими краями" },
  "soft": { label: "Мягкий", description: "Рассеянный нежный свет" },
  "practical": { label: "Практический", description: "Видимые в кадре источники света" },
  "ring-light": { label: "Кольцевая лампа", description: "Бьюти-блик в глазах для влогов" },
  "phone-screen-glow": { label: "Свечение экрана телефона", description: "Прохладный подсвет от экрана" },
  "selfie-natural": { label: "Естественное селфи", description: "Селфи при оконном свете" },
  "natural": { label: "Естественный", description: "Доступный окружающий свет" },
  "volumetric": { label: "Объёмный", description: "Видимые лучи света в дымке" },
  "noir": { label: "Нуар", description: "Высококонтрастный Ч/Б нуар" },
  "on-camera-flash": { label: "Камерная вспышка", description: "Прямая папарацци / iPhone-вспышка" },
  "mirror-bounce-flash": { label: "Вспышка в зеркале", description: "Отражение вспышки в зеркале для селфи" },
  "bounced-flash": { label: "Отражённая вспышка", description: "Мягкая заполняющая от потолка" },
  "softbox-key": { label: "Софтбокс как ключевой", description: "Большой рассеянный модный ключевой" },
  "beauty-dish": { label: "Бьюти-диш", description: "Героический свет, чёткий спад" },
  "gridded-snoot": { label: "Тубус с сотами", description: "Узкий сфокусированный пучок света" },
  "silk-diffusion": { label: "Шёлковый рассеиватель", description: "Шёлково смягчённый нежный ключевой" },
  "kicker-rim": { label: "Контровой акцент", description: "Низкий боковой акцент-разделитель" },
  "candlelight": { label: "Свет свечи", description: "Тёплый мерцающий огневой свет" },
  "edison-tungsten": { label: "Лампа Эдисона", description: "Уютное тёплое свечение шарообразной лампы" },
  "dappled-light": { label: "Пятнистый / Через листву", description: "Пятнистый свет через листву" },
  "raking-sidelight": { label: "Скользящий боковой свет", description: "Экстремально низкий боковой, текстура" },
  "stage-spotlight": { label: "Сценический прожектор", description: "Один жёсткий верхний прожектор" },
  "underwater-caustics": { label: "Подводные каустики", description: "Рябящие узоры преломления" },
  "bioluminescence": { label: "Биолюминесценция", description: "Прохладное жуткое биологическое свечение" },

  // Direction
  "front": { label: "Спереди", description: "Свет со стороны камеры" },
  "three-quarter": { label: "Три четверти", description: "Классический портретный угол ключевого света" },
  "side": { label: "Сбоку", description: "Свет с одной стороны" },
  "back-rim": { label: "Сзади / Контровой", description: "Контровой свет, ободок вокруг объекта" },
  "silhouette-backlight": { label: "Силуэт со встречным светом", description: "Яркий ореол, тёмный объект" },
  "top-overhead": { label: "Сверху / Над головой", description: "Свет прямо сверху" },
  "under-uplight": { label: "Снизу / Снизу вверх", description: "Свет снизу" },
  "window": { label: "Оконный", description: "Мягкий боковой свет от окна" },

  // Lighting ratio (technical units, keep label)
  "ratio-1-1": { description: "Плоский, без контраста теней" },
  "ratio-1-2": { description: "Мягкий спад в одну ступень" },
  "ratio-1-3": { description: "Умеренный двухступенчатый контраст" },
  "ratio-1-4": { description: "Сильный редакторский контраст" },
  "ratio-1-8": { description: "Экстремальный низкий ключ chiaroscuro" },
  "ratio-1-16": { description: "Спад с одного источника в стиле film noir" },

  // Color temperature (Kelvin technical units, keep label)
  "temp-2700k": { description: "Глубокий янтарь свечи/вольфрама" },
  "temp-3200k": { description: "Тёплый жёлтый интерьер" },
  "temp-4000k": { description: "Нейтральный белый" },
  "temp-5600k": { description: "Сбалансированное полуденное солнце" },
  "temp-6500k": { description: "Слегка прохладный синий оттенок" },
  "temp-9000k": { description: "Заметно прохладный синий тон в тени" },
}

export default map
