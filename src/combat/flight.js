'use strict'

const Vec3 = require('vec3')

const NON_SOLID = new Set(['air', 'cave_air', 'void_air', 'water', 'flowing_water', 'lava', 'flowing_lava', 'bubble_column'])

function isSolidBlock (block) {
  if (!block) return false
  const name = String(block.name || '').replace(/^minecraft:/, '')
  if (NON_SOLID.has(name)) return false
  // block.boundingBox tersedia di mineflayer; 'empty' berarti bisa dilewati.
  if (block.boundingBox === 'empty') return false
  return name.length > 0
}

function horizontalSpeed (entity) {
  return Math.hypot(entity?.velocity?.x || 0, entity?.velocity?.z || 0)
}

function relativeSpeed (self, target) {
  const dx = (self?.velocity?.x || 0) - (target?.velocity?.x || 0)
  const dz = (self?.velocity?.z || 0) - (target?.velocity?.z || 0)
  return Math.hypot(dx, dz)
}

// Titik mundur untuk mengumpulkan kecepatan: di belakang bot dilihat dari
// target, sedikit lebih tinggi supaya menukik saat charge.
function runupPoint (selfPosition, targetPosition, distance = 12, altitude = 4) {
  const away = new Vec3(selfPosition.x - targetPosition.x, 0, selfPosition.z - targetPosition.z)
  if (away.norm() < 1e-6) away.x = 1
  const unit = away.normalize()
  const currentDistance = Math.hypot(selfPosition.x - targetPosition.x, selfPosition.z - targetPosition.z)
  const y = Math.max(selfPosition.y, targetPosition.y) + altitude
  const reach = currentDistance + distance
  return new Vec3(targetPosition.x + unit.x * reach, y, targetPosition.z + unit.z * reach)
}

// Cicip blok pada ketinggian kaki dan kepala sepanjang arah terbang 3D.
// Komponen Y ikut dipakai supaya menukik ke lantai atau naik ke atap terdeteksi.
function scanAhead (bot, direction, maxDistance = 6, step = 0.75) {
  const position = bot?.entity?.position
  if (!position || typeof bot.blockAt !== 'function') return { clear: true, distance: Infinity, block: null }
  const vector = new Vec3(direction.x, direction.y, direction.z)
  if (vector.norm() < 1e-6) return { clear: true, distance: Infinity, block: null }
  const dir = vector.normalize()
  for (let d = step; d <= maxDistance; d += step) {
    for (const dy of [0.2, 1.4]) {
      const point = position.offset(dir.x * d, dir.y * d + dy, dir.z * d)
      let block = null
      try { block = bot.blockAt(point) } catch {}
      if (isSolidBlock(block)) return { clear: false, distance: d, block, offsetY: dy }
    }
  }
  return { clear: true, distance: Infinity, block: null }
}

// Jangan terus menatap target kalau ada tembok di antaranya: naik dulu sambil
// tetap maju. Semakin dekat halangan, semakin tajam sudut mendakinya.
function avoidancePoint (bot, desiredPoint, options = {}) {
  const position = bot?.entity?.position
  if (!position || !desiredPoint || options.enabled === false) {
    return { point: desiredPoint, avoided: false, distance: Infinity }
  }
  const delta = desiredPoint.minus(position)
  const scan = scanAhead(bot, delta, Number(options.distance) || 6)
  if (!scan.clear) {
    const flat = new Vec3(delta.x, 0, delta.z)
    if (flat.norm() < 1e-6) flat.x = 1
    const dir = flat.normalize()
    // Halangan di kepala (atap) dihindari turun; lantai/tembok dihindari naik.
    const climb = scan.offsetY > 1 ? -3 : (scan.distance < 2 ? 6 : 4)
    return {
      point: position.offset(dir.x * 2, climb, dir.z * 2),
      avoided: true,
      distance: scan.distance
    }
  }
  return { point: desiredPoint, avoided: false, distance: Infinity }
}

function shouldStrike (options = {}) {
  const {
    distance = Infinity, speed = 0, minSpeed = 0.9,
    minRange = 2, maxRange = 4.5
  } = options
  return distance >= minRange && distance <= maxRange && speed >= minSpeed
}

module.exports = { horizontalSpeed, relativeSpeed, runupPoint, scanAhead, avoidancePoint, shouldStrike, isSolidBlock }
