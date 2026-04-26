import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Time of day
  "sunrise":     { label: "日出",         description: "暖色低位太阳,长长投影" },
  "golden-hour": { label: "黄金时刻",     description: "暖色日落辉光" },
  "noon":        { label: "正午",         description: "强硬的正午顶光" },
  "harsh-midday":{ label: "正午烈日",     description: "顶光下漂白般的天顶光" },
  "overcast":    { label: "阴天",         description: "柔和扩散的日光" },
  "blue-hour":   { label: "蓝色时刻",     description: "黄昏冷调的暮色" },
  "twilight":    { label: "暮光",         description: "蓝色时刻与黑夜之间的过渡" },
  "night":       { label: "夜晚",         description: "深沉的夜晚,环境光极低" },
  "moonlight":   { label: "月光",         description: "冷蓝色的月光场景" },
  "neon-night":  { label: "霓虹夜",       description: "饱和霓虹色的城市夜晚" },

  // Style
  "three-point":  { label: "三点布光",     description: "经典主光 + 辅光 + 背光" },
  "rembrandt":    { label: "伦勃朗光",     description: "颊上一道三角光" },
  "chiaroscuro":  { description: "强烈的明暗对比" },
  "silhouette":   { label: "剪影",         description: "主体呈纯色形状" },
  "high-key":     { label: "高调光",       description: "明亮、低对比" },
  "low-key":      { label: "低调光",       description: "黑暗、高对比" },
  "split":        { label: "对半分光",     description: "脸部一半亮一半暗" },
  "hard":         { label: "硬光",         description: "边缘锐利的阴影" },
  "soft":         { label: "柔光",         description: "扩散柔和的光" },
  "practical":    { label: "实景灯光",     description: "画面中可见的实用光源" },
  // Modern social-video
  "ring-light":        { label: "环形灯",         description: "美妆 / Vlog 的环形眼神光" },
  "phone-screen-glow": { label: "手机屏幕光",     description: "手机屏自下而上的冷调光" },
  "selfie-natural":    { label: "自拍自然光",     description: "窗光下的自拍" },
  "natural":           { label: "自然光",         description: "可用的环境光" },
  "volumetric":        { label: "体积光",         description: "雾气中可见的光束" },
  "noir":              { label: "黑色电影",       description: "高对比黑白的 film noir" },
  // Flash
  "on-camera-flash":     { label: "机顶闪",         description: "狗仔 / iPhone 直闪" },
  "mirror-bounce-flash": { label: "镜面反射闪光",   description: "镜面自拍的闪光反射" },
  "bounced-flash":       { label: "反射闪光",       description: "天花板反射的柔和补光" },
  "softbox-key":         { label: "柔光箱主光",     description: "大型柔光的时尚主光" },
  "beauty-dish":         { label: "美人碟",         description: "锐利衰减的英雄光" },
  "gridded-snoot":       { label: "蜂窝控光筒",     description: "聚焦集中的小光池" },
  "silk-diffusion":      { label: "丝绸柔光",       description: "用丝绸柔化的主光" },
  "kicker-rim":          { label: "侧后轮廓光",     description: "低位侧后的分离轮廓光" },
  "candlelight":         { label: "烛光",           description: "温暖的火苗摇曳" },
  "edison-tungsten":     { label: "爱迪生钨丝灯",   description: "温馨暖色的球泡灯光" },
  "dappled-light":       { label: "斑驳 / 树叶滤光", description: "穿过叶隙的斑点光" },
  "raking-sidelight":    { label: "掠射侧光",       description: "极低侧角强调肌理" },
  "stage-spotlight":     { label: "舞台射灯",       description: "顶部单束硬射灯" },
  "underwater-caustics": { label: "水下波纹光",     description: "波光粼粼的折射图样" },
  "bioluminescence":     { label: "生物发光",       description: "冷调诡异的生物自体光" },

  // Direction
  "front":               { label: "正面光",         description: "光自镜头方向打来" },
  "three-quarter":       { label: "3/4 侧光",       description: "经典人像主光角度" },
  "side":                { label: "侧光",           description: "从一侧打来的光" },
  "back-rim":            { label: "背 / 轮廓光",    description: "在主体周围形成轮廓的逆光" },
  "silhouette-backlight":{ label: "剪影逆光",       description: "明亮光晕、暗黑主体" },
  "top-overhead":        { label: "顶 / 顶光",      description: "正上方打下的光" },
  "under-uplight":       { label: "下 / 仰光",      description: "从下方打来的光" },
  "window":              { label: "窗光",           description: "来自窗户的柔和侧光" },

  // Lighting ratio
  "ratio-1-1":  { label: "1:1 光比",  description: "平,几无阴影对比" },
  "ratio-1-2":  { label: "1:2 光比",  description: "柔和的一档光比衰减" },
  "ratio-1-3":  { label: "1:3 光比",  description: "中等的两档对比" },
  "ratio-1-4":  { label: "1:4 光比",  description: "强烈的大片感对比" },
  "ratio-1-8":  { label: "1:8 光比",  description: "极致低调的明暗对比" },
  "ratio-1-16": { label: "1:16 光比", description: "单光源的电影黑色衰减" },

  // Portrait setups
  "butterfly": { label: "蝴蝶光",     description: "光从正上方打下,鼻下投出蝴蝶形阴影" },
  "loop":      { label: "环形光",     description: "略偏侧上方,在脸颊投出小环形阴影" },
  "broad":     { label: "宽光",       description: "受光面朝向镜头,显得脸更宽" },
  "short":     { label: "窄光",       description: "受光面背离镜头,显瘦" },
  "hatchet":   { label: "斧光",       description: "顶部掠射,对侧形成深邃阴影" },
  "clamshell": { label: "蚌壳光",     description: "上方主光 + 下方反光板,夹光式美光" },

  // Color temperature — keep Kelvin in alphanumeric
  "temp-2700k": { description: "深琥珀色烛光 / 钨丝灯" },
  "temp-3200k": { description: "暖黄色室内灯光" },
  "temp-4000k": { description: "中性白色" },
  "temp-5600k": { description: "日光平衡的正午阳光" },
  "temp-6500k": { description: "略冷的蓝色调" },
  "temp-9000k": { description: "明显偏冷的蓝色阴影色温" },
}

export default map
