import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // ── Disaster ──
  "earthquake-tremor": { label: "Подземный толчок", description: "Лёгкое сотрясение земли, висящие предметы качаются" },
  "earthquake-major": { label: "Сильное землетрясение", description: "Земля раскалывается, обломки падают" },
  "building-collapse": { label: "Обрушение здания", description: "Крошащееся в падении строение" },
  "tsunami-wave": { label: "Волна цунами", description: "Громадная стена воды надвигается" },
  "tornado": { label: "Торнадо", description: "Воронка касается земли" },
  "hurricane": { label: "Ураган", description: "Воющий ветер сгибает деревья, потоки дождя" },
  "blizzard-whiteout": { label: "Снежный буран", description: "Густой снег полностью скрывает видимость" },
  "sandstorm": { label: "Песчаная буря", description: "Стена оранжевой пыли поглощает сцену" },
  "dust-storm-haboob": { label: "Пыльная буря (Хабуб)", description: "Громадный фронт пустынной пыли" },
  "wildfire-distant": { label: "Далёкий лесной пожар", description: "Оранжевое зарево и дым на горизонте" },
  "wildfire-engulfing": { label: "Охватывающий лесной пожар", description: "Пламя приближается, сильное мерцание жара" },
  "volcanic-eruption": { label: "Извержение вулкана", description: "Извергающаяся лава, столб пепла" },
  "lava-flow": { label: "Поток лавы", description: "Светящаяся расплавленная река ползёт по земле" },
  "ash-rain": { label: "Пепельный дождь", description: "Апокалиптический серый пепел падает как снег" },
  "avalanche": { label: "Лавина", description: "Стена снега катится по горному склону" },
  "hailstorm": { label: "Град", description: "Крупный град отскакивает от поверхностей" },

  // ── Fire & Blasts ──
  "explosion-small": { label: "Малый взрыв", description: "Компактный взрыв с фокусной вспышкой" },
  "explosion-large": { label: "Крупный взрыв", description: "Огненный шар размером с автомобиль с обломками" },
  "explosion-massive": { label: "Мощный взрыв", description: "Огненный шар, сметающий здания, с ударной волной" },
  "nuclear-detonation": { label: "Ядерный взрыв", description: "Грибовидное облако и слепящая вспышка на горизонте" },
  "fireball-airborne": { label: "Воздушный огненный шар", description: "Катящийся в воздухе шар пламени" },
  "gas-explosion": { label: "Взрыв газа", description: "Яркий взрыв пропанового типа" },
  "oil-fire": { label: "Нефтяной пожар", description: "Высокое маслянистое пламя и густой чёрный дым" },
  "blazing-inferno": { label: "Бушующий ад", description: "Стена огня, пожирающая всё" },
  "flame-burst": { label: "Огненный выброс", description: "Быстрая направленная струя пламени" },
  "ember-shower": { label: "Ливень углей", description: "Каскад светящихся оранжевых углей" },
  "smoke-pillar": { label: "Столб дыма", description: "Высокая вертикальная колонна чёрного дыма" },
  "mushroom-cloud": { label: "Грибовидное облако", description: "Классическое облако взрыва с куполом и стволом" },

  // ── Electric ──
  "lightning-bolt": { label: "Молния", description: "Разветвлённый разряд через грозовое небо" },
  "lightning-strike-impact": { label: "Удар молнии в землю", description: "Молния бьёт в землю со взрывом света" },
  "lightning-storm": { label: "Грозовая буря", description: "Множественные одновременные разряды" },
  "ball-lightning": { label: "Шаровая молния", description: "Светящийся шар электрической плазмы парит в воздухе" },
  "plasma-arc": { label: "Плазменная дуга", description: "Непрерывная высоковольтная дуга между двумя точками" },
  "taser-sparks": { label: "Искры электрошокера", description: "Компактный потрескивающий электрический разряд при контакте" },
  "electric-discharge": { label: "Электрический разряд", description: "Вспышка дуговой энергии из неисправного устройства" },
  "transformer-blowout": { label: "Взрыв трансформатора", description: "Бело-голубой взрыв на верхушке столба" },
  "st-elmos-fire": { label: "Огни святого Эльма", description: "Жуткое голубое плазменное свечение на металлических остриях" },
  "static-shock-burst": { label: "Статический разряд", description: "Маленькая видимая искра статического электричества" },

  // ── Combat ──
  "muzzle-flash": { label: "Дульная вспышка", description: "Яркая оранжевая вспышка из дула оружия" },
  "gunshot-impact": { label: "Попадание пули", description: "Пуля бьёт в поверхность с разлётом обломков" },
  "bullet-trail": { label: "След пули", description: "Видимый след пули в воздухе" },
  "sword-spark": { label: "Искры от меча", description: "Макро-сноп искр от трения металла о металл" },
  "blade-clash": { label: "Столкновение клинков", description: "Два клинка встречаются с ударной волной" },
  "ricochet-spark": { label: "Искра рикошета", description: "Пуля рикошетит от металла с искрами" },
  "debris-field": { label: "Поле обломков", description: "Замершие в воздухе осколки разлетаются" },
  "glass-shatter-airborne": { label: "Стекло разлетается в воздухе", description: "Стекло взрывается во множество висящих в воздухе осколков" },
  "shockwave-ground": { label: "Наземная ударная волна", description: "Видимое расширяющееся кольцо на уровне земли" },
  "sonic-boom": { label: "Звуковой удар", description: "Конус сжатого воздуха на сверхзвуке" },
  "smoke-grenade": { label: "Дымовая граната", description: "Густой цветной дым расходится наружу" },
  "flashbang": { label: "Светошумовая граната", description: "Ослепительная белая вспышка света" },
  "blood-spray": { label: "Брызги крови", description: "Кинематографическая дуга капель крови" },
  "arrow-hit-spark": { label: "Искра попадания стрелы", description: "Стрела впивается с маленькими искрами в точке удара" },

  // ── Sci-Fi ──
  "laser-blast": { label: "Лазерный выстрел", description: "Яркий когерентный энергетический луч" },
  "energy-beam": { label: "Энергетический луч", description: "Широкий пульсирующий луч плазменной энергии" },
  "plasma-bolt": { label: "Плазменный заряд", description: "Светящийся снаряд оставляет след пара" },
  "force-field-shimmer": { label: "Мерцание силового поля", description: "Полупрозрачный энергобарьер с гексагональным узором" },
  "force-field-impact": { label: "Удар по силовому полю", description: "Видимая рябь там, где снаряд попадает в щит" },
  "portal-opening": { label: "Открытие портала", description: "Вихрь энергии разрывает пространство" },
  "warp-distortion": { label: "Варп-искажение", description: "Пространство-время изгибается вокруг объекта" },
  "hologram-flicker": { label: "Мерцание голограммы", description: "Полупрозрачная проекция с глитчами" },
  "ion-storm": { label: "Ионный шторм", description: "Потрескивающее поле заряженных частиц на космическом фоне" },
  "antimatter-flash": { label: "Вспышка антиматерии", description: "Разрывающий реальность всплеск чистой белой энергии" },

  // ── Magic ──
  "fireball-spell": { label: "Заклинание огненного шара", description: "Брошенный рукой кружащийся шар огня" },
  "magic-aura": { label: "Магическая аура", description: "Светящийся ореол энергии вокруг фигуры" },
  "summoning-glyph": { label: "Призывной глиф", description: "Светящийся магический круг на земле" },
  "lightning-magic": { label: "Магия молний", description: "Электрическое чародейство срывается с рук заклинателя" },
  "ice-shard-burst": { label: "Взрыв ледяных осколков", description: "Кристаллические осколки разлетаются наружу" },
  "energy-rune": { label: "Руна энергии", description: "Светящийся арканный символ висит в воздухе" },
  "portal-magic": { label: "Магический портал", description: "Кружащийся мистический проход в пространстве" },
  "healing-glow": { label: "Сияние исцеления", description: "Тёплый золотой свет исходит от заклинателя" },
  "dark-vortex": { label: "Тёмный вихрь", description: "Зловещая чёрно-фиолетовая кружащаяся бездна" },
  "light-explosion": { label: "Взрыв света", description: "Вспышка чистого бело-золотого сияния" },
}

export default map
