'use strict'

const { goals } = require('mineflayer-pathfinder')
const { LOG_TYPES } = require('./sources')
const { countItemName, findItemName } = require('../util/inventory')
const { sleep } = require('../util/async')
const {
  isAir, isSolid, isLiquid, orderedReferences, inReach
} = require('../build/placement')

function craftsNeeded (recipe, count) {
  const perCraft = recipe?.result?.count || 1
  return Math.max(1, Math.ceil(count / perCraft))
}

async function craftDirect (bot, mcData, itemName, count, logger) {
  const item = mcData.itemsByName[itemName]
  if (!item) throw new Error(`Item tidak dikenal: ${itemName}`)

  const want = count - countItemName(bot, mcData, itemName)
  if (want <= 0) return 0

  const recipe = bot.recipesFor(item.id, null, want, false)[0]
  if (!recipe) throw new Error(`Resep ${itemName} butuh crafting table atau bahan tidak cukup`)

  const crafts = craftsNeeded(recipe, want)
  logger?.debug(`Craft ${itemName} x${want} (${crafts} resep, tanpa meja)`)
  await bot.craft(recipe, crafts, null)
  await sleep(200)
  return countItemName(bot, mcData, itemName)
}

async function ensurePlanks (bot, mcData, materials, count, logger, cancellation) {
  const logType = materials._chooseWoodType?.() ||
    LOG_TYPES.find(type => countItemName(bot, mcData, `${type}_log`) > 0) ||
    'oak'

  const have = LOG_TYPES.reduce((sum, type) => sum + countItemName(bot, mcData, `${type}_planks`), 0)
  if (have >= count) return

  const needPlanks = count - have
  const needLogs = Math.ceil(needPlanks / 4)
  await materials.ensureItem(`${logType}_log`, needLogs, cancellation)

  const before = countItemName(bot, mcData, `${logType}_planks`)
  await craftDirect(bot, mcData, `${logType}_planks`, before + needPlanks, logger)
  logger?.debug(`Planks tersedia: ${countItemName(bot, mcData, `${logType}_planks`)}`)
}

async function placeBlockNear (bot, mcData, itemName, options = {}) {
  const { reach = 4.2, logger, cancellation } = options
  const item = findItemName(bot, mcData, itemName)
  if (!item) return null

  const base = bot.entity.position.floored()
  const candidates = []

  for (let dx = -3; dx <= 3; dx++) {
    for (let dz = -3; dz <= 3; dz++) {
      if (dx === 0 && dz === 0) continue
      for (const dy of [-1, 0, 1]) {
        const pos = base.offset(dx, dy, dz)
        candidates.push(pos)
      }
    }
  }

  candidates.sort((a, b) => a.distanceTo(bot.entity.position) - b.distanceTo(bot.entity.position))

  for (const pos of candidates) {
    cancellation?.throwIfCancelled()
    const target = bot.blockAt(pos)
    const below = bot.blockAt(pos.offset(0, -1, 0))
    const feet = bot.entity.position.floored()

    if (!isAir(target)) continue
    if (pos.equals(feet) || pos.equals(feet.offset(0, 1, 0))) continue
    if (!isSolid(below) || isLiquid(below)) continue

    if (!inReach(bot, pos, reach)) {
      try {
        await bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, 1))
      } catch {
        continue
      }
      if (!inReach(bot, pos, reach)) continue
    }

    const action = { name: `minecraft:${itemName}`, properties: {} }
    const refs = orderedReferences(bot, pos, action, mcData)
    for (const ref of refs) {
      try {
        await bot.equip(item, 'hand')
        const faceCenter = ref.block.position.offset(0.5, 0.5, 0.5).plus(ref.face.scaled(0.5))
        await bot.lookAt(faceCenter, true)
        if (ref.interactable) bot.setControlState('sneak', true)
        await bot.placeBlock(ref.block, ref.face)
        if (ref.interactable) bot.setControlState('sneak', false)
        await sleep(150, cancellation)
        const placed = bot.blockAt(pos)
        if (placed && placed.name === itemName) {
          logger?.info(`Menaruh ${itemName} di ${pos.x} ${pos.y} ${pos.z}`)
          return placed
        }
      } catch (err) {
        logger?.debug(`Gagal taruh ${itemName}: ${err.message}`)
      } finally {
        bot.setControlState('sneak', false)
      }
    }
  }

  return null
}

