import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // -------------------- Fabric --------------------
  "silk": { label: "Шёлк", description: "Гладкий глянцевый шёлк" },
  "cotton": { label: "Хлопок", description: "Мягкий матовый хлопок" },
  "denim": { label: "Деним", description: "Плотный индиго-деним" },
  "leather": { label: "Кожа", description: "Богатая мягкая кожа" },
  "velvet": { label: "Бархат", description: "Плюшевый бархат" },
  "satin": { label: "Атлас", description: "Глянцевый атлас" },
  "lace": { label: "Кружево", description: "Изящное узорчатое кружево" },
  "wool": { label: "Шерсть", description: "Тёплая тканая шерсть" },
  "linen": { label: "Лён", description: "Натуральный текстурный лён" },
  "tweed": { label: "Твид", description: "Деревенский тканый твид" },
  "cashmere": { label: "Кашемир", description: "Роскошный мягкий кашемир" },
  "chiffon": { label: "Шифон", description: "Прозрачный струящийся шифон" },
  "fur": { label: "Мех", description: "Густой плюшевый мех" },

  // -------------------- Metal --------------------
  "gold": { label: "Золото", description: "Полированное золото" },
  "silver": { label: "Серебро", description: "Полированное серебро" },
  "bronze": { label: "Бронза", description: "Литая бронза с патиной" },
  "chrome": { label: "Хром", description: "Сверхотражающий хром" },
  "copper": { label: "Медь", description: "Тёплая медь с патиной" },
  "brass": { label: "Латунь", description: "Старинная латунь" },
  "steel": { label: "Сталь", description: "Шлифованная нержавеющая сталь" },
  "iron": { label: "Железо", description: "Грубое кованое железо" },
  "platinum": { label: "Платина", description: "Сияющая платина" },
  "titanium": { label: "Титан", description: "Матовый промышленный титан" },

  // -------------------- Stone --------------------
  "marble": { label: "Мрамор", description: "Белый мрамор с прожилками" },
  "granite": { label: "Гранит", description: "Полированный гранит с крапинками" },
  "obsidian": { label: "Обсидиан", description: "Глянцевый чёрный обсидиан" },
  "sandstone": { label: "Песчаник", description: "Тёплый слоистый песчаник" },
  "slate": { label: "Сланец", description: "Тёмный плоский сланец" },
  "jade": { label: "Нефрит", description: "Полупрозрачный зелёный нефрит" },
  "onyx": { label: "Оникс", description: "Полированный оникс с полосами" },
  "concrete": { label: "Бетон", description: "Литой промышленный бетон" },

  // -------------------- Wood --------------------
  "oak": { label: "Дуб", description: "Богатый текстурный дуб" },
  "mahogany": { label: "Махагон", description: "Тёмно-красный махагон" },
  "walnut": { label: "Орех", description: "Тёмный орех" },
  "bamboo": { label: "Бамбук", description: "Светлый сегментированный бамбук" },
  "birch": { label: "Берёза", description: "Бледная гладкая берёза" },
  "driftwood": { label: "Сплавная древесина", description: "Обветренная сплавная древесина" },

  // -------------------- Glass / Ceramic --------------------
  "glass": { label: "Стекло", description: "Прозрачное стекло" },
  "stained-glass": { label: "Витражное стекло", description: "Драгоценное витражное стекло" },
  "crystal": { label: "Хрусталь", description: "Гранёный прозрачный хрусталь" },
  "porcelain": { label: "Фарфор", description: "Гладкий белый фарфор" },
  "ceramic-glazed": { label: "Глазурованная керамика", description: "Земляная глазурованная керамика" },
  "terracotta": { label: "Терракота", description: "Тёплая неглазурованная терракота" },

  // -------------------- Natural / Elemental --------------------
  "water": { label: "Вода", description: "Текучая полупрозрачная вода" },
  "fire": { label: "Огонь", description: "Живое пламя" },
  "ice": { label: "Лёд", description: "Полупрозрачный кристаллический лёд" },
  "smoke": { label: "Дым", description: "Эфирный дрейфующий дым" },
  "sand": { label: "Песок", description: "Мелкозернистый песок" },
  "moss": { label: "Мох", description: "Пышный живой мох" },
  "leaves": { label: "Листья", description: "Слои растительных листьев" },

  // -------------------- Exotic / Futuristic --------------------
  "holographic": { label: "Голографический", description: "Переливающаяся голограмма" },
  "liquid-metal": { label: "Жидкий металл", description: "Отражающий жидкий хром" },
  "neon": { label: "Неоновое свечение", description: "Светящиеся неоновые трубки" },
  "translucent": { label: "Полупрозрачная смола", description: "Матовая светящаяся смола" },
  "mirror": { label: "Зеркало", description: "Идеальная зеркальная поверхность" },
  "plasma": { label: "Плазма", description: "Светящаяся электрическая плазма" },
  "crystal-shard": { label: "Хрустальные осколки", description: "Расколотый светящийся хрусталь" },
  "obsidian-glass": { label: "Обсидиановое стекло", description: "Тёмное вулканическое стекло" },
  "suede": { label: "Замша", description: "Мягкая ворсистая кожа, матовая бархатистая поверхность" },
  "mesh": { label: "Сетка", description: "Прозрачная сетчатая ткань, спортивная или прозрачный топ" },
  "patent-leather": { label: "Лаковая кожа", description: "Высокоглянцевая отражающая кожа" },
  "terrazzo": { label: "Терраццо", description: "Композитный камень с вкраплениями мрамора и стекла" },
  "iridescent": { label: "Радужный", description: "Поверхность с радужным переливом" },
  "mother-of-pearl": { label: "Перламутр", description: "Перламутровая внутренняя сторона раковины, переливчатый кремовый" },
  "carbon-fiber": { label: "Карбон", description: "Тканый чёрный карбоновый композит" },
  "holographic-film": { label: "Голографическая плёнка", description: "Светопреломляющая голограмма с радужным мерцанием" },
}

export default map
