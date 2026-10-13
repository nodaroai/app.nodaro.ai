import * as THREE from "three"
import { deskShape } from "../floor-layout"
import type { LinkType } from "../map-model"
import { BROWSER_TAB, CABLE, SINGLE_HOODIES, type Assets, type Theme } from "./world-assets"

/**
 * The pieces of the floor: a person on a chair, a screen, a cluster's curved
 * desk with its link props and cables, and a single desk.
 */

/** Facing: the desks open toward the default camera. */
export const UP = new THREE.Vector3(0, 1, 0)
export const FACING = new THREE.Vector3(-1, 0, -1).normalize()

export type Pick = { readonly type: "cluster"; readonly key: string } | { readonly type: "account"; readonly id: string }

export interface Monitor {
  readonly g: THREE.Group
  readonly screenMat: THREE.MeshBasicMaterial
  readonly prog: THREE.Mesh
  readonly progBg: THREE.Mesh
  readonly progMat: THREE.MeshBasicMaterial
  /** The heading the cluster's person turns to when this screen generates. */
  angle: number
  act: string
  state: string
  dim: number
  boot: number
  progress: number
  /** The pulsing ring over a screen that just signed up; made on first need. */
  beacon: THREE.Sprite | null
  /** 1 = signed up this instant, fading to 0 over the fresh window. */
  fresh: number
}

export interface ClusterNode {
  readonly group: THREE.Group
  readonly person: THREE.Group
  readonly body: readonly THREE.Mesh[]
  readonly baseAngle: number
  readonly ids: readonly string[]
  readonly r: number
  readonly glowMat: THREE.MeshBasicMaterial
  readonly rugMat: THREE.MeshStandardMaterial
  readonly cables: Partial<Record<LinkType, THREE.LineBasicMaterial>>
  readonly led: THREE.Mesh | null
  readonly labelPos: THREE.Vector3
  readonly focus: THREE.Vector3
  readonly seed: number
}

export interface SingleNode {
  readonly g: THREE.Group
  readonly body: readonly THREE.Mesh[]
  born: number
}

export interface Builder {
  readonly assets: Assets
  readonly scene: THREE.Scene
  readonly pickables: THREE.Object3D[]
  readonly theme: () => Theme
}

function mesh(geo: THREE.BufferGeometry, m: THREE.Material | THREE.Material[], parent: THREE.Object3D, x = 0, y = 0, z = 0, shadow = true): THREE.Mesh {
  const me = new THREE.Mesh(geo, m)
  me.position.set(x, y, z)
  me.castShadow = shadow
  me.receiveShadow = true
  parent.add(me)
  return me
}

function pickable(b: Builder, o: THREE.Object3D, pick: Pick) {
  o.userData = { pick }
  b.pickables.push(o)
}

function person(b: Builder, parent: THREE.Object3D, hood?: number): { g: THREE.Group; body: THREE.Mesh[] } {
  const { geo, mats, mat } = b.assets
  const g = new THREE.Group()
  parent.add(g)
  mesh(geo.chairBase, mats.chair, g, 0, 0.04, 0)
  mesh(geo.chairPole, mats.chair, g, 0, 0.35, 0)
  mesh(geo.seat, mats.chair, g, 0, 0.72, 0)
  mesh(geo.back, mats.chair, g, 0, 1.3, -0.45)
  const torso = mesh(geo.torso, hood === undefined ? mats.hood : mat(hood), g, 0, 1.35, -0.05)
  const head = mesh(geo.head, mats.hair, g, 0, 2.02, -0.05)
  return { g, body: [torso, head] }
}

function monitor(b: Builder, parent: THREE.Object3D, browserTab: boolean, pick: Pick): Monitor {
  const { geo, mats, screens } = b.assets
  const g = new THREE.Group()
  parent.add(g)
  const bezel = mesh(geo.bezel, mats.bezel, g)
  const screenMat = new THREE.MeshBasicMaterial({ map: screens.withheld, transparent: true, toneMapped: false })
  const screen = mesh(geo.screen, screenMat, g, 0, 0, 0.045, false)
  if (browserTab) mesh(geo.tab, new THREE.MeshBasicMaterial({ color: BROWSER_TAB, toneMapped: false }), g, 0, 0.37, 0.047, false)
  const progBg = mesh(geo.progBg, mats.progBg, g, 0, -0.32, 0.05, false)
  const progMat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false })
  const prog = mesh(geo.prog, progMat, g, -0.6, -0.32, 0.052, false)
  progBg.visible = prog.visible = false
  pickable(b, bezel, pick)
  pickable(b, screen, pick)
  return { g, screenMat, prog, progBg, progMat, angle: 0, act: "offline", state: "withheld", dim: 1, boot: 0, progress: Math.random(), beacon: null, fresh: 0 }
}

