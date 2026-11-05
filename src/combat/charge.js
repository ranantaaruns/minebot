'use strict'

const Vec3 = require('vec3')

// Sudut elevasi setelah hit terdaftar: -15° (mendongak) supaya tetap
// melayang dan keluar dari jangkauan balasan.
const POST_HIT_PITCH = -15

// Spear punya deadzone mutlak < 2.0 blok (damage nol + kinetic collision
// ke bot sendiri) dan jangkauan maksimum 4.5 blok.
const DEADZONE = 2.0
const MAX_RANGE = 4.5

function clamp (v, lo, hi) {
  return Math.min(hi, Math.max(lo, v))
}

// Vektor horizontal tegak lurus terhadap arah lintasan (untuk offset radial).
function horizontalPerp (dir) {
  const flat = new Vec3(dir.x, 0, dir.z)
  if (flat.norm() < 1e-6) return new Vec3(1, 0, 0)
  const n = flat.normalize()
  return new Vec3(-n.z, 0, n.x)
}

// Jarak terdekat dari lintasan lurus (origin + t*dir) ke sebuah titik.
function closestApproach (origin, dir, point) {
  const rel = point.minus(origin)
  const t = Math.max(0, rel.dot(dir))
  const closest = origin.plus(dir.scaled(t))
  return { t, distance: closest.distanceTo(point), point: closest }
}

// Waktu tempuh (tick) sampai bertemu target yang bergerak.
// Selesaikan |d + v t| = s t  →  (v²-s²)t² + 2(d·v)t + d² = 0.
function timeToIntercept ({ from, point, velocity, speed }) {
  const d = point.minus(from)
  const v = velocity || new Vec3(0, 0, 0)
  const s = Math.max(0.2, Number(speed) || 1.8)
  const a = v.dot(v) - s * s
  const b = 2 * d.dot(v)
  const c = d.dot(d)
  const fallback = Math.sqrt(c) / s
  if (Math.abs(a) < 1e-6) {
    if (Math.abs(b) < 1e-6) return { ticks: fallback, ok: true, reason: 'ok' }
    const t = -c / b
    return { ticks: t > 0 ? t : 0, ok: t > 0, reason: t > 0 ? 'ok' : 'behind' }
  }
  const disc = b * b - 4 * a * c
  if (disc < 0) return { ticks: fallback, ok: false, reason: 'no-intercept' }
  const sq = Math.sqrt(disc)
  const roots = [(-b - sq) / (2 * a), (-b + sq) / (2 * a)].filter(t => t > 0).sort((x, y) => x - y)
  if (!roots.length) return { ticks: fallback, ok: false, reason: 'behind' }
  return { ticks: roots[0], ok: true, reason: 'ok' }
}

// Hitung titik bidik yang melewati SAMPING target pada jarak 2.2..3.8 blok,
// bukan menabrak pusat (yang masuk deadzone).
function tangentialIntercept (options = {}) {
  const {
    self, target,
    speed = 1.8,
    lateralMin = 2.5,
    lateralMax = 3.2,
    deadzone = DEADZONE,
    maxRange = MAX_RANGE,
    horizonTicks = 12,
    side = 1
  } = options

  const from = self.position
  const velocity = target.velocity || new Vec3(0, 0, 0)
  const timing = timeToIntercept({ from, point: target.position, velocity, speed })
  const ticks = clamp(timing.ticks, 0.5, horizonTicks)
  const intercept = target.position.plus(velocity.scaled(ticks))

  const toIntercept = intercept.minus(from)
  const dir = toIntercept.norm() < 1e-6 ? new Vec3(0, 0, 1) : toIntercept.normalize()
  const perp = horizontalPerp(dir)

  const lo = deadzone + 0.2
  const hi = maxRange - 0.7
  const mid = (lateralMin + lateralMax) / 2
  const pref = side < 0 ? -1 : 1
  const offsets = [
    lateralMax * pref, -lateralMax * pref,
    mid * pref, -mid * pref,
    lateralMin * pref, -lateralMin * pref
  ]

  let best = null
  for (const off of offsets) {
    const aim = intercept.plus(perp.scaled(off))
    const delta = aim.minus(from)
    if (delta.norm() < 1e-6) continue
    const aimDir = delta.normalize()
    const ca = closestApproach(from, aimDir, target.position)
    const entry = { point: aim, lateral: off, closest: ca.distance, dir: aimDir, ticks }
    if (ca.distance >= lo && ca.distance <= hi) return { ...entry, ok: true, reason: 'ok', timing }
    if (!best || Math.abs(ca.distance - (lo + hi) / 2) < Math.abs(best.closest - (lo + hi) / 2)) best = entry
  }

  if (!best) {
    return { point: intercept, lateral: 0, closest: 0, dir, ticks, ok: false, reason: 'no-candidate', timing }
  }
  return { ...best, ok: false, reason: 'deadzone', timing }
}

module.exports = {
  POST_HIT_PITCH,
  DEADZONE,
  MAX_RANGE,
  clamp,
  horizontalPerp,
  closestApproach,
  timeToIntercept,
  tangentialIntercept
}
