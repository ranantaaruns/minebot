'use strict'

const { goals } = require('mineflayer-pathfinder')
const { withTimeout } = require('../util/async')

const AIR_NAMES = new Set(['air', 'cave_air', 'void_air'])

function nameOf (block) {
  return String(block?.name || '').replace(/^minecraft:/, '').toLowerCase()
}

function isAir (block) {
  if (!block) return false
  if (AIR_NAMES.has(nameOf(block))) return true
  return block.boundingBox === 'empty' && !block.liquid
}

function isFloor (block) {
  if (!block) return false
  return block.boundingBox === 'block' || block.diggable === true
}

// Cave atau lorong buatan: ruang kosong dengan lantai padat dan langit-langit,
// bukan lubang 1-2 blok sisa tambang sebelumnya.
function isCaveCell (bot, pos, options = {}) {
  const { minAir = 3, minHeadroom = 2 } = options
  if (!bot?.blockAt || !pos) return false

  const feet = bot.blockAt(pos)
  if (!isAir(feet)) return false
  for (let dy = 1; dy <= minHeadroom; dy++) {
    if (!isAir(bot.blockAt(pos.offset(0, dy, 0)))) return false
  }
  if (!isFloor(bot.blockAt(pos.offset(0, -1, 0)))) return false

  let air = 0
  for (let dx = -1; dx <= 1; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -1; dz <= 1; dz++) {
        if (isAir(bot.blockAt(pos.offset(dx, dy, dz)))) air++
      }
    }
  }
  return air >= minAir
}

function findCaves (bot, options = {}) {
  const {
    radius = 48,
    count = 24,
    minAir = 6,
    maxDrop = 30,
    maxRise = 6
  } = options
  if (!bot?.findBlocks || !bot?.entity?.position) return []

  const origin = bot.entity.position
  let candidates = []
  try {
    const airIds = ['air', 'cave_air']
      .map(name => bot.registry?.blocksByName?.[name]?.id)
      .filter(id => id !== undefined)
    const matching = airIds.length > 0 ? airIds : undefined
    candidates = bot.findBlocks({ matching, maxDistance: radius, count })
  } catch {
    return []
  }

  const seen = new Set()
  const caves = []
  for (const pos of candidates) {
    const dy = pos.y - origin.y
    if (dy > maxRise || dy < -maxDrop) continue
    const key = `${pos.x},${pos.y},${pos.z}`
    if (seen.has(key)) continue
    if (!isCaveCell(bot, pos, { minAir })) continue
    seen.add(key)
    caves.push({ position: pos, distance: pos.distanceTo(origin), air: minAir })
  }

  caves.sort((a, b) => a.distance - b.distance)
  return caves
}

async function goToCave (bot, options = {}) {
  const {
    logger,
    cancellation,
    radius = 48,
    timeoutMs = 60000,
    maxCandidates = 3,
    goalRadius = 2
  } = options
  const caves = findCaves(bot, options)
  if (caves.length === 0) {
    logger?.debug?.('Tidak ada cave/lorong terdekat untuk dituju, lanjut tambang biasa')
    return null
  }

  for (const cave of caves.slice(0, maxCandidates)) {
    cancellation?.throwIfCancelled()
    const { x, y, z } = cave.position
    logger?.info?.(`Menuju cave terdekat (${x}, ${y}, ${z}) untuk menambang`)
    try {
      await withTimeout(
        bot.pathfinder.goto(new goals.GoalNear(x, y, z, goalRadius)),
        timeoutMs,
        'Menuju cave timeout'
      )
      logger?.info?.('Tiba di cave, mulai menambang dari sini')
      return cave.position
    } catch (err) {
      logger?.debug?.(`Cave di (${x}, ${y}, ${z}) tidak terjangkau: ${err.message}`)
    }
  }

  logger?.debug?.('Semua kandidat cave tidak terjangkau, lanjut tambang biasa')
  return null
}

module.exports = { findCaves, isCaveCell, goToCave, AIR_NAMES }
