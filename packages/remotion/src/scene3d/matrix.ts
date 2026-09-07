/**
 * Minimal column-major 4x4 matrix math for Scene3D.
 *
 * Deliberately dependency-free (no `three` import) so the sampler can run in
 * the browser preview, in node tests and inside numeric-editing UI without
 * pulling the render runtime. The element order and the Euler-XYZ construction
 * match `three.Matrix4` exactly — `scene-builder.test.ts` asserts that parity
 * against `Object3D.updateMatrixWorld()`, which is what makes preview and
 * export agree.
 */
import type { Vec3 } from "./types"

/** 16 numbers, column-major — same layout as `THREE.Matrix4.elements`. */
export type Mat4 = number[]

export function identityMat4(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
}

/**
 * Compose a TRS matrix. Rotation is intrinsic Euler XYZ in radians, i.e.
 * R = Rx · Ry · Rz — the same expansion `THREE.Matrix4.makeRotationFromEuler`
 * uses for order "XYZ".
 */
export function composeTRS(position: Vec3, rotation: Vec3, scale: Vec3): Mat4 {
  const [x, y, z] = rotation
  const a = Math.cos(x)
  const b = Math.sin(x)
  const c = Math.cos(y)
  const d = Math.sin(y)
  const e = Math.cos(z)
  const f = Math.sin(z)

  const ae = a * e
  const af = a * f
  const be = b * e
  const bf = b * f

  const te = identityMat4()

  te[0] = c * e
  te[4] = -c * f
  te[8] = d

  te[1] = af + be * d
  te[5] = ae - bf * d
  te[9] = -b * c

  te[2] = bf - ae * d
  te[6] = be + af * d
  te[10] = a * c

  // scale columns
  const [sx, sy, sz] = scale
  te[0] *= sx
  te[1] *= sx
  te[2] *= sx
  te[4] *= sy
  te[5] *= sy
  te[6] *= sy
  te[8] *= sz
  te[9] *= sz
  te[10] *= sz

  te[12] = position[0]
  te[13] = position[1]
  te[14] = position[2]

  return te
}

/** Column-major matrix product `a · b` (apply b first, then a). */
export function multiplyMat4(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16)
  for (let col = 0; col < 4; col++) {
    const b0 = b[col * 4]
    const b1 = b[col * 4 + 1]
    const b2 = b[col * 4 + 2]
    const b3 = b[col * 4 + 3]
    for (let row = 0; row < 4; row++) {
      out[col * 4 + row] =
        a[row] * b0 + a[4 + row] * b1 + a[8 + row] * b2 + a[12 + row] * b3
    }
  }
  return out
}

/** Translation column of a composed matrix. */
export function translationOf(m: Mat4): Vec3 {
  return [m[12], m[13], m[14]]
}