async function ensureCraftingTable (bot, mcData, materials, logger, cancellation) {
  const tableBlockId = mcData.blocksByName.crafting_table?.id
  if (tableBlockId === undefined) throw new Error('Minecraft-data tidak punya crafting_table')

  const existing = bot.findBlock({ matching: tableBlockId, maxDistance: 24 })
  if (existing) {
    try {
      if (bot.entity.position.distanceTo(existing.position) > 3) {
        await bot.pathfinder.goto(new goals.GoalNear(existing.position.x, existing.position.y, existing.position.z, 2))
      }
      return existing
    } catch (err) {
      logger?.debug(`Meja craft lama tidak terjangkau: ${err.message}`)
    }
  }

  let tableItem = findItemName(bot, mcData, 'crafting_table')
  if (!tableItem) {
    await ensurePlanks(bot, mcData, materials, 4, logger, cancellation)
    await craftDirect(bot, mcData, 'crafting_table', 1, logger)
    tableItem = findItemName(bot, mcData, 'crafting_table')
  }

  if (!tableItem) throw new Error('Gagal membuat crafting_table')

  const placed = await placeBlockNear(bot, mcData, 'crafting_table', { logger, cancellation })
  if (!placed) throw new Error('Gagal menaruh crafting_table')

  try {
    await bot.pathfinder.goto(new goals.GoalNear(placed.position.x, placed.position.y, placed.position.z, 2))
  } catch {}

  return placed
}

async function craftWithTable (bot, mcData, materials, itemName, count, logger, cancellation) {
  const item = mcData.itemsByName[itemName]
  if (!item) throw new Error(`Item tidak dikenal: ${itemName}`)

  const want = count - countItemName(bot, mcData, itemName)
  if (want <= 0) return countItemName(bot, mcData, itemName)

  const table = await ensureCraftingTable(bot, mcData, materials, logger, cancellation)
  const recipe = bot.recipesFor(item.id, null, want, true)[0]
  if (!recipe) throw new Error(`Bahan untuk ${itemName} belum cukup`)

  const crafts = craftsNeeded(recipe, want)
  logger?.debug(`Craft ${itemName} x${want} di meja (${crafts} resep)`)
  await bot.craft(recipe, crafts, table)
  await sleep(250, cancellation)

  return countItemName(bot, mcData, itemName)
}


async function craftRecipeFallback (bot, mcData, materials, itemName, count, logger, cancellation) {
  const item = mcData.itemsByName[itemName]
  if (!item || typeof bot.recipesAll !== 'function') return { ok: false, reason: 'no-recipe' }

  const have = countItemName(bot, mcData, itemName)
  const want = count - have
  if (want <= 0) return { ok: true, have }

  const recipe = bot.recipesAll(item.id, null, true)[0]
  if (!recipe) return { ok: false, reason: 'no-recipe' }

  const resultCount = recipe.result?.count || 1
  const crafts = Math.ceil(want / resultCount)
  const inputs = (recipe.delta || []).filter(delta => delta.count < 0)

  for (const input of inputs) {
    const inputItem = mcData.items[input.id]
    if (!inputItem) return { ok: false, reason: 'unknown-ingredient' }
    const needed = Math.abs(input.count) * crafts
    const result = await materials.ensureItem(inputItem.name, needed, cancellation)
    if (!result.ok) return { ok: false, reason: `base:${inputItem.name}` }
  }

  let table = null
  if (recipe.requiresTable) {
    table = await ensureCraftingTable(bot, mcData, materials, logger, cancellation)
  }

  await bot.craft(recipe, crafts, table)
  await sleep(250, cancellation)
  const after = countItemName(bot, mcData, itemName)
  logger?.debug(`Fallback craft ${itemName}: ${have} -> ${after}`)
  return { ok: after >= count, have: after }
}

async function executeCraftPlan (bot, mcData, materials, plan, logger, cancellation) {
  if (!plan || !Array.isArray(plan.recipesToDo) || plan.recipesToDo.length === 0) return

  let table = null
  if (plan.requiresCraftingTable) {
    table = await ensureCraftingTable(bot, mcData, materials, logger, cancellation)
  }

  for (const step of plan.recipesToDo) {
    cancellation?.throwIfCancelled()
    const recipe = step.recipe
    if (!recipe) continue
    const applications = step.recipeApplications || 1
    const resultName = mcData.items[recipe.result.id]?.name || recipe.result.id
    logger?.debug(`Craft ${resultName} x${applications} resep`)
    await bot.craft(recipe, applications, recipe.requiresTable ? table : null)
    await sleep(250, cancellation)
  }
}

function planCraft (bot, mcData, itemName, count, availableItems = undefined) {
  const item = mcData.itemsByName[itemName]
  if (!item) return null

  if (typeof bot.planCraft !== 'function') return null

  return bot.planCraft(
    { id: item.id, count },
    { includeRecursion: true, multipleRecipes: true, careAboutExisting: false, availableItems }
  )
}

module.exports = {
  craftDirect,
  craftWithTable,
  executeCraftPlan,
  ensureCraftingTable,
  ensurePlanks,
  placeBlockNear,
  planCraft,
  craftRecipeFallback,
  craftsNeeded
}
