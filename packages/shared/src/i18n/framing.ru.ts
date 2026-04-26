import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Shot size
  "extreme-wide-shot": { label: "Сверхдальний план", description: "Объект крошечный в обширной среде" },
  "wide-shot": { label: "Дальний план", description: "Полный рост с окружением" },
  "medium-wide-shot": { label: "Средне-дальний", description: "Объект от колен и выше" },
  "medium-shot": { label: "Средний план", description: "Объект от пояса и выше" },
  "medium-close-up": { label: "Средне-крупный", description: "Объект от груди и выше" },
  "close-up": { label: "Крупный план", description: "Лицо объекта заполняет кадр" },
  "extreme-close-up": { label: "Сверхкрупный план", description: "Деталь черты лица" },
  "insert": { label: "Инсерт", description: "Деталь объекта" },
  "macro": { label: "Макро", description: "Сверхблизкая деталь маленького объекта" },
  "full-shot": { label: "Полный план", description: "Всё тело с головы до пят в кадре" },
  "cowboy-shot": { label: "Ковбойский план", description: "От середины бедра, классическое вестерн-кадрирование" },
  "head-to-knees": { label: "Голова до колен", description: "От головы до колен" },
  "head-to-hip": { label: "Голова до бёдер", description: "От головы до бёдер" },
  "half-body": { label: "Поясной портрет", description: "Чистый поясной портрет" },

  // Angle
  "eye-level": { label: "На уровне глаз", description: "Камера на высоте глаз объекта" },
  "high-angle": { label: "Верхний ракурс", description: "Камера над объектом, смотрит вниз" },
  "low-angle": { label: "Нижний ракурс", description: "Камера под объектом, смотрит вверх" },
  "overhead": { label: "Сверху", description: "Прямой вид сверху, глаз бога" },
  "worms-eye-angle": { label: "С земли", description: "Экстремальный нижний ракурс с земли" },
  "dutch-angle": { label: "Голландский угол", description: "Наклонённый горизонт" },
  "birds-eye": { label: "С высоты птичьего полёта", description: "Высокий воздушный вид сверху" },
  "slightly-downward": { label: "Слегка сверху", description: "Лёгкий наклон сверху, в стиле селфи" },

  // Coverage
  "single": { label: "Одиночный", description: "Чистый кадр одного объекта" },
  "two-shot": { label: "Двойной", description: "Оба объекта в кадре" },
  "three-shot": { label: "Тройной", description: "Три объекта в кадре" },
  "over-the-shoulder-framing": { label: "Через плечо", description: "Через плечо одного на другого" },
  "reverse-shot": { label: "Обратный кадр", description: "Противоположная точка съёмки" },
  "pov-framing": { label: "POV", description: "Глазами объекта" },
  "selfie-framing": { label: "Селфи", description: "Автопортрет на расстоянии вытянутой руки" },
  "mirror-selfie": { label: "Селфи в зеркале", description: "Телефон виден в отражении зеркала" },
  "gym-mirror-selfie": { label: "Селфи в зеркале спортзала", description: "Угол сзади-сбоку через зеркало в спортзале" },
  "through-glass": { label: "Через стекло", description: "Кадр через переднее стеклянное полотно" },
  "top-down-flat-lay": { label: "Плоская выкладка сверху", description: "Расположение предметов на поверхности сверху" },
  "establishing-shot": { label: "Установочный план", description: "Широкий план места действия, объект мал" },
  "dirty-single": { label: "Грязный одиночный", description: "Одиночный с другим персонажем у края" },

  // Composition
  "rule-of-thirds": { label: "Правило третей", description: "Объект на пересечении третей" },
  "centered": { label: "По центру", description: "Объект точно в центре, симметрично" },
  "headroom-tight": { label: "Минимум места над головой", description: "Голова объекта у верхнего края кадра" },
  "negative-space": { label: "Негативное пространство", description: "Объект смещён, пустое пространство" },
  "leading-lines": { label: "Направляющие линии", description: "Линии ведут взгляд к объекту" },
  "3x3-grid-collage": { label: "Коллаж 3×3", description: "Объект в сетке вариаций 3×3" },
  "diptych": { label: "Диптих", description: "Двухкадровая композиция бок о бок" },
  "triptych": { label: "Триптих", description: "Трёхкадровая композиция" },
  "multi-frame-mosaic": { label: "Мультикадровая мозаика", description: "Лицо, собранное из мозаики маленьких плиток" },
  "contact-sheet": { label: "Контактный лист", description: "Контактный лист с миниатюрами" },
  "magazine-spread": { label: "Журнальный разворот", description: "Двухстраничный журнальный макет с типографикой" },
  "cutaway-cross-section": { label: "Разрез / Поперечное сечение", description: "Архитектурный разрез со снятыми стенами" },

  // Vantage
  "front-on": { label: "Спереди", description: "Объект лицом к камере" },
  "three-quarter-front": { label: "Три четверти спереди", description: "Слегка не по оси спереди" },
  "profile-left": { label: "Профиль слева", description: "Вид сбоку, левая сторона объекта" },
  "profile-right": { label: "Профиль справа", description: "Вид сбоку, правая сторона объекта" },
  "three-quarter-back": { label: "Три четверти сзади", description: "Не по оси сзади" },
  "behind": { label: "Сзади", description: "Прямой вид сзади" },
  "side-back-angle": { label: "Угол сзади-сбоку", description: "Три четверти из-за одного плеча" },
  "golden-spiral": { label: "Золотая спираль", description: "Композиция по спирали Фибоначчи" },
  "frame-within-frame": { label: "Кадр в кадре", description: "Объект обрамлён внутренним архитектурным элементом" },
  "s-curve": { label: "S-образная кривая", description: "Извилистый диагональный поток, ведущий взгляд" },
  "diagonal-composition": { label: "Диагональная", description: "Сильная диагональ, рассекающая кадр" },
  "triangular-composition": { label: "Треугольная", description: "Трёхточечная треугольная компоновка" },
  "symmetrical-mirror": { label: "Симметрия / Зеркало", description: "Точная лево-правая симметрия" },
  "vignette-composition": { label: "Виньетка", description: "Сильное затемнение по краям, фокус в центре" },
}

export default map
