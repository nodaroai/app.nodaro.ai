import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // -------------------- Fabric --------------------
  "silk":     { label: "丝绸",       description: "光滑闪亮的丝绸" },
  "cotton":   { label: "棉",         description: "柔软哑光的棉布" },
  "denim":    { label: "牛仔布",     description: "厚实靛蓝色牛仔布" },
  "leather":  { label: "皮革",       description: "丰润柔软的皮革" },
  "velvet":   { label: "天鹅绒",     description: "柔软厚实的天鹅绒" },
  "satin":    { label: "缎面",       description: "光泽顺滑的缎面" },
  "lace":     { label: "蕾丝",       description: "精致花纹的蕾丝" },
  "wool":     { label: "羊毛",       description: "温暖编织的羊毛" },
  "linen":    { label: "亚麻",       description: "天然带质感的亚麻" },
  "tweed":    { label: "粗花呢",     description: "粗犷编织的粗花呢" },
  "cashmere": { label: "羊绒",       description: "奢华柔软的羊绒" },
  "chiffon":  { label: "雪纺",       description: "薄透飘逸的雪纺" },
  "fur":      { label: "毛皮",       description: "厚实蓬松的毛皮" },
  "suede":    { label: "麂皮",       description: "柔软起绒的皮革,哑光丝绒般的表面" },
  "mesh":     { label: "网眼布",     description: "透视的网状面料,运动 / 透视上衣感" },
  "patent-leather": { label: "漆皮", description: "高光泽反射的皮革" },

  // -------------------- Metal --------------------
  "gold":      { label: "黄金",       description: "抛光黄金" },
  "silver":    { label: "白银",       description: "抛光白银" },
  "bronze":    { label: "青铜",       description: "带铜锈的铸青铜" },
  "chrome":    { label: "镀铬",       description: "超反射的镀铬面" },
  "copper":    { label: "紫铜",       description: "暖色带氧化的紫铜" },
  "brass":     { label: "黄铜",       description: "古旧黄铜" },
  "steel":     { label: "钢",         description: "拉丝不锈钢" },
  "iron":      { label: "铁",         description: "粗糙锻铁" },
  "platinum":  { label: "铂金",       description: "光泽铂金" },
  "titanium":  { label: "钛",         description: "哑光工业感钛" },

  // -------------------- Stone --------------------
  "marble":     { label: "大理石",     description: "带纹理的白色大理石" },
  "granite":    { label: "花岗岩",     description: "斑点抛光的花岗岩" },
  "obsidian":   { label: "黑曜石",     description: "光泽黑色黑曜石" },
  "sandstone":  { label: "砂岩",       description: "暖色层理的砂岩" },
  "slate":      { label: "板岩",       description: "深色平整的板岩" },
  "jade":       { label: "玉",         description: "半透明的绿色玉石" },
  "onyx":       { label: "玛瑙",       description: "条带抛光的玛瑙" },
  "concrete":   { label: "混凝土",     description: "工业感浇筑混凝土" },
  "terrazzo":   { label: "水磨石",     description: "嵌入大理石 / 玻璃碎片的复合石材" },

  // -------------------- Wood --------------------
  "oak":       { label: "橡木",       description: "纹理丰富的橡木" },
  "mahogany":  { label: "桃花心木",   description: "深红色桃花心木" },
  "walnut":    { label: "胡桃木",     description: "深色胡桃木" },
  "bamboo":    { label: "竹",         description: "浅色分节的竹" },
  "birch":     { label: "桦木",       description: "浅色光滑的桦木" },
  "driftwood": { label: "漂流木",     description: "经风化的漂流木" },

  // -------------------- Glass / Ceramic --------------------
  "glass":          { label: "玻璃",         description: "透明清晰的玻璃" },
  "stained-glass":  { label: "彩色玻璃",     description: "宝石色调的彩色玻璃" },
  "crystal":        { label: "水晶",         description: "切割的透明水晶" },
  "porcelain":      { label: "瓷",           description: "光滑的白色瓷" },
  "ceramic-glazed": { label: "上釉陶瓷",     description: "土系上釉陶瓷" },
  "terracotta":     { label: "陶土",         description: "暖色未釉的陶土" },

  // -------------------- Natural / Elemental --------------------
  "water":  { label: "水",       description: "流动半透明的水" },
  "fire":   { label: "火",       description: "鲜活的火焰" },
  "ice":    { label: "冰",       description: "半透明的结晶冰" },
  "smoke":  { label: "烟",       description: "飘逸的烟雾" },
  "sand":   { label: "沙",       description: "细颗粒的沙" },
  "moss":   { label: "苔藓",     description: "茂盛鲜活的苔藓" },
  "leaves": { label: "叶子",     description: "层叠的植物叶片" },

  // -------------------- Exotic / Futuristic --------------------
  "holographic":   { label: "全息",         description: "虹彩全息" },
  "liquid-metal":  { label: "液态金属",     description: "反射液态铬" },
  "neon":          { label: "霓虹光",       description: "发光的霓虹管" },
  "translucent":   { label: "半透明树脂",   description: "磨砂发光的树脂" },
  "mirror":        { label: "镜面",         description: "完美的镜面" },
  "plasma":        { label: "等离子",       description: "电光闪烁的等离子" },
  "crystal-shard": { label: "水晶碎片",     description: "破碎发光的水晶" },
  "obsidian-glass":{ label: "黑曜玻璃",     description: "暗色火山玻璃" },
  "iridescent":     { label: "虹彩",         description: "随角度变化的彩虹光泽表面" },
  "mother-of-pearl":{ label: "珍珠母",       description: "贝壳内壁的珠光面,虹彩奶白" },
  "carbon-fiber":   { label: "碳纤维",       description: "编织的黑色碳纤维复合材料" },
  "holographic-film":{ label: "全息膜",      description: "折射光线的全息膜,带彩虹闪光" },
  "subsurface": { label: "次表面散射光", description: "光从表面之下透出" },
}

export default map
