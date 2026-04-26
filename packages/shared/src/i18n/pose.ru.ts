import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // -------------------- Standing --------------------
  "standing-upright": { label: "Стоя прямо", description: "Расслабленная стоячая поза" },
  "confident-stance": { label: "Уверенная стойка", description: "Ноги расставлены, плечи назад" },
  "hands-on-hips": { label: "Руки на бёдрах", description: "Руки на бёдрах" },
  "arms-crossed": { label: "Скрещённые руки", description: "Руки скрещены на груди" },
  "leaning": { label: "Облокотившись", description: "Облокотившись на что-то" },
  "hero-pose": { label: "Героическая поза", description: "Драматичная героическая стойка" },
  "contrapposto": { label: "Контрапост", description: "Бедро наклонено, вес на одну ногу" },
  "leaning-against-wall": { label: "Прислонившись к стене", description: "Непринуждённо прислонившись к стене" },
  "hands-behind-head": { label: "Руки за головой", description: "Обе руки сцеплены за головой" },
  "hands-behind-back": { label: "Руки за спиной", description: "Руки сцеплены за спиной" },

  // -------------------- Seated --------------------
  "sitting": { label: "Сидя", description: "Естественное сидение" },
  "cross-legged": { label: "Скрестив ноги", description: "Сидя по-турецки на полу" },
  "kneeling": { label: "Стоя на коленях", description: "Стоя на одном или обоих коленях" },
  "crouching": { label: "Присев", description: "Присев низко" },
  "lounging": { label: "Развалившись", description: "Расслабленное полулежащее положение" },
  "sitting-edge-of-bed": { label: "Сидя на краю кровати", description: "Сидя на краю кровати" },
  "chair-arm-drape": { label: "Ноги на подлокотнике", description: "Ноги перекинуты через подлокотник стула" },
  "elbow-propped": { label: "Щека на локте", description: "Щека опирается на локоть" },
  "lying-on-stomach-reading": { label: "Лёжа читая", description: "Лёжа на животе, опираясь на локти, читая" },

  // -------------------- Movement --------------------
  "walking": { label: "Идёт", description: "На середине шага" },
  "running": { label: "Бежит", description: "На середине бега, в движении" },
  "jumping": { label: "Прыгает", description: "В воздухе, на середине прыжка" },
  "dancing": { label: "Танцует", description: "Пойман на середине танца" },
  "climbing": { label: "Карабкается", description: "Карабкается, держась за верх" },
  "mid-fall": { label: "На середине падения", description: "Пойман на середине падения через воздух" },
  "mid-spin": { label: "На середине вращения", description: "Кружится на середине вращения" },
  "stretching": { label: "Потягивается", description: "Полное потягивание тела, руки вверх" },
  "reaching-up": { label: "Тянется вверх", description: "Руки вытянуты вверх" },
  "kissing": { label: "Целуется", description: "В поцелуе" },
  "riding": { label: "Едет верхом", description: "Едет на велосипеде, лошади или мотоцикле" },
  "driving": { label: "За рулём", description: "За рулём транспортного средства" },

  // -------------------- Action --------------------
  "fighting-stance": { label: "Боевая стойка", description: "Стойка готовности к бою" },
  "reaching": { label: "Тянется", description: "Тянется наружу" },
  "throwing": { label: "Бросает", description: "На середине броска" },
  "leaping": { label: "Прыгает вперёд", description: "Динамичный прыжок вперёд" },
  "dramatic-action": { label: "Драматическое действие", description: "Преувеличенная действующая поза" },
  "biting-lip": { label: "Кусает губу", description: "Лёгкое игривое прикусывание губы" },
  "mid-laugh": { label: "На середине смеха", description: "Пойман на середине смеха, голова откинута назад" },
  "pointing-at-camera": { label: "Указывает на камеру", description: "Указывает прямо на камеру" },
  "tongue-out": { label: "Высунутый язык", description: "Игривое выражение с высунутым языком" },
  "thinking": { label: "Размышляет", description: "Рука на подбородке, задумчиво" },

  // -------------------- Resting --------------------
  "lying-down": { label: "Лежит", description: "Лежит ровно" },
  "sleeping": { label: "Спит", description: "Глаза закрыты, спит" },
  "hugging": { label: "Обнимает", description: "Обнимает другого" },
  "looking-away": { label: "Смотрит в сторону", description: "Голова повёрнута, смотрит в сторону" },
  "looking-up": { label: "Смотрит вверх", description: "Смотрит на небо" },
  "looking-down": { label: "Смотрит вниз", description: "Опущенные глаза" },
  "head-over-shoulder": { label: "Голова через плечо", description: "Смотрит назад через плечо" },
  "wading-in-water": { label: "Бредёт по воде", description: "Бредёт по воде по середину бедра" },

  // -------------------- Hand Position --------------------
  "hands-in-pockets": { label: "Руки в карманах", description: "Обе руки в карманах" },
  "hand-on-hip": { label: "Рука на бедре", description: "Одна рука на бедре" },
  "hand-position-hands-on-hips": { label: "Руки на бёдрах", description: "Обе руки на бёдрах" },
  "hand-on-chin": { label: "Рука на подбородке", description: "Рука покоится под подбородком" },
  "hand-on-collarbone": { label: "Рука на ключице", description: "Рука покоится на ключице" },
  "hand-brushing-hair": { label: "Рука в волосах", description: "Рука проводит по волосам" },
  "finger-to-lip": { label: "Палец на губах", description: "Кончик пальца прижат к нижней губе" },
  "arms-wrapped-around-self": { label: "Руки обхватили себя", description: "Самообнятие, руки вокруг туловища" },
  "hands-clasped": { label: "Сцепленные руки", description: "Обе руки сцеплены спереди" },

  // -------------------- Body Lean --------------------
  "leaning-back": { label: "Откинут назад", description: "Туловище слегка откинуто назад" },
  "leaning-forward": { label: "Наклон вперёд", description: "Туловище наклонено к камере" },
  "body-lean-contrapposto": { label: "Контрапост", description: "Вес на одной ноге, бедро выдвинуто" },
  "arched-back": { label: "Изогнутая спина", description: "Спина мягко изогнута, грудь вперёд" },
  "shoulder-rolled-forward": { label: "Плечо вперёд", description: "Одно плечо подалось вперёд" },

  // -------------------- Head Tilt --------------------
  "tilted-up": { label: "Наклон вверх", description: "Голова слегка наклонена вверх" },
  "tilted-down": { label: "Наклон вниз", description: "Голова слегка наклонена вниз" },
  "tilted-side": { label: "Наклон в сторону", description: "Голова наклонена к плечу" },
  "tilted-back": { label: "Наклон назад", description: "Голова полностью назад, обнажая горло" },
  "chin-up": { label: "Подбородок вверх", description: "Подбородок поднят, смотрит сверху вниз" },
  "chin-tucked": { label: "Подбородок прижат", description: "Подбородок прижат к груди" },

  // -------------------- Activity --------------------
  "activity-smoking": { label: "Курит", description: "Держит и курит сигарету" },
  "activity-drinking": { label: "Пьёт", description: "Пьёт из стакана или чашки" },
  "activity-eating": { label: "Ест", description: "Пойман на середине укуса" },
  "activity-talking-on-phone": { label: "Говорит по телефону", description: "Телефон у уха, говорит" },
  "activity-texting": { label: "Печатает сообщение", description: "Смотрит на телефон, большие пальцы печатают" },
  "activity-typing-laptop": { label: "Печатает на ноутбуке", description: "Руки на клавиатуре, сосредоточен на экране" },
  "activity-reading": { label: "Читает", description: "Держит открытой книгу или журнал" },
  "activity-writing": { label: "Пишет", description: "Пишет в блокноте ручкой" },
  "activity-painting": { label: "Рисует", description: "Рисует на холсте кистью" },
  "activity-playing-instrument": { label: "Играет на инструменте", description: "Играет на музыкальном инструменте" },
  "activity-cooking": { label: "Готовит", description: "Готовит на кухонной стойке или плите" },
  "activity-driving": { label: "За рулём", description: "За рулём, руки сжимают руль" },
}

export default map
