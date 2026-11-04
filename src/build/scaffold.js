'use strict'

const Vec3 = require('vec3')
const { sleep } = require('../util/async')
const { isAir, isSolid } = require('./placement')
const { countItemName, findItemName } = require('../util/inventory')

async function pickScaffoldBlock (bot, mcData, candidates) {
  for (const name of candidates) {
    const item = findItemName(bot, mcData, name)
    if (item) return { name, item }
  }
  return null
}

async function pillarUp (bot, targetY, options = {}) {
  const {
    mcData,
    candidates = ['dirt', 'cobblestone', 'oak_planks', 'scaffolding'],
    cancellation,
    logger,
    maxBlocks = 80
  } = options

  const startY = bot.entity.position.y
  if (startY >= targetY - 1.5) return { placed: [], blockName: null }

  const chosen = await pickScaffoldBlock(bot, mcData, candidates)
  if (!chosen) {
    logger?.warn('Scaffold: tidak ada blok scaffold di inventory')
    return { placed: [], blockName: null, reason: 'no-scaffold' }
  }

  if (countItemName(bot, mcData, chosen.name) < 2) {
    logger?.warn(`Scaffold: ${chosen.name} tidak cukup`)
    return { placed: [], blockName: chosen.name, reason: 'not-enough' }
  }

  const placed = []
  logger?.debug(`Scaffold: naik dari y=${startY.toFixed(1)} ke y=${targetY}`)

  try {
    for (let i = 0; i < maxBlocks; i++) {
      cancellation?.throwIfCancelled()
      if (bot.entity.position.y >= targetY - 1.5) break

      const item = findItemName(bot, mcData, chosen.name)
      if (!item) break
      await bot.equip(item, 'hand')

      const feet = bot.entity.position.floored()
      const below = bot.blockAt(feet.offset(0, -1, 0))
      if (!isSolid(below)) {
        logger?.warn('Scaffold: tidak ada blok pijakan di bawah bot')
        break
      }

      const existing = bot.blockAt(feet)
      if (!isAir(existing)) {
        bot.setControlState('jump', true)
        await sleep(350, cancellation)
        bot.setControlState('jump', false)
        await sleep(350, cancellation)
        continue
      }

      bot.setControlState('jump', true)
      await sleep(260, cancellation)
      try {
        await bot.lookAt(feet.offset(0.5, 0.5, 0.5), true)
        await bot.placeBlock(below, new Vec3(0, 1, 0))
        const now = bot.blockAt(feet)
        if (now && !isAir(now)) {
          placed.push(feet.clone())
        }
      } catch (err) {
        logger?.debug(`Scaffold place gagal: ${err.message}`)
      } finally {
        bot.setControlState('jump', false)
      }
      await sleep(380, cancellation)
    }
  } finally {
    bot.setControlState('jump', false)
  }

  return { placed, blockName: chosen.name }
}

async function removeTower (bot, positions, options = {}) {
  const { cancellation, logger, timeoutMs = 30000 } = options
  if (!positions || positions.length === 0) return 0

  let removed = 0
  const sorted = [...positions].sort((a, b) => b.y - a.y)
  const deadline = Date.now() + timeoutMs

  for (const pos of sorted) {
    if (Date.now() > deadline || cancellation?.cancelled) break
    try {
      cancellation?.throwIfCancelled()
      const block = bot.blockAt(pos)
      if (!block || isAir(block) || !block.diggable) continue

      const feet = bot.entity.position.floored()
      if (!feet.equals(pos.offset(0, 1, 0))) {
        continue
      }

      await bot.lookAt(pos.offset(0.5, 0.5, 0.5), true)
      await bot.dig(block)
      removed++
      await sleep(250, cancellation)
    } catch (err) {
      logger?.debug(`Hapus scaffold gagal di ${pos}: ${err.message}`)
      break
    }
  }
  return removed
}

module.exports = { pillarUp, removeTower, pickScaffoldBlock }
