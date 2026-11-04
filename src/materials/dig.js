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
  try {
    await withTimeout(
      bot.pathfinder.goto(new goals.GoalNear(x, y, z, 1)),
      walkTimeoutMs,
      'Menuju blok tambang timeout'
    )
    return true
  } catch {
    return false
  }
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
  REACH
}
