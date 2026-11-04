'use strict'

const { goals } = require('mineflayer-pathfinder')
const { withTimeout } = require('../util/async')
const { LAVA_BLOCKS, FIRE_BLOCKS, lavaNear } = require('./nether')

const HAZARDS = new Set([...LAVA_BLOCKS, ...FIRE_BLOCKS])
const NON_SOLID = new Set(['air', 'cave_air', 'void_air', 'water', 'bubble_column', 'short_grass', 'tall_grass', 'fern', 'dead_bush', 'torch', 'wall_torch', 'soul_torch', 'rail'])

function nameOf (block) {
  return String(block?.name || '').replace(/^minecraft:/, '').toLowerCase()
}

function isHazardBlock (block) {
  return HAZARDS.has(nameOf(block))
}

function isEmptyBlock (block) {
  if (!block) return false
  if (isHazardBlock(block)) return false
  if (NON_SOLID.has(nameOf(block))) return true
  return block.boundingBox === 'empty'
}

function isSolidBlock (block) {
  if (!block) return false
  if (isHazardBlock(block)) return false
  return block.boundingBox === 'block' || (block.boundingBox === undefined && block.diggable === true)
}

function blockName (bot, pos) {
  try {
    return nameOf(bot?.blockAt?.(pos))
  } catch {
    return ''
  }
}

function isInLava (bot) {
  const pos = bot?.entity?.position
  if (!pos) return false
  if (bot.entity.onFire || bot.entity.inLava) return true
  const feet = pos.floored()
  return HAZARDS.has(blockName(bot, feet)) || HAZARDS.has(blockName(bot, feet.offset(0, 1, 0)))
}

function isStandable (bot, pos) {
  if (!bot?.blockAt || !pos) return false
  const feet = bot.blockAt(pos)
  const head = bot.blockAt(pos.offset(0, 1, 0))
  const floor = bot.blockAt(pos.offset(0, -1, 0))
  if (!feet || !head || !floor) return false
  if (!isEmptyBlock(feet) || !isEmptyBlock(head)) return false
  if (!isSolidBlock(floor)) return false
  return !lavaNear(bot, pos, 1)
}

function findSafeSpot (bot, options = {}) {
  const { radius = 8, maxDrop = 2, maxRise = 1, from = null, minDistance = 0 } = options
  const origin = bot?.entity?.position?.floored?.()
  if (!origin) return null

  let best = null
  let bestScore = Infinity
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dz = -radius; dz <= radius; dz++) {
      const horizontal = Math.hypot(dx, dz)
      if (horizontal === 0 || horizontal > radius) continue
      if (from && minDistance > 0 && Math.hypot(dx, dz) < minDistance) continue
      for (let dy = -maxDrop; dy <= maxRise; dy++) {
        const candidate = origin.offset(dx, dy, dz)
        if (!isStandable(bot, candidate)) continue
        const score = horizontal + Math.abs(dy) * 0.75
        if (score < bestScore) {
          bestScore = score
          best = candidate
        }
      }
    }
  }
  return best
}

function moveToward (bot, spot) {
  const pos = bot?.entity?.position
  if (!pos) return
  const dx = spot.x + 0.5 - pos.x
  const dz = spot.z + 0.5 - pos.z
  try { bot.look?.(Math.atan2(-dx, -dz), 0, true) } catch {}
  try {
    bot.setControlState?.('forward', true)
    bot.setControlState?.('jump', true)
    bot.setControlState?.('sprint', true)
  } catch {}
  const timer = setTimeout(() => {
    try { bot.clearControlStates?.() } catch {}
  }, 600)
  timer.unref?.()
}

async function escapeLava (bot, options = {}) {
  const { logger, radius = 8, timeoutMs = 2500, from = null, minDistance = 0, force = false } = options
  if (!bot?.entity) return { ok: false, moved: false, reason: 'not-ready' }
  if (!force && !isInLava(bot)) return { ok: true, moved: false }

  const spot = findSafeSpot(bot, { radius, from, minDistance })
  try { bot.pathfinder?.stop?.() } catch {}
  try { bot.clearControlStates?.() } catch {}

  if (!spot) {
    logger?.warn('Terdeteksi lava tetapi tidak ada tempat aman di sekitar; bot berhenti bergerak')
    return { ok: false, moved: false, reason: 'no-safe-spot' }
  }

  logger?.warn(`Terdeteksi lava! Keluar menuju (${spot.x}, ${spot.y}, ${spot.z})`)
  try {
    if (bot.pathfinder?.goto) {
      await withTimeout(
        bot.pathfinder.goto(new goals.GoalBlock(spot.x, spot.y, spot.z)),
        timeoutMs,
        'Keluar dari lava timeout'
      )
      return { ok: true, moved: true, spot }
    }
  } catch (err) {
    logger?.debug?.(`Gagal berjalan keluar dari lava: ${err.message}`)
  }

  moveToward(bot, spot)
  return { ok: true, moved: true, spot, fallback: true }
}

class LavaGuard {
  constructor (bot, config = {}, logger = null) {
    this.bot = bot
    this.logger = logger
    const settings = config?.safety?.lava || {}
    this.settings = {
      enabled: true,
      checkIntervalMs: 250,
      dangerRadius: 8,
      escapeTimeoutMs: 2500,
      cooldownMs: 1500,
      ...settings
    }
    this.escapes = 0
    this.escaping = false
    this.lastEscapeAt = 0
    this._interval = null
    this._stopped = false
  }

  get enabled () {
    return this.settings.enabled !== false && Boolean(this.bot?.blockAt)
  }

  start () {
    if (this._interval || this._stopped || !this.enabled) return
    const intervalMs = Math.max(50, Number(this.settings.checkIntervalMs) || 250)
    this._interval = setInterval(() => {
      this.tick().catch(err => this.logger?.debug?.(`Lava guard gagal: ${err.message}`))
    }, intervalMs)
    this._interval.unref?.()
    this.bot.once?.('end', () => this.stop())
  }

  stop () {
    this._stopped = true
    if (this._interval) clearInterval(this._interval)
    this._interval = null
  }

  async tick () {
    if (!this.enabled || this._stopped) return null
    if (this.escaping) return null
    if (!isInLava(this.bot)) return null

    const cooldownMs = Number(this.settings.cooldownMs) || 0
    if (Date.now() - this.lastEscapeAt < cooldownMs) return null

    this.escaping = true
    this.lastEscapeAt = Date.now()
    try {
      const result = await escapeLava(this.bot, {
        logger: this.logger,
        radius: Number(this.settings.dangerRadius) || 8,
        timeoutMs: Number(this.settings.escapeTimeoutMs) || 2500
      })
      if (result.moved) this.escapes++
      return result
    } finally {
      this.escaping = false
    }
  }
}

module.exports = {
  lavaNear,
  isInLava,
  isStandable,
  findSafeSpot,
  escapeLava,
  moveToward,
  LavaGuard,
  HAZARDS
}
