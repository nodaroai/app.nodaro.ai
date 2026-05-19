import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Basic
  "auto": { label: "Авто", description: "Дать модели выбрать подходящее движение камеры" },
  "static": { label: "Статика", description: "Зафиксированная камера, без движения" },
  "handheld": { label: "С рук", description: "Естественная дрожь при съёмке с рук" },
  "steadicam": { label: "Стедикам", description: "Плавный стабилизированный кадр при ходьбе" },

  // Pan
  "pan-left": { label: "Панорама влево", description: "Поворот камеры по горизонтали влево" },
  "pan-right": { label: "Панорама вправо", description: "Поворот камеры по горизонтали вправо" },
  "whip-pan-left": { label: "Резкая панорама влево", description: "Быстрая резкая панорама влево с моушн-блюром" },
  "whip-pan-right": { label: "Резкая панорама вправо", description: "Быстрая резкая панорама вправо с моушн-блюром" },

  // Tilt
  "tilt-up": { label: "Тилт вверх", description: "Наклон камеры вверх" },
  "tilt-down": { label: "Тилт вниз", description: "Наклон камеры вниз" },

  // Zoom
  "zoom-in": { label: "Зум-ин", description: "Оптический зум на объект" },
  "zoom-out": { label: "Зум-аут", description: "Оптический зум от объекта" },
  "crash-zoom-in": { label: "Резкий зум-ин", description: "Быстрый стремительный зум на объект" },
  "crash-zoom-out": { label: "Резкий зум-аут", description: "Быстрый стремительный зум от объекта" },

  // Dolly
  "dolly-in": { label: "Долли вперёд", description: "Толчок камеры к объекту (с параллаксом)" },
  "dolly-out": { label: "Долли назад", description: "Отъезд камеры назад (с параллаксом)" },
  "dolly-zoom": { label: "Долли-зум", description: "Эффект головокружения: долли против зума" },
  "push-in": { label: "Лёгкий наезд", description: "Медленный мягкий наезд на объект" },
  "pull-out": { label: "Лёгкий отъезд", description: "Медленный мягкий отъезд от объекта" },
  "breathing": { label: "Дышащая камера", description: "Тонкое непрерывное колебание наезд-отъезд, органичное ощущение съёмки с рук" },
  "push-pull": { label: "Push-Pull / Качание", description: "Камера движется к объекту, затем обратно, маятниковое приближение и отдаление" },
  "creep-in": { label: "Незаметный наезд", description: "Чрезвычайно медленный незаметный наезд, нагнетающий страх или напряжение" },
  "creep-out": { label: "Незаметный отъезд", description: "Чрезвычайно медленный незаметный отъезд, изолирующий объект в пространстве" },

  // Truck
  "truck-left": { label: "Тревеллинг влево", description: "Боковое смещение камеры влево" },
  "truck-right": { label: "Тревеллинг вправо", description: "Боковое смещение камеры вправо" },

  // Pedestal
  "pedestal-up": { label: "Пьедестал вверх", description: "Подъём камеры по вертикали" },
  "pedestal-down": { label: "Пьедестал вниз", description: "Опускание камеры по вертикали" },

  // Roll
  "roll-left": { label: "Крен влево", description: "Поворот камеры против часовой стрелки" },
  "roll-right": { label: "Крен вправо", description: "Поворот камеры по часовой стрелке" },
  "dutch-angle": { label: "Голландский угол", description: "Статичный наклонённый кадр для напряжения" },

  // Orbit / Arc
  "orbit-left": { label: "Орбита влево", description: "Полный круг вокруг объекта влево" },
  "orbit-right": { label: "Орбита вправо", description: "Полный круг вокруг объекта вправо" },
  "spin-360": { label: "Полный оборот 360°", description: "Камера поворачивается на полные 360 градусов вокруг своей оси" },
  "orbit-360": { label: "Полная орбита 360°", description: "Камера описывает полную дугу 360 градусов вокруг объекта" },
  "arc-left": { label: "Дуга влево", description: "Частичная дуга вокруг объекта влево" },
  "arc-right": { label: "Дуга вправо", description: "Частичная дуга вокруг объекта вправо" },

  // Crane / Jib
  "crane-up": { label: "Кран вверх", description: "Размашистый подъём крана, раскрывающий сцену" },
  "crane-down": { label: "Кран вниз", description: "Размашистое опускание крана" },
  "boom-up": { label: "Стрела вверх", description: "Подъём на стреле" },
  "boom-down": { label: "Стрела вниз", description: "Опускание на стреле" },

  // Tracking / Follow
  "tracking-shot": { label: "Тревеллинг", description: "Камера движется рядом с движущимся объектом" },
  "follow": { label: "Преследование", description: "Преследование объекта сзади" },
  "lead": { label: "Опережение", description: "Движение впереди приближающегося объекта" },
  "drone-follow": { label: "Дрон-сопровождение", description: "Воздушное сопровождение объекта дроном" },
  "dolly-track": { label: "Долли по рельсам", description: "Долли по параллельным рельсам рядом с объектом" },
  "gimbal-walk": { label: "Ходьба со стабилизатором", description: "Плавная съёмка в движении на 3-осевом гимбале, парящее устойчивое движение вперёд" },
  "ronin-glide": { label: "Скольжение Ronin", description: "Медленное скользящее движение на гимбале Ronin / Movi, кинематографическое парение без тряски" },
  "serpentine": { label: "Серпантинная траектория", description: "Камера змеится между препятствиями по S-образным кривым, извилистый путь вперёд" },

  // Special angles / rigs
  "pov": { label: "POV", description: "Вид от первого лица" },
  "over-the-shoulder": { label: "Через плечо", description: "Кадр через плечо персонажа" },
  "birds-eye": { label: "С высоты птичьего полёта", description: "Прямой вид сверху вниз" },
  "worms-eye": { label: "С земли", description: "Экстремально низкий ракурс снизу вверх" },
  "aerial": { label: "Воздушная съёмка", description: "Высотный дроноподобный кадр" },
  "helicopter": { label: "С вертолёта", description: "Широкий высотный размашистый воздушный пролёт" },
  "fly-over": { label: "Пролёт над сценой", description: "Низкий быстрый воздушный пролёт над сценой" },
  "flythrough": { label: "Пролёт сквозь", description: "Камера летит сквозь пространство" },
  "reveal": { label: "Раскрытие", description: "Постепенное раскрытие более широкой сцены" },
  "snorricam": { label: "Snorricam", description: "Камера, закреплённая на теле (объект зафиксирован в кадре)" },
  "rack-focus": { label: "Перевод фокуса", description: "Перевод фокуса между передним и задним планом" },

  // Modern / social-video vocabulary
  "handheld-vlog": { label: "Влог с рук", description: "Непринуждённая ручная съёмка в стиле влога" },
  "pov-walk": { label: "POV-ходьба", description: "POV-ходьба от первого лица" },
  "velocity-edit": { label: "Скоростной монтаж", description: "Темп с ускорением в стиле TikTok" },
  "match-cut-zoom": { label: "Зум для match cut", description: "Зум, синхронизированный с битом для склейки" },
  "screen-tap": { label: "Касание экрана", description: "Переход с касанием пальца по экрану" },
  "phone-flip": { label: "Переключение камеры телефона", description: "Переключение между фронтальной и основной камерой" },
  // Location-studio extension (PR #2505 follow-up)
  "gentle-drift": { label: "Плавный Дрейф", description: "Медленное плавающее окружающее движение" },
  "parallax": { label: "Параллакс", description: "Боковое движение с разделением глубины переднего и заднего планов" },
}

export default map
