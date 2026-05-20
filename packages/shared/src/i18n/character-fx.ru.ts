import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // ── Transformation ──
  "auto": { label: "Авто", description: "Модель выбирает подходящий эффект" },
  "none": { label: "Нет", description: "Без эффекта на персонажа" },
  "werewolf": { label: "Оборотень", description: "Превращается в оборотня" },
  "vampire": { label: "Вампир", description: "Превращается в вампира" },
  "cyborg": { label: "Раскрытие киборга", description: "Кожа раздвигается, открывая кибернетику" },
  "ghost-form": { label: "Форма призрака", description: "Тело становится прозрачным и эфемерным" },
  "statue-stone": { label: "Окаменение", description: "Тело превращается в каменную статую" },
  "liquid-metal": { label: "Жидкий металл", description: "Тело превращается в жидкий хром (стиль T-1000)" },
  "animalization": { label: "Анимализация", description: "Превращается в животное" },
  "gorilla-form": { label: "Форма гориллы", description: "Превращается в массивную гориллу" },
  "mystification": { label: "Магическое превращение", description: "Магическая аура окутывает и преображает персонажа" },
  "gas-form": { label: "Газовая форма", description: "Тело рассеивается в газообразную форму" },
  "diamond-skin": { label: "Алмазная кожа", description: "Тело кристаллизуется в алмазные грани" },
  "agent-reveal": { label: "Агентское перевоплощение", description: "Костюм и очки мгновенно появляются на персонаже" },

  // ── Power ──
  "fire-breathe": { label: "Огненное дыхание", description: "Выдыхает непрерывную струю огня" },
  "ice-breathe": { label: "Ледяное дыхание", description: "Выдыхает поток замёрзшего воздуха" },
  "air-bending": { label: "Управление воздухом", description: "Управляет видимым вихрем ветра" },
  "water-bending": { label: "Управление водой", description: "Манипулирует потоком воды жестами" },
  "earth-bending": { label: "Управление землёй", description: "Поднимает каменные плиты из земли" },
  "lightning-hands": { label: "Молнии из рук", description: "Электрические дуги вырываются из рук" },
  "levitation": { label: "Левитация", description: "Отрывается от земли, тело вертикально или горизонтально" },
  "telekinesis": { label: "Телекинез", description: "Ближайшие предметы парят и вращаются вокруг" },
  "invisibility": { label: "Невидимость", description: "Тело исчезает, становясь прозрачным" },
  "hero-flight": { label: "Полёт супергероя", description: "Взлетает в небо в героической позе" },
  "super-speed": { label: "Сверхскорость", description: "Движется с бешеной скоростью, оставляя послеобразы" },
  "soul-departure": { label: "Выход души", description: "Прозрачная душа поднимается из тела" },

  // ── Body-Mod ──
  "wings-grow": { label: "Рост крыльев", description: "Крылья прорастают и раскрываются из спины" },
  "horns-grow": { label: "Рост рогов", description: "Рога пробиваются из головы" },
  "tail-emerge": { label: "Появление хвоста", description: "Хвост вытягивается из основания позвоночника" },
  "tentacles-emerge": { label: "Появление щупалец", description: "Щупальца извиваются и вырастают из спины" },
  "extra-eyes": { label: "Открытие дополнительных глаз", description: "Дополнительные глаза открываются по всему лицу и телу" },
  "head-explode": { label: "Взрыв головы", description: "Голова взрывается на абстрактные частицы (PG-13, стилизованно)" },
  "head-off": { label: "Отделение головы", description: "Голова отделяется и парит (стилизованно, PG-13)" },
  "spiders-from-mouth": { label: "Пауки изо рта", description: "Пауки выползают из открытого рта (хоррор)" },
  "skin-surge": { label: "Волна под кожей", description: "Кожа пульсирует, будто что-то движется внутри" },

  // ── Face-Expression ──
  "horror-face": { label: "Ужасающее лицо", description: "Лицо искажается в выражение ужаса" },
  "oni-mask": { label: "Маска они", description: "Красно-золотая маска демона появляется на лице" },
  "glowing-eyes": { label: "Светящиеся глаза", description: "Глаза воспламеняются внутренним светом" },
  "floral-eyes": { label: "Цветочные глаза", description: "Цветы расцветают из глазниц" },
  "bloom-mouth": { label: "Цветущий рот", description: "Цветы и лозы расцветают из открытого рта" },
  "x-ray": { label: "Рентген-обнаружение", description: "Тело становится полупрозрачным, видны кости" },
  "agent-snap": { label: "Надевание очков", description: "Тёмные очки резко появляются на лице персонажа" },
  "visor-x": { label: "Кибер-визор", description: "Футуристический кибернетический визор появляется на лице" },

  // ── Aura-Ambient ──
  "paparazzi": { label: "Вспышки папарацци", description: "Вспышки камер сверкают вокруг персонажа" },
  "money-rain": { label: "Дождь из денег", description: "Купюры падают вокруг персонажа" },
  "color-rain": { label: "Цветной дождь", description: "Яркие цветные капли падают вокруг персонажа" },
  "saint-glow": { label: "Святое сияние", description: "Золотой нимб и небесный свет окружают персонажа" },
  "fire-aura": { label: "Огненная аура", description: "Языки пламени облизывают тело персонажа" },
  "frost-aura": { label: "Морозная аура", description: "Иней и лёд расходятся от персонажа" },
  "shadow-aura": { label: "Теневая аура", description: "Тёмные щупальца тени вьются вокруг персонажа" },
  "electricity-aura": { label: "Электрическая аура", description: "Дуги тока как у катушки Тесла окружают персонажа" },
  "sparkles-around": { label: "Магические искры вокруг", description: "Искры и звёздные частицы кружатся вокруг персонажа" },
  "fairies-around": { label: "Феи вокруг", description: "Крошечные светящиеся феи порхают вокруг персонажа" },
  "objects-orbit": { label: "Орбита предметов", description: "Маленькие предметы парят и вращаются вокруг персонажа" },
  "petals-around": { label: "Лепестки вокруг", description: "Лепестки сакуры медленно кружатся вокруг персонажа" },
  "glow-trace": { label: "Световой след", description: "Светящиеся следы тянутся за движениями персонажа" },
  "tattoo-animation": { label: "Анимация татуировок", description: "Татуировки светятся и оживают на коже" },
}

export default map
