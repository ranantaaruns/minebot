'use strict'

const { sleep } = require('../util/async')

// Blok yang membuat critical hit tidak mungkin (air, tangga, jaring, dsb).
const NO_CRIT_FEET = /(^|_)(water|lava|ladder|vine|scaffolding|cobweb|powder_snow|bubble)/

function velocityY (bot) {
  return Number(bot?.entity?.velocity?.y) || 0
}

function feetName (bot) {
  const position = bot?.entity?.position
  if (!position || typeof bot.blockAt !== 'function') return ''
  try {
    const point = typeof position.floored === 'function' ? position.floored() : position
    return String(bot.blockAt(point)?.name || '').replace(/^minecraft:/, '').toLowerCase()
  } catch {
    return ''
  }
}

// Critical hit versi Java: menyerang saat sedang jatuh (velocity.y < 0), tidak di
// tanah, tidak di air/tangga, dan tidak sedang sprint. Syarat awal untuk mencoba:
// bot sedang berdiri di tanah sehingga bisa melompat.
function canCrit (bot) {
  const entity = bot?.entity
  if (!entity || !entity.position || !entity.velocity) return false
  if (typeof bot.setControlState !== 'function') return false
  if (entity.onGround === false) return false
  if (entity.isInWater || entity.isInLava) return false
  if (bot.controlState?.sprint) return false
  if (NO_CRIT_FEET.test(feetName(bot))) return false
  return true
}

async function waitFor (predicate, timeoutMs, tickMs, cancellation) {
  const deadline = Date.now() + Math.max(10, Number(timeoutMs) || 10)
  while (Date.now() <= deadline) {
    cancellation?.throwIfCancelled?.()
    if (predicate()) return true
    await sleep(Math.max(1, Number(tickMs) || 20), cancellation)
  }
  return false
}

function inReach (bot, entity, maxRange) {
  const from = bot?.entity?.position
  const to = entity?.position
  if (!from || !to) return false
  return from.distanceTo(to) <= Number(maxRange)
}

// Melompat lalu memukul tepat saat turun, sehingga damage-nya critical.
async function jumpCrit (bot, entity, options = {}) {
  const {
    cancellation,
    tickMs = 20,
    riseTimeoutMs = 250,
    fallTimeoutMs = 500,
    maxRange = 4.5
  } = options

  const release = () => {
    try { bot.setControlState('jump', false) } catch {}
  }

  try { bot.setControlState('sprint', false) } catch {}
  try { bot.setControlState('jump', true) } catch {}

  const rose = await waitFor(
    () => velocityY(bot) > 0.02 || bot.entity.onGround === false,
    riseTimeoutMs, tickMs, cancellation
  )
  release()
  if (!rose) return { attacked: false, crit: false, reason: 'no-jump' }

  const falling = await waitFor(
    () => velocityY(bot) < -0.02 && bot.entity.onGround !== true,
    fallTimeoutMs, tickMs, cancellation
  )
  if (!falling) return { attacked: false, crit: false, reason: 'no-fall' }
  if (!inReach(bot, entity, maxRange)) return { attacked: false, crit: false, reason: 'out-of-reach' }

  try {
    bot.attack(entity)
  } catch (err) {
    return { attacked: false, crit: false, reason: err.message }
  } finally {
    release()
  }

  return { attacked: true, crit: true }
}

module.exports = { jumpCrit, canCrit, waitFor, NO_CRIT_FEET }
