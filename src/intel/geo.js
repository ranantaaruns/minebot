'use strict'

const Vec3 = require('vec3')

const COMPASS = ['utara', 'timur laut', 'timur', 'tenggara', 'selatan', 'barat daya', 'barat', 'barat laut']

function horizontalDistance (a, b) {
  if (!a || !b) return Infinity
  return Math.hypot(a.x - b.x, a.z - b.z)
}

// 0 = utara (-z), 90 = timur (+x), 180 = selatan (+z), 270 = barat (-x)
function bearingDeg (from, to) {
  if (!from || !to) return null
  const deg = Math.atan2(to.x - from.x, -(to.z - from.z)) * 180 / Math.PI
  return (deg + 360) % 360
}

function compassPoint (bearing) {
  if (!Number.isFinite(bearing)) return '?'
  return COMPASS[Math.round(((bearing % 360) + 360) % 360 / 45) % 8]
}

function velocityFrom (samples, windowSize = 5) {
  const recent = (samples || []).slice(-Math.max(2, windowSize))
  if (recent.length < 2) return null
  const first = recent[0]
  const last = recent[recent.length - 1]
  const dt = (last.t - first.t) / 1000
  if (!(dt > 0)) return null
  return new Vec3((last.x - first.x) / dt, (last.y - first.y) / dt, (last.z - first.z) / dt)
}

// Dead reckoning: pakai kecepatan rata-rata jendela terakhir, batasi supaya
// lompatan teleport tidak menghasilkan prediksi 400 blok.
function predictPosition (samples, horizonMs, options = {}) {
  const list = samples || []
  const last = list[list.length - 1]
  if (!last) return null
  const velocity = velocityFrom(list, options.windowSize)
  if (!velocity) return { x: last.x, y: last.y, z: last.z, speed: 0, uncertainty: 0, aheadMs: 0 }
  const maxSpeed = Number(options.maxSpeed) || 12
  const speed = Math.hypot(velocity.x, velocity.z)
  const scale = speed > maxSpeed ? maxSpeed / speed : 1
  const horizonSec = Math.max(0, Number(horizonMs) || 0) / 1000
  return {
    x: last.x + velocity.x * scale * horizonSec,
    y: last.y + velocity.y * scale * horizonSec,
    z: last.z + velocity.z * scale * horizonSec,
    speed: speed * scale,
    uncertainty: Math.min(64, horizonSec * (2 + speed)),
    aheadMs: horizonMs
  }
}

function formatCoords (position) {
  if (!position) return '?'
  const round = value => (Number.isFinite(value) ? value.toFixed(1) : '?')
  return `${round(position.x)} ${round(position.y)} ${round(position.z)}`
}

module.exports = { horizontalDistance, bearingDeg, compassPoint, velocityFrom, predictPosition, formatCoords }
