'use strict'

const { goals } = require('mineflayer-pathfinder')
const { SMELT_SOURCES, FUEL_PREFERENCE, FUEL_VALUE } = require('./sources')
const { countItemName, findItemName } = require('../util/inventory')
const { sleep } = require('../util/async')
const { placeBlockNear } = require('./craft')

const FURNACE_NAMES = ['furnace', 'blast_furnace', 'smoker']

function resolveSmeltInput (itemName, mcData) {
  const def = SMELT_SOURCES[itemName]
  if (!def) return null

  if (def.inputPreferred) {
    for (const candidate of def.inputPreferred) {
      if (mcData.itemsByName[candidate]) return candidate
    }
    return null
  }

  if (def.inputAnyLog) {
    for (const candidate of ['oak_log', 'spruce_log', 'birch_log', 'jungle_log', 'acacia_log', 'dark_oak_log']) {
      if (mcData.itemsByName[candidate]) return candidate
    }
    return null
  }

  return def.input || null
}

function findFurnace (bot, mcData) {
  const ids = FURNACE_NAMES
    .map(name => mcData.blocksByName[name]?.id)
    .filter(id => id !== undefined)
  if (ids.length === 0) return null

  const block = bot.findBlock({ matching: ids, maxDistance: 24 })
  return block || null
}

async function ensureFurnace (bot, mcData, materials, logger, cancellation) {
  const existing = findFurnace(bot, mcData)
  if (existing) {
    try {
      if (bot.entity.position.distanceTo(existing.position) > 3) {
        await bot.pathfinder.goto(new goals.GoalNear(existing.position.x, existing.position.y, existing.position.z, 2))
      }
      return existing
    } catch (err) {
      logger?.debug(`Furnace lama tidak terjangkau: ${err.message}`)
    }
  }

  let item = findItemName(bot, mcData, 'furnace')
  if (!item) {
    await materials.ensureItem('furnace', 1, cancellation)
    item = findItemName(bot, mcData, 'furnace')
  }
  if (!item) throw new Error('Tidak punya furnace dan gagal membuatnya')

  const placed = await placeBlockNear(bot, mcData, 'furnace', { logger, cancellation })
  if (!placed) throw new Error('Gagal menaruh furnace')

  try {
    await bot.pathfinder.goto(new goals.GoalNear(placed.position.x, placed.position.y, placed.position.z, 2))
  } catch {}

  return placed
}

async function chooseFuel (bot, mcData, materials, neededItems, logger, cancellation) {
  for (const name of FUEL_PREFERENCE) {
    const item = mcData.itemsByName[name]
    if (!item) continue
    const have = countItemName(bot, mcData, name)
    const value = FUEL_VALUE[name] || 1
    if (have > 0 && have * value >= neededItems) {
      const needed = Math.ceil(neededItems / value) + 1
      return { name, itemId: item.id, count: Math.min(have, needed) }
    }
  }

  const fallback = 'oak_planks'
  const value = FUEL_VALUE[fallback] || 1
  const needed = Math.ceil(neededItems / value) + 2
  await materials.ensureItem(fallback, needed, cancellation)
  const item = mcData.itemsByName[fallback]
  const have = countItemName(bot, mcData, fallback)
  if (!item || have <= 0) throw new Error('Tidak ada bahan bakar untuk furnace')
  logger?.debug(`Memakai ${fallback} sebagai bahan bakar x${Math.min(have, needed)}`)
  return { name: fallback, itemId: item.id, count: Math.min(have, needed) }
}

async function smeltItem (bot, mcData, materials, itemName, count, logger, cancellation, options = {}) {
  const inputName = resolveSmeltInput(itemName, mcData)
  if (!inputName) throw new Error(`Tidak ada resep smelting untuk ${itemName}`)

  const resultItem = mcData.itemsByName[itemName]
  const inputItem = mcData.itemsByName[inputName]
  if (!resultItem || !inputItem) throw new Error(`Item smelting tidak dikenal: ${itemName}/${inputName}`)

  const before = countItemName(bot, mcData, itemName)
  const want = Math.max(0, count - before)
  if (want === 0) return before

  await materials.ensureItem(inputName, want, cancellation)
  const availableInput = countItemName(bot, mcData, inputName)
  if (availableInput <= 0) throw new Error(`Bahan ${inputName} tidak tersedia untuk smelting`)

  const furnaceBlock = await ensureFurnace(bot, mcData, materials, logger, cancellation)
  const furnace = await bot.openFurnace(furnaceBlock)
  const existingFuel = furnace.fuelItem()
  const fuel = existingFuel ? null : await chooseFuel(bot, mcData, materials, want, logger, cancellation)

  logger?.info(
    `Smelting ${itemName} x${want} dari ${inputName} ` +
    (existingFuel ? `(fuel sudah ada di furnace: ${existingFuel.name})` : `(fuel ${fuel.name} x${fuel.count})`)
  )

  let remaining = Math.min(want, availableInput)
  let produced = 0
  let lastProgress = -1

  try {
    const initialInput = Math.min(64, remaining)
    await furnace.putInput(inputItem.id, null, initialInput)
    if (fuel) await furnace.putFuel(fuel.itemId, null, fuel.count)

    const deadline = Date.now() + Math.max(45000, remaining * 12000)
    let stuck = 0

    while (produced < remaining && Date.now() < deadline) {
      cancellation?.throwIfCancelled()

      const output = furnace.outputItem()
      if (output && output.type === resultItem.id) {
        const taken = await furnace.takeOutput()
        const got = taken?.count || output.count || 0
        produced += got
        logger?.debug(`Ambil hasil smelt ${got} (${produced}/${remaining})`)
        stuck = 0
      }

      if (produced >= remaining) break

      const inputSlot = furnace.inputItem()
      if (!inputSlot && produced < remaining) {
        const stillNeeded = Math.min(64, remaining - produced)
        const haveInput = countItemName(bot, mcData, inputName)
        if (haveInput > 0) {
          await furnace.putInput(inputItem.id, null, Math.min(stillNeeded, haveInput))
        }
      }

      const fuelSlot = furnace.fuelItem()
      if (!fuelSlot) {
        const extra = await chooseFuel(bot, mcData, materials, remaining - produced, logger, cancellation)
        await furnace.putFuel(extra.itemId, null, extra.count)
      }

      if (furnace.progress === lastProgress) stuck++
      else stuck = 0
      lastProgress = furnace.progress

      if (stuck > 240) {
        logger?.warn('Smelting tidak ada progres, berhenti')
        break
      }

      await sleep(500, cancellation)
    }
  } finally {
    try {
      const output = furnace.outputItem()
      if (output && output.type === resultItem.id) await furnace.takeOutput()
    } catch {}
    try { await furnace.close() } catch {}
  }

  const after = countItemName(bot, mcData, itemName)
  logger?.info(`Smelting selesai: ${itemName} ${before} -> ${after}`)
  return after
}

module.exports = { smeltItem, ensureFurnace, resolveSmeltInput, chooseFuel, findFurnace }
