'use strict'

const { goals } = require('mineflayer-pathfinder')
const { sleep, withTimeout } = require('./util/async')
const { isAir, isLiquid, inReach } = require('./build/placement')

const CONTAINER_NAMES = [
  'chest', 'trapped_chest', 'barrel', 'ender_chest',
  'furnace', 'blast_furnace', 'smoker',
  'shulker_box'
]

function bareName (name) {
  return String(name || '').replace(/^minecraft:/, '')
}

function expandContainerNames (mcData, names = CONTAINER_NAMES) {
  const out = new Set()
  for (const name of names) out.add(bareName(name))
  if (out.has('shulker_box')) {
    for (const block of mcData.blocksArray || []) {
      if (block.name.endsWith('shulker_box')) out.add(block.name)
    }
  }
  return [...out]
}

function containerBlockIds (mcData, names = CONTAINER_NAMES) {
  return expandContainerNames(mcData, names)
    .map(name => mcData.blocksByName[name]?.id)
    .filter(id => id !== undefined)
}

function isContainerBlock (block, names = CONTAINER_NAMES) {
  if (!block?.name) return false
  if (names.includes(block.name)) return true
  return names.includes('shulker_box') && block.name.endsWith('shulker_box')
}

function findContainerPositions (bot, mcData, radius, options = {}) {
  const ids = containerBlockIds(mcData, options.containers)
  if (ids.length === 0 || !bot?.entity) return []

  const positions = bot.findBlocks({
    matching: ids,
    maxDistance: radius,
    count: options.count || 64
  })
  const origin = options.origin || null
  const protectRadius = options.protectRadius || 0

  return positions
    .filter(pos => {
      if (!origin || protectRadius <= 0) return true
      return pos.distanceTo(origin) > protectRadius
    })
    .map(pos => ({ pos, distance: bot.entity.position.distanceTo(pos) }))
    .sort((a, b) => a.distance - b.distance)
}

async function moveNear (bot, pos, distance = 2) {
  if (!bot?.entity || !bot?.pathfinder) return false
  if (bot.entity.position.distanceTo(pos) <= distance + 1) return true
  try {
    await withTimeout(
      bot.pathfinder.goto(new goals.GoalNear(pos.x, pos.y, pos.z, distance)),
      12000,
      'Path ke container timeout'
    )
    return true
  } catch (err) {
    try { bot.pathfinder.stop() } catch {}
    return false
  }
}

// Blok yang tidak boleh dihancurkan hanya karena menghalangi akses ke chest.
// Menghancurkan chest lain menumpahkan isinya dan membuat owner kehilangan
// barang, jadi penghalang semacam ini dilewati, bukan digali.
const PROTECTED_CLEARING = new Set([
  'crafting_table', 'furnace', 'blast_furnace', 'smoker', 'brewing_stand',
  'enchanting_table', 'anvil', 'chipped_anvil', 'damaged_anvil',
  'hopper', 'dispenser', 'dropper', 'lectern', 'jukebox', 'note_block',
  'beacon', 'spawner', 'vault', 'trial_spawner', 'grindstone', 'stonecutter',
  'smithing_table', 'cartography_table', 'fletching_table', 'loom'
])

function isProtectedFromClearing (block) {
  const name = bareName(block?.name)
  if (!name) return false
  if (PROTECTED_CLEARING.has(name)) return true
  if (isContainerBlock(block)) return true
  if (name.endsWith('_shulker_box') || name.endsWith('_bed')) return true
  if (name.endsWith('_sign') || name.endsWith('_hanging_sign')) return true
  return false
}

async function clearAbove (bot, pos, options = {}) {
  const {
    maxHeight = 3,
    reach = 4.2,
    logger,
    cancellation
  } = options

  let cleared = 0
  for (let dy = 1; dy <= maxHeight; dy++) {
    cancellation?.throwIfCancelled()
    const target = pos.offset(0, dy, 0)
    const block = bot.blockAt(target)
    if (!block || isAir(block)) break
    if (isLiquid(block)) {
      logger?.warn(`Penghalang container di ${target} adalah cairan`)
      break
    }
    if (isProtectedFromClearing(block)) {
      logger?.warn(`Tidak menghancurkan ${block.name} di atas container ${pos}; cari akses lain`)
      break
    }
    if (!block.diggable) {
      logger?.warn(`Penghalang container ${block.name} di ${target} tidak bisa digali`)
      break
    }

    if (!inReach(bot, target, reach)) {
      if (!await moveNear(bot, pos, 2)) break
      if (!inReach(bot, target, reach)) break
    }

    try {
      if (typeof bot.tool?.equipForBlock === 'function') {
        await bot.tool.equipForBlock(block)
      }
      await withTimeout(bot.dig(block), 15000, 'Menggali penghalang container timeout')
      await sleep(120, cancellation)
      const after = bot.blockAt(target)
      if (after && !isAir(after)) break
      cleared++
      logger?.info(`Membersihkan ${block.name} di atas container ${pos}`)
    } catch (err) {
      logger?.debug(`Gagal membersihkan ${target}: ${err.message}`)
      break
    }
  }

  return cleared
}

async function openContainerAt (bot, pos, options = {}) {
  const block = bot.blockAt(pos)
  if (!block) return null

  if (!inReach(bot, pos, options.reach ?? 4.2)) {
    if (!await moveNear(bot, pos, 2)) return null
  }

  if (options.clearObstructions) {
    const cleared = await clearAbove(bot, pos, {
      maxHeight: options.clearHeight ?? 3,
      reach: options.reach ?? 4.2,
      logger: options.logger,
      cancellation: options.cancellation
    })
    if (cleared > 0) await sleep(150, options.cancellation)
  }

  const current = bot.blockAt(pos)
  if (!current) return null
  return bot.openContainer(current)
}

module.exports = {
  CONTAINER_NAMES,
  bareName,
  expandContainerNames,
  containerBlockIds,
  isContainerBlock,
  findContainerPositions,
  moveNear,
  clearAbove,
  isProtectedFromClearing,
  openContainerAt
}
