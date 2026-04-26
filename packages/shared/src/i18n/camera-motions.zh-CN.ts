import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Basic
  "auto":      { label: "自动",       description: "由模型选择合适的镜头运动" },
  "static":    { label: "固定",       description: "镜头固定不动" },
  "handheld":  { label: "手持",       description: "自然的手持抖动" },
  "steadicam": { label: "斯坦尼康",   description: "平稳的稳定器行走镜头" },

  // Pan
  "pan-left":       { label: "向左摇镜",     description: "镜头水平向左旋转" },
  "pan-right":      { label: "向右摇镜",     description: "镜头水平向右旋转" },
  "whip-pan-left":  { label: "向左甩镜",     description: "快速向左甩镜并带运动模糊" },
  "whip-pan-right": { label: "向右甩镜",     description: "快速向右甩镜并带运动模糊" },

  // Tilt
  "tilt-up":   { label: "上摇",   description: "镜头向上俯仰" },
  "tilt-down": { label: "下摇",   description: "镜头向下俯仰" },

  // Zoom
  "zoom-in":         { label: "推近变焦",     description: "镜头变焦推向被摄对象" },
  "zoom-out":        { label: "拉远变焦",     description: "镜头变焦远离被摄对象" },
  "crash-zoom-in":   { label: "急推变焦",     description: "急促的甩入式推近变焦" },
  "crash-zoom-out":  { label: "急拉变焦",     description: "急促的甩出式拉远变焦" },

  // Dolly
  "dolly-in":   { label: "推轨",     description: "推动机位靠近被摄对象(带视差)" },
  "dolly-out":  { label: "拉轨",     description: "拉远机位远离被摄对象(带视差)" },
  "dolly-zoom": { label: "滑动变焦", description: "眩晕效果:推轨与变焦反向" },
  "push-in":    { label: "缓推",     description: "缓慢轻柔地推向被摄对象" },
  "pull-out":   { label: "缓拉",     description: "缓慢轻柔地拉远被摄对象" },

  // Truck
  "truck-left":  { label: "向左横移",   description: "机身横向向左滑移" },
  "truck-right": { label: "向右横移",   description: "机身横向向右滑移" },

  // Pedestal
  "pedestal-up":   { label: "升镜",   description: "机身垂直升高" },
  "pedestal-down": { label: "降镜",   description: "机身垂直下降" },

  // Roll
  "roll-left":   { label: "左滚动",   description: "镜头逆时针旋转" },
  "roll-right":  { label: "右滚动",   description: "镜头顺时针旋转" },
  "dutch-angle": { label: "荷兰角",   description: "营造紧张感的固定倾斜画面" },

  // Orbit / Arc
  "orbit-left":  { label: "向左环绕",   description: "镜头绕被摄对象向左完整环绕" },
  "orbit-right": { label: "向右环绕",   description: "镜头绕被摄对象向右完整环绕" },
  "arc-left":    { label: "左弧形运镜", description: "围绕被摄对象向左做局部弧线" },
  "arc-right":   { label: "右弧形运镜", description: "围绕被摄对象向右做局部弧线" },

  // Crane / Jib
  "crane-up":   { label: "升降臂上升", description: "用升降臂上升揭示场景" },
  "crane-down": { label: "升降臂下降", description: "用升降臂下降的扫摇" },
  "boom-up":    { label: "摇臂上升",   description: "摇臂抬升运动" },
  "boom-down":  { label: "摇臂下降",   description: "摇臂下降运动" },

  // Tracking
  "tracking-shot": { label: "跟拍镜头",     description: "镜头与移动主体并排跟随" },
  "follow":        { label: "跟随",         description: "从主体身后跟随" },
  "lead":          { label: "倒退引拍",     description: "在前进的主体前方退行拍摄" },
  "drone-follow":  { label: "无人机跟拍",   description: "高空无人机跟随主体" },
  "dolly-track":   { label: "并行轨道推移", description: "在主体旁的平行轨道上推移" },

  // Special
  "pov":              { label: "主观视角",         description: "第一人称视角" },
  "over-the-shoulder":{ label: "过肩",             description: "越过角色肩膀的取景" },
  "birds-eye":        { label: "鸟瞰",             description: "正上方俯视画面" },
  "worms-eye":        { label: "蠕虫视角",         description: "极低机位向上仰视" },
  "aerial":           { label: "航拍",             description: "高空无人机风格画面" },
  "helicopter":       { label: "直升机镜头",       description: "宽阔的高空横扫航拍" },
  "fly-over":         { label: "低空飞越",         description: "低空快速掠过场景的航拍" },
  "flythrough":       { label: "穿越镜头",         description: "镜头穿行穿越空间" },
  "reveal":           { label: "揭示镜头",         description: "逐步揭示更广阔的场景" },
  "snorricam":        { label: "Snorricam 体绑机", description: "体绑摄影机(主体锁定在画面中)" },
  "rack-focus":       { label: "变焦点",           description: "在前后景之间拉焦" },

  // Modern / social-video
  "handheld-vlog":  { label: "手持 Vlog",       description: "随性的 Vlog 风格手持" },
  "pov-walk":       { label: "主观行走",         description: "第一人称行走主观镜头" },
  "velocity-edit":  { label: "速度剪辑",         description: "TikTok 节奏的速率变化" },
  "match-cut-zoom": { label: "节拍变焦",         description: "卡点变焦用于剪辑" },
  "screen-tap":     { label: "点屏切换",         description: "屏幕上手指点击触发的转场" },
  "phone-flip":     { label: "翻面切换",         description: "前后摄像头翻转切换" },
}

export default map
