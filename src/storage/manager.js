'use strict'

const mcDataLoader = require('minecraft-data')
const { FUEL_PREFERENCE } = require('../materials/sources')
const { findContainerPositions, openContainerAt } = require('../containers')
const { armorInfo } = require('../safety/combat')

const GEAR_PATTERN = /_(pickaxe|axe|shovel|sword|hoe)$/
const EXTRA_GEAR = new Set([
  'shears', 'fishing_rod', 'flint_and_steel', 'bow', 'crossbow', 'arrow',
  'spectral_arrow', 'tipped_arrow', 'shield', 'trident', 'elytra', 'totem_of_undying',
  'bucket', 'water_bucket', 'lava_bucket', 'milk_bucket', 'powder_snow_bucket',
  'crafting_table', 'furnace', 'blast_furnace', 'smoker'
])
const FUEL_SET = new Set(FUEL_PREFERENCE)

function bareName (name) {
  return String(name || '').replace(/^minecraft:/, '')
}

class StorageManager {
  constructor (bot, config, logger, options = {}) {
    this.bot = bot
    this.config = config?.storage || config || {}
    this.logger = logger
    this.mcData = mcDataLoader(bot.version)
    this.keep = new Set((options.keep || []).map(bareName))
    this.busy = false
  }

  setKeep (names) {
    this.keep = new Set([...(names || [])].map(bareName))
  }

  addKeep (names) {
    for (const name of names || []) this.keep.add(bareName(name))
  }

  clearKeep () {
    this.keep.clear()
  }

  isFood (name) {
    return Boolean(this.mcData.foodsByName?.[bareName(name)])
  }

  isKeepItem (name) {
    const bare = bareName(name)
    if (!bare) return true
    if (this.keep.has(bare)) return true
    if (GEAR_PATTERN.test(bare) || EXTRA_GEAR.has(bare)) return true
    if (armorInfo(bare)) return true
    if (this.isFood(bare)) return true
    if (FUEL_SET.has(bare) || bare.endsWith('_log') || bare.endsWith('_planks')) return true
    return false
  }

  freeSlots () {
    if (!this.bot.inventory) return 0
    if (typeof this.bot.inventory.emptySlotCount === 'function') {
      return this.bot.inventory.emptySlotCount()
    }
    return 0
  }

  shouldDeposit () {
    if (this.config.enabled === false) return false
    return this.freeSlots() <= Number(this.config.minFreeSlots ?? 2)
  }

  depositableItems () {
    return (this.bot.inventory?.items?.() || [])
      .filter(item => !this.isKeepItem(item.name))
  }

  async depositIfNeeded (cancellation, options = {}) {
    if (!this.shouldDeposit()) return { ok: true, deposited: 0, reason: null }
    if (this.busy) return { ok: true, deposited: 0, reason: 'busy' }
    this.busy = true

    let deposited = 0
    try {
      const positions = findContainerPositions(
        this.bot,
        this.mcData,
        Number(this.config.radius) || 32,
        {
          containers: this.config.containers || ['chest', 'trapped_chest', 'barrel', 'shulker_box'],
          origin: options.origin,
          protectRadius: options.protectRadius || 0
        }
      )

      if (positions.length === 0) {
        this.logger?.warn('Inventory penuh tetapi tidak ada storage di sekitar')
        return { ok: false, deposited, reason: 'no-storage' }
      }

      for (const { pos } of positions) {
        cancellation?.throwIfCancelled()
        let window = null
        try {
          window = await openContainerAt(this.bot, pos, {
            clearObstructions: this.config.clearObstructions !== false,
            clearHeight: options.clearHeight ?? 3,
            logger: this.logger,
            cancellation
          })
          if (!window) continue

          for (const item of this.depositableItems()) {
            cancellation?.throwIfCancelled()
            const count = Math.min(item.count, 64)
            await window.deposit(item.type, null, count)
            deposited += count
            await new Promise(resolve => setImmediate(resolve))
            if (!this.shouldDeposit()) break
          }
        } catch (err) {
          this.logger?.debug(`Deposit gagal di ${pos}: ${err.message}`)
        } finally {
          if (window) {
            try { await window.close() } catch {}
          }
        }
        if (!this.shouldDeposit()) break
      }

      if (this.shouldDeposit() && this.depositableItems().length > 0) {
        return { ok: false, deposited, reason: 'storage-full' }
      }
      return { ok: true, deposited, reason: null }
    } finally {
      this.busy = false
    }
  }
}

module.exports = {
  StorageManager,
  bareName,
  GEAR_PATTERN,
  EXTRA_GEAR,
  FUEL_SET
}
