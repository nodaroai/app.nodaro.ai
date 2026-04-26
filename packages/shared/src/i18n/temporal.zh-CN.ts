import type { LocaleCatalogMap } from "./types.js"

const map: LocaleCatalogMap = {
  // Speed
  "real-time":     { label: "实时",       description: "正常播放速度" },
  "slow-motion":   { label: "慢动作",     description: "中等程度的慢放镜头" },
  "super-slow-mo": { label: "超慢动作",   description: "极慢的镜头" },
  "time-lapse":    { label: "延时摄影",   description: "时间被压缩、快速流逝" },
  "hyper-lapse":   { label: "移动延时",   description: "带运动的延时摄影" },
  "speed-ramp":    { label: "速度变化",   description: "镜头中途的动态速度变化" },

  // Freeze
  "full-freeze":    { label: "全画面定格",     description: "画面所有运动定格" },
  "bullet-time":    { label: "子弹时间",       description: "主体定格、镜头环绕" },
  "frozen-subject": { label: "主体定格",       description: "主体不动、世界仍在运动" },
  "moving-subject": { label: "动态主体",       description: "主体在动、世界静止" },

  // Direction
  "forward":        { label: "正向",       description: "正常正向播放" },
  "reverse":        { label: "倒放 / 倒带", description: "时间倒着走" },
  "loop-boomerang": { label: "回环 / 回旋", description: "正放后倒放" },

  // Shutter
  "long-exposure": { label: "长曝光",     description: "运动拉丝、光轨" },
  "crisp-shutter": { label: "高速快门",   description: "锐利运动、无模糊" },
  "motion-blur":   { label: "运动模糊",   description: "明显的方向性运动模糊" },
  "stutter-strobe":{ label: "卡帧 / 频闪", description: "频闪般卡顿的运动" },
  "stop-motion":   { label: "定格动画",   description: "逐帧步进的运动" },
}

export default map