export interface ClusterSpec {
  readonly key: string
  readonly hue: string
  readonly links: readonly LinkType[]
  readonly x: number
  readonly z: number
  readonly members: ReadonlyArray<{ readonly id: string; readonly fired: readonly LinkType[] }>
}

export function buildCluster(b: Builder, spec: ClusterSpec, monitors: Map<string, Monitor>, isNew: (id: string) => boolean): ClusterNode {
  const { geo, mats } = b.assets
  const theme = b.theme()
  const n = spec.members.length
  const { per, rows, r } = deskShape(n)
  const hue = new THREE.Color(spec.hue)
  const group = new THREE.Group()
  // The layout gives the rug's centre; the desk arc sits behind it.
  const rugOffset = FACING.clone().multiplyScalar(r * 0.42)
  group.position.set(spec.x - rugOffset.x, 0.3, spec.z - rugOffset.z)
  b.scene.add(group)
  const clusterPick: Pick = { type: "cluster", key: spec.key }

  const rugMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(theme.rug).lerp(hue, theme.mix), roughness: 1, envMapIntensity: theme.env })
  const rug = mesh(new THREE.CircleGeometry(r + 1.3, 64), rugMat, group, rugOffset.x, 0.02, rugOffset.z, false)
  rug.rotation.x = -Math.PI / 2
  pickable(b, rug, clusterPick)
  const edge = mesh(new THREE.RingGeometry(r + 1.22, r + 1.32, 72), new THREE.MeshBasicMaterial({ color: hue, transparent: true, opacity: 0.55 }), group, rugOffset.x, 0.03, rugOffset.z, false)
  edge.rotation.x = -Math.PI / 2
  const glowMat = new THREE.MeshBasicMaterial({ color: hue, transparent: true, opacity: 0 })
  const glow = mesh(new THREE.RingGeometry(r + 1.4, r + 2.3, 72), glowMat, group, rugOffset.x, 0.025, rugOffset.z, false)
  glow.rotation.x = -Math.PI / 2

  const browserTab = spec.links.includes("browser")
  const ids: string[] = []
  const screenPos = new Map<string, THREE.Vector3>()
  for (let j = 0; j < per; j++) {
    const phi = (j - (per - 1) / 2) * (1.78 / r)
    const dir = FACING.clone().applyAxisAngle(UP, phi)
    const p = dir.clone().multiplyScalar(r)
    const rotY = Math.atan2(-p.x, -p.z)
    const desk = mesh(geo.desk, mats.desk, group, p.x - dir.x * 0.25, 0.5, p.z - dir.z * 0.25)
    desk.rotation.y = rotY
    pickable(b, desk, clusterPick)
    const colRows = Math.min(rows, Math.ceil((n - j) / per))
    if (colRows > 1) {
      const pole = mesh(geo.pole, mats.stand, group, p.x + dir.x * 0.12, 0.5 + colRows * 0.55, p.z + dir.z * 0.12)
      pole.scale.y = colRows * 1.1 + 0.2
    }
    for (let k = 0; k < rows; k++) {
      const a = spec.members[k * per + j]
      if (!a) continue
      const m = monitor(b, group, browserTab, { type: "account", id: a.id })
      m.g.position.set(p.x, 1.62 + k * 1.1, p.z)
      m.g.rotation.y = rotY
      if (k === 0) mesh(geo.stand, mats.stand, group, p.x, 1.12, p.z).rotation.y = rotY
      if (isNew(a.id)) m.boot = 1.4
      m.angle = Math.atan2(p.x - FACING.x * 0.6, p.z - FACING.z * 0.6)
      monitors.set(a.id, m)
      ids.push(a.id)
      screenPos.set(a.id, new THREE.Vector3(p.x, 1.62 + k * 1.1 - 0.5, p.z))
    }
  }

  const who = person(b, group)
  who.g.scale.setScalar(1.15)
  who.g.rotation.y = Math.atan2(FACING.x, FACING.z)
  who.g.position.copy(FACING.clone().multiplyScalar(0.6))
  who.g.children.forEach((o) => pickable(b, o, clusterPick))

  // One prop per link that joined the cluster, with a cable to each screen that shares it.
  const side = FACING.clone().applyAxisAngle(UP, -Math.PI / 2)
  const props: Partial<Record<LinkType, THREE.Vector3>> = {}
  let led: THREE.Mesh | null = null
  if (spec.links.includes("device")) {
    const p = side.clone().multiplyScalar(1.5).add(FACING.clone().multiplyScalar(0.9))
    mesh(geo.tower, mats.tower, group, p.x, 0.58, p.z).rotation.y = Math.atan2(FACING.x, FACING.z)
    mesh(geo.led, mats.blueLed, group, p.x - FACING.x * 0.53, 0.95, p.z - FACING.z * 0.53, false)
    props.device = new THREE.Vector3(p.x, 0.6, p.z)
  }
  if (spec.links.includes("network")) {
    const p = side.clone().multiplyScalar(-1.7).add(FACING.clone().multiplyScalar(0.9))
    mesh(geo.router, mats.router, group, p.x, 1.25, p.z)
    mesh(geo.routerStand, mats.deskTop, group, p.x, 0.6, p.z)
    for (const i of [-1, 0, 1]) mesh(geo.antenna, mats.antenna, group, p.x + side.x * i * 0.3, 1.65, p.z + side.z * i * 0.3)
    led = mesh(geo.led, mats.greenLed, group, p.x - FACING.x * 0.31, 1.27, p.z - FACING.z * 0.31, false)
    props.network = new THREE.Vector3(p.x, 1.25, p.z)
  }
  const cables: Partial<Record<LinkType, THREE.LineBasicMaterial>> = {}
  for (const type of ["device", "network"] as const) {
    const from = props[type]
    if (!from) continue
    const pts: THREE.Vector3[] = []
    for (const a of spec.members) {
      const to = screenPos.get(a.id)
      if (!to || !a.fired.includes(type)) continue
      const mid = from.clone().lerp(to, 0.5)
      mid.y = Math.max(from.y, to.y) + 0.8
      const cp = new THREE.QuadraticBezierCurve3(from, mid, to).getPoints(14)
      for (let i = 0; i < cp.length - 1; i++) pts.push(cp[i]!, cp[i + 1]!)
    }
    const lineMat = new THREE.LineBasicMaterial({ color: CABLE[type], transparent: true, opacity: 0, depthWrite: false })
    group.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(pts), lineMat))
    cables[type] = lineMat
  }
  group.traverse((o) => {
    const m = (o as THREE.Mesh).material
    if (m instanceof THREE.MeshStandardMaterial) m.envMapIntensity = theme.env
  })
  const top = 1.62 + (rows - 1) * 1.1 + 1.0
  const center = group.position.clone()
  return {
    group,
    person: who.g,
    body: who.body,
    baseAngle: Math.atan2(FACING.x, FACING.z),
    ids,
    r,
    glowMat,
    rugMat,
    cables,
    led,
    labelPos: center.clone().add(FACING.clone().multiplyScalar(r * 0.8)).setY(top + 0.6),
    focus: center.clone().add(rugOffset).setY(0),
    seed: n,
  }
}

