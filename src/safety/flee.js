'use strict'

const Vec3 = require('vec3')
const { sleep } = require('../util/async')

const HAZARDS = new Set(['lava', 'flowing_lava', 'fire', 'soul_fire', 'cactus', 'magma_block', 'powder_snow'])
const SOLID_BOXES = new Set(['block'])

function bareName (block) {
  return String(block?.name || '').replace(/^minecraft:/, '').toLowerCase()
}

function isHazard (block) {
  return Boolean(block) && HAZARDS.has(bareName(block))
}

function isSolid (block) {
  return Boolean(block) && SOLID_BOXES.has(block.boundingBox)
}

function rotate (x, z, degrees) {
  const rad = (Number(degrees) || 0) * Math.PI / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return { x: x * cos - z * sin, z: x * sin + z * cos }
}

// Arah menjauh dari target (horizontal), lalu diputar `offsetDeg` untuk zigzag.
function awayDirection (bot, entity, offsetDeg = 0) {
  const me = bot?.entity?.position
  const target = entity?.position
  let dx = me && target ? me.x - target.x : 0
  let dz = me && target ? me.z - target.z : 0
  let length = Math.hypot(dx, dz)
  if (length < 0.01) {
    // Target persis di posisi bot: pilih arah tetap supaya tetap bergerak.
    dx = 1
    dz = 0
    length = 1
  }
  const rotated = rotate(dx / length, dz / length, offsetDeg)
  return { x: rotated.x, z: rotated.z }
}

function headingPoint (bot, direction, distance = 3) {
  const me = bot.entity.position
  return new Vec3(me.x + direction.x * distance, me.y, me.z + direction.z * distance)
}

// Blok di depan harus bisa dilewati: bukan lava/api, bukan dinding.
function pathClear (bot, direction, steps = 3) {
  const me = bot.entity.position
  for (let step = 1; step <= steps; step++) {
    for (const dy of [0, 1]) {
      const block = bot.blockAt?.(new Vec3(
        Math.floor(me.x + direction.x * step),
        Math.floor(me.y) + dy,
        Math.floor(me.z + direction.z * step)
      ))
      if (!block) continue
      if (isHazard(block)) return false
      if (dy === 0 && isSolid(block)) return false
    }
  }
  return true
}

const DETOUR_OFFSETS = [0, 45, -45, 90, -90, 135, -135, 180]

// Pilih arah lari yang tidak menabrak dinding atau berlari ke lava.
function safeDirection (bot, entity, baseOffsetDeg) {
  for (const extra of DETOUR_OFFSETS) {
    const direction = awayDirection(bot, entity, baseOffsetDeg + extra)
    if (pathClear(bot, direction)) return direction
  }
  return awayDirection(bot, entity, baseOffsetDeg)
}

function stopMoving (bot) {
  for (const control of ['forward', 'back', 'left', 'right', 'sprint', 'jump']) {
    try { bot.setControlState?.(control, false) } catch {}
  }
  try { bot.clearControlStates?.() } catch {}
}

function horizontalDistance (a, b) {
  if (!a || !b) return 0
  return Math.hypot(a.x - b.x, a.z - b.z)
}

// Lari menjauh dari target sambil berbelok-belok (zigzag) supaya serangan lawan
// lebih sering meleset. Tidak memakai pathfinder: cukup kontrol gerak, jadi tidak
// bisa gagal dengan "Path was stopped".
async function fleeFrom (bot, entity, options = {}) {
  const {
    cancellation,
    logger,
    tickMs = 200,
    durationMs = 15000,
    distance = 12,
    zigzagDeg = 35,
    zigzagMs = 400,
    sprintMinFood = 6,
    sprint = true,
    stopWhen = null,
    onTick = null
  } = options

  const startedAt = Date.now()
  const deadline = startedAt + Math.max(250, Number(durationMs) || 15000)
  let sign = 1
  let nextZigAt = 0
  let lastPosition = null
  let ticks = 0
  let travelled = 0

  stopMoving(bot)
  try {
    while (true) {
      cancellation?.throwIfCancelled?.()
      if (!entity?.position || !bot?.entity?.position) break
      if (stopWhen?.()) break

      const now = Date.now()
      if (now >= deadline) break

      if (now >= nextZigAt) {
        sign = -sign
        nextZigAt = now + Math.max(50, Number(zigzagMs) || 400)
      }

      const direction = safeDirection(bot, entity, sign * (Number(zigzagDeg) || 0))
      try {
        await bot.lookAt?.(headingPoint(bot, direction), true)
      } catch {}

      const moved = lastPosition ? horizontalDistance(lastPosition, bot.entity.position) : Infinity
      const blocked = moved < 0.02
      lastPosition = { x: bot.entity.position.x, y: bot.entity.position.y, z: bot.entity.position.z }

      // Sprint membatalkan makan di Java, jadi pemanggil bisa mematikannya
      // sementara (mis. saat sedang memakan makanan untuk heal).
      const wantSprint = typeof sprint === 'function' ? Boolean(sprint()) : Boolean(sprint)

      try {
        bot.setControlState?.('forward', true)
        bot.setControlState?.('sprint', wantSprint && Number(bot.food ?? 20) >= Number(sprintMinFood))
        bot.setControlState?.('jump', Boolean(blocked && ticks > 1))
      } catch (err) {
        logger?.debug?.(`Gagal mengatur gerakan lari: ${err.message}`)
      }

      if (typeof onTick === 'function') {
        try { onTick({ distance: bot.entity.position.distanceTo(entity.position), ticks }) } catch (err) {
          logger?.debug?.(`Aksi saat lari gagal: ${err.message}`)
        }
      }

      ticks++
      travelled += Number.isFinite(moved) ? moved : 0
      await sleep(Math.max(1, Number(tickMs) || 200), cancellation)
    }
  } finally {
    stopMoving(bot)
  }

  return {
    ticks,
    travelled,
    durationMs: Date.now() - startedAt,
    distance: entity?.position ? bot.entity.position.distanceTo(entity.position) : null,
    reachedSafe: Number(distance) > 0 && entity?.position
      ? bot.entity.position.distanceTo(entity.position) >= Number(distance)
      : false
  }
}

module.exports = {
  fleeFrom,
  awayDirection,
  safeDirection,
  pathClear,
  stopMoving,
  isHazard,
  HAZARDS
}
