'use strict'

const { MINE_SOURCES } = require('./sources')
const { countItemName } = require('../util/inventory')
const { applyMovements } = require('../movements')
const { goToCave } = require('../navigation/cave')
const { isNether } = require('../safety/nether')
const { mineBlock, inReach } = require('./dig')

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
    timeoutPerBlockMs = null,
    preferredBlocks = [],
    allowHandMining = false,
    avoidUnderBot = false,
    movementOptions = {},
    digTimeoutMs = 15000,
    walkTimeoutMs = 8000,
    maxStalled = 5,
    maxFailures = 12,
    rescanLimit = 2,
    preferCaves = false,
    caveRadius = 48,
    caveTravelTimeoutMs = 60000,
    caveMinOreDistance = 16
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

  const findPositions = () => {
    let found = []
    try {
      found = bot.findBlocks({
        matching: ids,
        maxDistance: mineRadius,
        count: searchCount
      })
    } catch (err) {
      logger?.debug(`findBlocks gagal: ${err.message}`)
    }

    found = found.filter(pos => {
      if (pos.y < mineYMin || pos.y > mineYMax) return false
      if (protectOrigin && protectRadius > 0 && pos.distanceTo(protectOrigin) <= protectRadius) return false
      if (avoidUnderBot && isUnderBot(pos, bot.entity?.position)) return false
      return true
    })

    const botPosition = bot.entity.position
    if (preferredBlocks.length > 0) {
      found.sort((a, b) => {
        const rankA = preferredRank(bot.blockAt(a)?.name, preferredBlocks)
        const rankB = preferredRank(bot.blockAt(b)?.name, preferredBlocks)
        if (rankA !== rankB) return rankA - rankB
        return botPosition.distanceTo(a) - botPosition.distanceTo(b)
      })
    } else {
      found.sort((a, b) => botPosition.distanceTo(a) - botPosition.distanceTo(b))
    }
    return found
  }

  let positions = findPositions()

  // Di overworld, base pemain ada di bawah tanah dengan lorong menuju cave.
  // Lebih aman dan cepat menambang dari cave terdekat daripada menggali lubang baru.
  const nearestOre = positions[0]
  const oreTooFar = !nearestOre || bot.entity.position.distanceTo(nearestOre) > caveMinOreDistance
  if (preferCaves && oreTooFar && !isNether(bot)) {
    const cave = await goToCave(bot, {
      logger,
      cancellation,
      radius: caveRadius,
      timeoutMs: caveTravelTimeoutMs
    })
    if (cave) positions = findPositions()
  }

  if (positions.length === 0) {
    return { mined: 0, reason: 'not-found' }
  }

  logger?.info(`Menambang ${itemName}: butuh ${wanted}, kandidat ${positions.length} blok`)

  // Movements gather dipakai untuk berjalan ke blok yang jauh (boleh menumpuk 1x1),
  // tetapi blok yang sudah dalam jangkauan langsung dihancurkan tanpa pathfinding.
  try {
    const movements = applyMovements(bot, 'gather', movementOptions)
    if (bot.collectBlock) bot.collectBlock.movements = movements
  } catch (err) {
    logger?.debug(`Gagal menyiapkan movements tambang: ${err.message}`)
  }

  const attempted = new Set()
  let have = before
  let minedBlocks = 0
  let failures = 0
  let stalled = 0
  let rescans = 0
  let stopReason = null

  // Blok di sekitar bot selalu didahulukan supaya bot menghancurkan ore yang sudah
  // terlihat dulu, bukan berjalan mondar-mandir ke kandidat terjauh.
  const orderCandidates = list => list.slice().sort((a, b) => {
    const reachA = inReach(bot, bot.blockAt(a)) ? 0 : 1
    const reachB = inReach(bot, bot.blockAt(b)) ? 0 : 1
    if (reachA !== reachB) return reachA - reachB
    return bot.entity.position.distanceTo(a) - bot.entity.position.distanceTo(b)
  })

  while (positions.length > 0 && have < count) {
    cancellation?.throwIfCancelled()

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

    positions = orderCandidates(positions)
    const pos = positions.shift()
    attempted.add(pos)
    const block = bot.blockAt(pos)
    if (!block || !ids.includes(block.type)) continue

    const wasInReach = inReach(bot, block)
    const dug = await mineBlock(bot, block, {
      logger,
      digTimeoutMs: timeoutPerBlockMs ?? digTimeoutMs,
      walkTimeoutMs
    })

    if (dug.ok) {
      minedBlocks++
      materials.minedCount++
      stalled = 0
      have = countItemName(bot, mcData, itemName)
      if (minedBlocks % 8 === 0) {
        logger?.info(`Progress tambang ${itemName}: ${have}/${count}`)
      }
    } else {
      failures++
      if (wasInReach) stalled++
      logger?.debug(`Gagal menambang di ${pos}: ${dug.reason}`)
      try { bot.pathfinder?.stop?.() } catch {}
      try { bot.clearControlStates?.() } catch {}

      if (stalled >= maxStalled) {
        logger?.warn('Blok tambang di sekitar tidak bisa dihancurkan; berhenti mencari blok lain')
        stopReason = 'unreachable'
        break
      }
      if (failures >= maxFailures) {
        logger?.warn('Terlalu banyak kegagalan menambang, berhenti')
        stopReason = 'too-many-failures'
        break
      }
    }

    // Kandidat habis tapi masih butuh: cari blok baru di sekitar posisi bot sekarang.
    if (positions.length === 0 && have < count && minedBlocks > 0 && rescans < rescanLimit) {
      rescans++
      positions = findPositions().filter(candidate => !attempted.has(candidate))
      if (positions.length > 0) {
        logger?.debug(`Cari ulang ore di sekitar: ${positions.length} kandidat baru`)
      }
    }
  }

  have = countItemName(bot, mcData, itemName)
  if (!stopReason && minedBlocks === 0 && failures > 0) stopReason = 'unreachable'
  const result = { mined: have - before, have, blocks: minedBlocks }
  if (stopReason) result.reason = stopReason
  return result
}

module.exports = { mineItem, hasSilkTouch, sourceBlockIds, preferredRank, isUnderBot }
