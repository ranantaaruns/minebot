'use strict'

const { goals } = require('mineflayer-pathfinder')
const { withTimeout } = require('../util/async')

const DEFAULT_DIG_TIMEOUT_MS = 15000
const DEFAULT_WALK_TIMEOUT_MS = 8000
const REACH = 4.3

function eyePosition (bot) {
  const pos = bot?.entity?.position
  if (!pos) return null
  return pos.offset(0, 1.62, 0)
}

function blockDistance (bot, block) {
  const eye = eyePosition(bot)
  const target = block?.position
  if (!eye || !target) return Infinity
  return eye.distanceTo(target.offset(0.5, 0.5, 0.5))
}

// Blok dalam jangkauan tangan: bisa langsung dihancurkan tanpa jalan dulu.
function inReach (bot, block, reach = REACH) {
  return blockDistance(bot, block) <= reach
}

const STAND_OFFSETS = [
  [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1],
  [1, 0, 1], [1, 0, -1], [-1, 0, 1], [-1, 0, -1],
  [1, 1, 0], [-1, 1, 0], [0, 1, 1], [0, 1, -1],
  [1, 1, 1], [1, 1, -1], [-1, 1, 1], [-1, 1, -1],
  [1, -1, 0], [-1, -1, 0], [0, -1, 1], [0, -1, -1]
]

function isPassableBlock (block) {
  if (!block) return true
  const name = String(block.name || '').replace(/^minecraft:/, '')
  if (['air', 'cave_air', 'void_air', 'water', 'short_grass', 'tall_grass', 'grass', 'fern', 'snow'].includes(name)) return true
  return block.boundingBox === 'empty'
}

// Posisi berdiri di sekitar blok target yang benar-benar bisa dipijak dan dari
// mana blok itu masih dalam jangkauan tangan. Ini yang membuat penambangan
// kayu tidak lagi gagal "unreachable" pada trunk yang dikelilingi blok padat.
function standCandidates (bot, block, options = {}) {
  const reach = Number(options.reach) || REACH
  const eyeHeight = Number(options.eyeHeight) || 1.62
  if (typeof bot?.blockAt !== 'function' || !block?.position) return []

  const target = block.position.offset(0.5, 0.5, 0.5)
  const out = []
  for (const [dx, dy, dz] of STAND_OFFSETS) {
    const feet = block.position.offset(dx, dy, dz)
    if (!isPassableBlock(bot.blockAt(feet))) continue
    if (!isPassableBlock(bot.blockAt(feet.offset(0, 1, 0)))) continue
    const ground = bot.blockAt(feet.offset(0, -1, 0))
    if (!ground || ground.boundingBox !== 'block') continue
    const eye = feet.offset(0, eyeHeight, 0)
    const distance = eye.distanceTo(target)
    if (distance > reach) continue
    out.push({ position: feet, distance })
  }

  return out.sort((a, b) => a.distance - b.distance).map(candidate => candidate.position)
}

async function equipToolFor (bot, block, logger) {
  if (typeof bot?.tool?.equipForBlock !== 'function') return false
  try {
    await withTimeout(bot.tool.equipForBlock(block, {}, false), 3000, 'Equip tool timeout')
    return true
  } catch (err) {
    logger?.debug?.(`Gagal memilih tool untuk ${block?.name || 'blok'}: ${err.message}`)
    return false
  }
}

async function digBlock (bot, block, options = {}) {
  const { logger, digTimeoutMs = DEFAULT_DIG_TIMEOUT_MS } = options
  await equipToolFor(bot, block, logger)
  try {
    await withTimeout(bot.dig(block), digTimeoutMs, 'Menggali blok timeout')
    return { ok: true }
  } catch (err) {
    return { ok: false, reason: err?.message || 'dig-failed' }
  }
}

async function walkToBlock (bot, block, options = {}) {
  const { walkTimeoutMs = DEFAULT_WALK_TIMEOUT_MS, reach = REACH } = options
  if (inReach(bot, block, reach)) return true
  if (typeof bot?.pathfinder?.goto !== 'function') return false
  const { x, y, z } = block.position

  // GoalNear pada blok itu sendiri sering gagal untuk kayu: trunk dark oak 2x2
  // membuat blok dikelilingi blok padat, sehingga tidak ada posisi berdiri
  // dalam radius 1. Karena itu dicoba radius lebih longgar, lalu posisi berdiri
  // yang benar-benar kosong di sekeliling blok.
  const goalsToTry = [
    new goals.GoalNear(x, y, z, 1),
    new goals.GoalNear(x, y, z, 2)
  ]
  for (const stand of standCandidates(bot, block, { reach }).slice(0, 3)) {
    goalsToTry.push(new goals.GoalBlock(stand.x, stand.y, stand.z))
  }

  const deadline = Date.now() + walkTimeoutMs
  for (const goal of goalsToTry) {
    if (inReach(bot, block, reach)) return true
    const budget = deadline - Date.now()
    if (budget <= 250) break
    try {
      await withTimeout(bot.pathfinder.goto(goal), budget, 'Menuju blok tambang timeout')
    } catch {
      // coba goal berikutnya
    }
  }
  return inReach(bot, block, reach)
}

// Tambang satu blok: hancurkan langsung kalau sudah dalam jangkauan, kalau tidak
// berjalan sekali lalu langsung digali. Tidak memakai collectblock supaya bot
// tidak menghabiskan puluhan detik untuk pathfinding setiap blok.
async function mineBlock (bot, block, options = {}) {
  const { logger, reach = REACH, maxAttempts = 2 } = options
  if (!block?.position) return { ok: false, reason: 'no-block' }

  if (inReach(bot, block, reach)) {
    const direct = await digBlock(bot, block, options)
    if (direct.ok) return direct
    logger?.debug?.(`Gagal menggali langsung ${block.name}: ${direct.reason}`)
  }

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const walked = await walkToBlock(bot, block, { ...options, reach })
    if (!walked) break
    if (!inReach(bot, block, reach)) continue
    const dug = await digBlock(bot, block, options)
    if (dug.ok) return dug
  }

  return { ok: false, reason: 'unreachable' }
}

module.exports = {
  mineBlock,
  digBlock,
  walkToBlock,
  equipToolFor,
  inReach,
  blockDistance,
  standCandidates,
  isPassableBlock,
  REACH
}
