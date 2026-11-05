'use strict'

const { withTimeout } = require('../util/async')

// Urutan slot hotbar sesuai spesifikasi PvP.
const TAGS = Object.freeze({
  MACE: 'mace',
  SPEAR: 'spear',
  WIND_CHARGE: 'windCharge',
  FIREWORK: 'firework',
  AXE: 'axe',
  WATER: 'water',
  FOOD: 'food',
  ELYTRA: 'elytra',
  CHESTPLATE: 'chestplate'
})

const SLOT_ORDER = [TAGS.MACE, TAGS.SPEAR, TAGS.WIND_CHARGE, TAGS.FIREWORK, TAGS.AXE, TAGS.WATER, TAGS.FOOD]

// Daftar prioritas: item pertama yang tersedia dipakai. Versi 1.21.4 tidak
// punya spear, jadi charge jatuh ke pedang netherite (lihat resolveCapabilities).
const ITEM_RULES = Object.freeze({
  mace: ['mace'],
  spear: ['spear', 'netherite_spear', 'diamond_spear', 'netherite_sword', 'diamond_sword', 'trident'],
  windCharge: ['wind_charge'],
  firework: ['firework_rocket'],
  axe: ['netherite_axe', 'diamond_axe', 'iron_axe', 'stone_axe', 'wooden_axe'],
  water: ['water_bucket'],
  food: ['enchanted_golden_apple', 'golden_apple', 'cooked_beef', 'cooked_porkchop', 'bread'],
  elytra: ['elytra'],
  chestplate: ['netherite_chestplate', 'diamond_chestplate', 'iron_chestplate', 'chainmail_chestplate']
})

function bareName (item) {
  const name = typeof item === 'string' ? item : item?.name
  return String(name || '').replace(/^minecraft:/, '')
}

function pickItem (items, names) {
  const list = Array.isArray(items) ? items : []
  for (const name of names) {
    const found = list.find(it => bareName(it) === name)
    if (found) return found
  }
  return null
}

function countByName (items, names) {
  return (items || []).reduce((sum, it) => sum + (names.includes(bareName(it)) ? (it.count || 1) : 0), 0)
}

function resolveCapabilities (mcData, rules = ITEM_RULES) {
  const known = name => Boolean(mcData?.itemsByName?.[name])
  const out = {}
  for (const [tag, names] of Object.entries(rules)) out[tag] = names.filter(known)
  return out
}

class HotbarLoadout {
  constructor (bot, options = {}, logger = null) {
    this.bot = bot
    this.logger = logger
    this.rules = options.rules || ITEM_RULES
    this.settings = { autoArrange: options.autoArrange !== false }
    this.slotCache = new Map()
    this.arranged = false
  }

  items () {
    try { return this.bot?.inventory?.items?.() || [] } catch { return [] }
  }

  item (tag) {
    return pickItem(this.items(), this.rules[tag] || [])
  }

  has (tag) {
    return Boolean(this.item(tag))
  }

  count (tag) {
    return countByName(this.items(), this.rules[tag] || [])
  }

  slotOf (item) {
    const slots = this.bot?.inventory?.slots || []
    return slots.indexOf(item)
  }

  async arrange () {
    if (this.arranged || !this.settings.autoArrange) return this.arranged
    this.arranged = true
    for (let i = 0; i < SLOT_ORDER.length; i++) {
      const tag = SLOT_ORDER[i]
      const item = this.item(tag)
      if (!item) continue
      const target = 36 + i
      const source = this.slotOf(item)
      if (source === -1 || source === target) { this.slotCache.set(tag, i); continue }
      try {
        await withTimeout(this.bot.moveSlotItem(source, target), 1500)
        this.slotCache.set(tag, i)
      } catch (err) {
        this.logger?.debug?.(`Hotbar ${tag}: ${err.message}`)
      }
    }
    return this.arranged
  }

  async select (tag) {
    const item = this.item(tag)
    if (!item) return false
    const index = this.slotCache.get(tag)
    if (typeof index === 'number' && index >= 0 && index <= 8) {
      try { this.bot.setQuickBarSlot(index); return true } catch {}
    }
    try {
      await withTimeout(this.bot.equip(item, 'hand'), 1500)
      return true
    } catch (err) {
      this.logger?.debug?.(`Pilih ${tag}: ${err.message}`)
      return false
    }
  }

  get wearingElytra () {
    return bareName(this.bot?.inventory?.slots?.[6]) === 'elytra'
  }

  async swapChest (tag) {
    const wanted = this.rules[tag] || []
    const worn = this.bot?.inventory?.slots?.[6]
    if (worn && wanted.includes(bareName(worn))) return true
    const item = this.item(tag)
    if (!item) return false
    try {
      await withTimeout(this.bot.equip(item, 'torso'), 2000)
      return true
    } catch (err) {
      this.logger?.debug?.(`Tukar zirah ${tag}: ${err.message}`)
      return false
    }
  }
}

module.exports = {
  HotbarLoadout,
  TAGS,
  ITEM_RULES,
  SLOT_ORDER,
  resolveCapabilities,
  bareName,
  pickItem,
  countByName
}
