'use strict'

const {
  findContainerPositions,
  openContainerAt,
  containerBlockIds
} = require('../containers')

const CHEST_NAMES = ['chest', 'trapped_chest', 'barrel']

function chestBlockIds (mcData) {
  return containerBlockIds(mcData, CHEST_NAMES)
}

function findChestPositions (bot, mcData, radius, options = {}) {
  return findContainerPositions(bot, mcData, radius, {
    ...options,
    containers: CHEST_NAMES
  })
}

async function withdrawFromChests (bot, mcData, itemId, amount, options = {}) {
  const { radius = 32, logger, cancellation, origin = null, protectRadius = 0 } = options
  if (amount <= 0) return 0

  const chests = findChestPositions(bot, mcData, radius, { origin, protectRadius })
  if (chests.length === 0) return 0

  let remaining = amount
  let withdrawn = 0
  const visited = new Set()

  for (const { pos } of chests) {
    if (remaining <= 0) break
    cancellation?.throwIfCancelled()

    const key = `${pos.x},${pos.y},${pos.z}`
    if (visited.has(key)) continue
    visited.add(key)

    let window = null
    try {
      const block = bot.blockAt(pos)
      if (!block || !CHEST_NAMES.includes(block.name)) continue

      window = await openContainerAt(bot, pos, {
        reach: options.reach ?? 4.2,
        clearObstructions: options.clearObstructions,
        clearHeight: options.clearHeight,
        logger,
        cancellation
      })
      if (!window) continue

      const available = window.containerItems()
        .filter(item => item.type === itemId)
        .reduce((sum, item) => sum + item.count, 0)

      if (available <= 0) {
        await window.close()
        window = null
        continue
      }

      const freeSlots = typeof bot.inventory.emptySlotCount === 'function' ? bot.inventory.emptySlotCount() : 1
      if (freeSlots <= 0) {
        logger?.warn('Inventory penuh, tidak bisa mengambil dari chest')
        await window.close()
        window = null
        break
      }

      const take = Math.min(available, remaining)
      await window.withdraw(itemId, null, take)
      remaining -= take
      withdrawn += take
      logger?.info(`Ambil ${take} item dari chest di ${pos.x} ${pos.y} ${pos.z}`)
    } catch (err) {
      logger?.debug(`Chest gagal di ${pos}: ${err.message}`)
    } finally {
      if (window) {
        try { await window.close() } catch {}
      }
    }
  }

  return withdrawn
}

module.exports = { withdrawFromChests, findChestPositions, chestBlockIds, CHEST_NAMES }