export function buildSingle(b: Builder, id: string, i: number, at: { x: number; z: number }, monitors: Map<string, Monitor>, isNew: boolean): SingleNode {
  const { geo, mats } = b.assets
  const g = new THREE.Group()
  g.position.set(at.x, 0.3, at.z)
  b.scene.add(g)
  const p = FACING.clone().multiplyScalar(1.3)
  const rotY = Math.atan2(-p.x, -p.z)
  mesh(geo.desk, mats.desk, g, p.x - FACING.x * 0.25, 0.5, p.z - FACING.z * 0.25).rotation.y = rotY
  const pick: Pick = { type: "account", id }
  const m = monitor(b, g, false, pick)
  m.g.position.set(p.x, 1.62, p.z)
  m.g.rotation.y = rotY
  mesh(geo.stand, mats.stand, g, p.x, 1.12, p.z).rotation.y = rotY
  const who = person(b, g, SINGLE_HOODIES[i % SINGLE_HOODIES.length])
  who.g.rotation.y = Math.atan2(FACING.x, FACING.z)
  who.g.position.copy(FACING.clone().multiplyScalar(-0.3))
  g.traverse((o) => {
    if ((o as THREE.Mesh).isMesh && !o.userData.pick) pickable(b, o, pick)
  })
  monitors.set(id, m)
  if (isNew) {
    g.scale.setScalar(0.01)
    m.boot = 1.4
  }
  return { g, body: who.body, born: isNew ? 0 : 1 }
}

/** Removes a built group and forgets its pickables; per-group geometry and materials are disposed. */
export function removeGroup(b: Builder, group: THREE.Group, shared: ReadonlySet<THREE.BufferGeometry | THREE.Material>) {
  b.scene.remove(group)
  group.traverse((o) => {
    const i = b.pickables.indexOf(o)
    if (i >= 0) b.pickables.splice(i, 1)
    const me = o as THREE.Mesh
    // A sprite's geometry is three.js's own, shared by every sprite: never disposed here.
    if (me.geometry && !shared.has(me.geometry) && !(o as THREE.Sprite).isSprite) me.geometry.dispose()
    const mats = Array.isArray(me.material) ? me.material : me.material ? [me.material] : []
    for (const m of mats) if (!shared.has(m)) m.dispose()
  })
}
