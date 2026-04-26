import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // -------------------- Devices / Phones --------------------
  "smartphone":        { label: "智能手机",       description: "手中的现代手机" },
  "smartphone-raised": { label: "举起的手机",     description: "拍照中举起的手机" },
  "polaroid-camera":   { label: "拍立得相机",     description: "复古即时相机" },
  "vintage-camera":    { label: "复古相机",       description: "带背带的旧胶片相机" },
  "dslr-camera":       { label: "单反相机",       description: "现代单反 / 无反相机" },
  "video-camera":      { label: "摄像机",         description: "肩扛式摄像机" },
  "microphone":        { label: "麦克风",         description: "手持人声麦克风" },
  "megaphone":         { label: "扩音器",         description: "扩音器 / 喊话筒" },
  "smartwatch":        { label: "智能手表",       description: "举起手腕看手表" },

  // -------------------- Drinks --------------------
  "coffee-cup":      { label: "咖啡杯",       description: "陶瓷咖啡杯" },
  "takeaway-coffee": { label: "外带咖啡",     description: "纸质外带咖啡杯" },
  "wine-glass":      { label: "葡萄酒杯",     description: "高脚红葡萄酒杯" },
  "champagne-flute": { label: "香槟杯",       description: "高细香槟杯" },
  "martini-glass":   { label: "马天尼杯",     description: "经典马天尼杯" },
  "cocktail-glass":  { label: "鸡尾酒杯",     description: "装着鸡尾酒的矮杯" },
  "beer-bottle":     { label: "啤酒瓶",       description: "棕色啤酒瓶" },
  "water-bottle":    { label: "水瓶",         description: "可重复使用的水瓶" },

  // -------------------- Smoking --------------------
  "cigarette": { label: "香烟",     description: "夹在指间点燃的香烟" },
  "cigar":     { label: "雪茄",     description: "粗大的点燃雪茄" },
  "vape-pen":  { label: "电子烟",   description: "纤细的电子烟笔" },
  "joint":     { label: "手卷烟",   description: "手卷大麻烟" },

  // -------------------- Reading / Writing --------------------
  "book":       { label: "书",         description: "翻开的精装书" },
  "magazine":   { label: "杂志",       description: "光面对折的杂志" },
  "newspaper":  { label: "报纸",       description: "对折的大开报" },
  "notebook":   { label: "笔记本",     description: "翻开的横线笔记本" },
  "pen":        { label: "钢笔",       description: "悬笔欲写" },
  "marker":     { label: "马克笔",     description: "粗马克笔在书写中" },
  "paintbrush": { label: "画笔",       description: "蘸满颜料的画笔" },
  "chalk":      { label: "粉笔",       description: "白色粉笔条" },

  // -------------------- Bags / Accessories --------------------
  "handbag":     { label: "手提包",     description: "设计师手提包" },
  "tote-bag":    { label: "托特包",     description: "柔软帆布托特包" },
  "briefcase":   { label: "公文包",     description: "硬壳公文包" },
  "umbrella":    { label: "伞",         description: "撑开的黑色伞" },
  "fan-folding": { label: "折扇",       description: "展开的手绘折扇" },
  "parasol":     { label: "阳伞",       description: "装饰性的阳伞,遮阳用" },

  // -------------------- Floral / Nature --------------------
  "bouquet":      { label: "花束",       description: "混合鲜花花束" },
  "single-rose":  { label: "单枝玫瑰",   description: "单枝长茎玫瑰" },
  "sunflower":    { label: "向日葵",     description: "单枝高大向日葵" },
  "leaf":         { label: "叶子",       description: "单片大型叶子" },
  "fruit-apple":  { label: "苹果",       description: "新鲜苹果一颗" },

  // -------------------- Instruments / Performance --------------------
  "guitar":      { label: "吉他",         description: "斜挎在身上的吉他" },
  "violin":      { label: "小提琴",       description: "夹在下巴下的小提琴" },
  "saxophone":   { label: "萨克斯",       description: "举到嘴边的萨克斯" },
  "drumsticks":  { label: "鼓棒",         description: "交叉握着的一对鼓棒" },
  "sheet-music": { label: "乐谱",         description: "对折的乐谱" },

  // -------------------- Companion --------------------
  "small-dog":   { label: "小狗",       description: "怀抱中的小狗" },
  "cat":         { label: "猫",         description: "搭在臂弯上的猫" },
  "plush-toy":   { label: "毛绒玩具",   description: "紧抱的毛绒玩偶" },

  // -------------------- Occupational / Weapon --------------------
  "katana":        { label: "武士刀",     description: "单刃日式武士刀" },
  "pointer-stick": { label: "教鞭",       description: "可伸缩的教鞭" },
  "gavel":         { label: "法槌",       description: "木制法官法槌" },
  "wine-bottle":   { label: "葡萄酒瓶",   description: "封口完整的整瓶葡萄酒" },
  "locket":        { label: "挂坠盒",     description: "指间打开的复古挂坠盒" },
  "lighter":       { label: "打火机",     description: "镀铬打火机,大拇指按在火焰上" },
  "lantern":       { label: "灯笼",       description: "复古手提灯笼,温暖的琥珀色光" },
  "flashlight":    { label: "手电筒",     description: "现代手电筒光束,探险 / 神秘氛围" },
  "compass":       { label: "指南针",     description: "手持航海指南针,探险感" },
  "bow-and-arrow": { label: "弓与箭",     description: "拉满的弓,搭着箭" },
  "shield":        { label: "盾牌",       description: "手持的盾牌,中世纪 / 奇幻风" },
}

export default map
