'use strict'

const { MINE_SOURCES } = require('./sources')
const { countItemName } = require('../util/inventory')
const { withTimeout } = require('../util/async')

function hasSilkTouch (bot) {
  try {
    return bot.inventory.items().some(item => {
      const enchants = item.enchants || item.nbt?.value?.Enchantments?.value?.value || []
      return Array.isArray(enchants) && enchants.some(enchant => {
        const name = enchant.name || enchant.id
        return name === 'silk_touch' || name === 'minecraft:silk_touch'
      })
    })
  } catch {
    return false
  }
}

function sourceBlockIds (mcData, source) {
  return source.blocks
    .map(name => mcData.blocksByName[name]?.id)
    .filter(id => id !== undefined)
}

function preferredRank (name, preferredBlocks) {
  const index = preferredBlocks.indexOf(name)
  return index === -1 ? preferredBlocks.length : index
}

function isUnderBot (pos, botPosition) {
  if (!botPosition) return false
  const feet = botPosition.floored()
  return pos.x === feet.x &&
    pos.z === feet.z &&
    pos.y < feet.y &&
    pos.y >= feet.y - 2
}

async function mineItem (bot, mcData, materials, itemName, count, options = {}) {
  const {
    logger,
    cancellation,
    mineRadius = 64,
    mineYMin = -60,
    mineYMax = 160,
    protectOrigin = null,
    protectRadius = 8,
    maxMinePerJob = 1024,
    minHealth = 6,
    timeoutPerBlockMs = 45000,
    preferredBlocks = [],
    allowHandMining = false,
    avoidUnderBot = false
  } = options

  const source = MINE_SOURCES[itemName]
  if (!source || source.craftOnly) {
    return { mined: 0, reason: 'no-source' }
  }

  if (source.requiresSilk && !hasSilkTouch(bot)) {
    return { mined: 0, reason: 'needs-silk-touch' }
  }

  const before = countItemName(bot, mcData, itemName)
  if (before >= count) return { mined: 0, have: before }

  if (source.tool && !allowHandMining) {
    const ok = await materials.ensureTool(source.tool, source.tier, cancellation)
    if (!ok) return { mined: 0, reason: 'no-tool' }
  }

  const ids = sourceBlockIds(mcData, source)
  if (ids.length === 0) return { mined: 0, reason: 'unknown-block' }

  const wanted = count - before
  const searchCount = Math.min(128, Math.max(16, wanted * 4 + 8))
  let positions = []

  try {
    positions = bot.findBlocks({
      matching: ids,
      maxDistance: mineRadius,
      count: searchCount
    })
  } catch (err) {
    logger?.debug(`findBlocks gagal: ${err.message}`)
  }

  positions = positions.filter(pos => {
    if (pos.y < mineYMin || pos.y > mineYMax) return false
    if (protectOrigin && protectRadius > 0 && pos.distanceTo(protectOrigin) <= protectRadius) return false
    if (avoidUnderBot && isUnderBot(pos, bot.entity?.position)) return false
    return true
  })

  const botPosition = bot.entity.position
  if (preferredBlocks.length > 0) {
    positions.sort((a, b) => {
      const rankA = preferredRank(bot.blockAt(a)?.name, preferredBlocks)
      const rankB = preferredRank(bot.blockAt(b)?.name, preferredBlocks)
      if (rankA !== rankB) return rankA - rankB
      return botPosition.distanceTo(a) - botPosition.distanceTo(b)
    })
  } else {
    positions.sort((a, b) => botPosition.distanceTo(a) - botPosition.distanceTo(b))
  }

  if (positions.length === 0) {
    return { mined: 0, reason: 'not-found' }
  }

  logger?.info(`Menambang ${itemName}: butuh ${wanted}, kandidat ${positions.length} blok`)

  let have = before
  let minedBlocks = 0
  let failures = 0
  let stopReason = null

  for (const pos of positions) {
    cancellation?.throwIfCancelled()

    if (have >= count) break
    if (bot.health !== undefined && bot.health < minHealth) {
      logger?.warn('Health rendah, berhenti menambang')
      stopReason = 'low-health'
      break
    }
    if (bot.foodManager && !await bot.foodManager.waitUntilReady(cancellation)) {
      logger?.warn('Makanan habis, berhenti menambang')
      stopReason = 'no-food'
      break
    }
    if (materials.minedCount >= maxMinePerJob) {
      logger?.warn('Batas maxMinePerJob tercapai, berhenti menambang')
      break
    }
    if (typeof bot.inventory.emptySlotCount === 'function' && bot.inventory.emptySlotCount() <= 0) {
      try {
        await materials._ensureInventorySpace?.(cancellation, { origin: protectOrigin })
      } catch (err) {
        logger?.warn(`Inventory penuh: ${err.message}`)
        stopReason = 'no-storage'
        break
      }
      if (bot.inventory.emptySlotCount() <= 0) {
        logger?.warn('Inventory penuh, berhenti menambang')
        stopReason = 'inventory-full'
        break
      }
    }

    const block = bot.blockAt(pos)
    if (!block || !ids.includes(block.type)) continue

    try {
      await withTimeout(
        bot.collectBlock.collect(block, { ignoreNoPath: true }),
        timeoutPerBlockMs,
        `Menambang ${itemName} timeout`
      )
      minedBlocks++
      materials.minedCount++
    } catch (err) {
      failures++
      logger?.debug(`Gagal menambang di ${pos}: ${err.message}`)
      if (failures >= 8) {
        logger?.warn('Terlalu banyak kegagalan menambang, berhenti')
        break
      }
    }

    have = countItemName(bot, mcData, itemName)
    if (minedBlocks % 8 === 0) {
      logger?.info(`Progress tambang ${itemName}: ${have}/${count}`)
    }
  }

  have = countItemName(bot, mcData, itemName)
  const result = { mined: have - before, have, blocks: minedBlocks }
  if (stopReason) result.reason = stopReason
  return result
}

module.exports = { mineItem, hasSilkTouch, sourceBlockIds, preferredRank, isUnderBot }
