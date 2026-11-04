'use strict'

const { withTimeout } = require('../util/async')
const { isNether, hasGoldArmor, findGoldArmorInInventory } = require('./nether')

const HOSTILE_MOBS = new Set([
  'zombie', 'husk', 'drowned', 'zombie_villager', 'skeleton', 'stray', 'bogged',
  'wither_skeleton', 'creeper', 'spider', 'cave_spider', 'silverfish', 'endermite',
  'enderman', 'witch', 'pillager', 'vindicator', 'evoker', 'ravager', 'vex',
  'illusioner', 'phantom', 'blaze', 'magma_cube', 'slime', 'guardian', 'elder_guardian',
  'shulker', 'piglin', 'piglin_brute', 'hoglin', 'zoglin', 'warden', 'breeze'
])

const WEAPONS = [
  { suffix: 'netherite_sword', score: 100 },
  { suffix: 'mace', score: 95 },
  { suffix: 'diamond_sword', score: 90 },
  { suffix: 'iron_sword', score: 80 },
  { suffix: 'stone_sword', score: 70 },
  { suffix: 'golden_sword', score: 60 },
  { suffix: 'wooden_sword', score: 50 },
  { suffix: 'netherite_axe', score: 45 },
  { suffix: 'diamond_axe', score: 40 },
  { suffix: 'iron_axe', score: 35 },
  { suffix: 'stone_axe', score: 30 },
  { suffix: 'golden_axe', score: 25 },
  { suffix: 'wooden_axe', score: 20 },
  { suffix: 'trident', score: 85 },
  { suffix: 'netherite_pickaxe', score: 12 },
  { suffix: 'diamond_pickaxe', score: 11 },
  { suffix: 'iron_pickaxe', score: 10 },
  { suffix: 'stone_pickaxe', score: 9 },
  { suffix: 'wooden_pickaxe', score: 8 },
  { suffix: 'netherite_shovel', score: 7 },
  { suffix: 'diamond_shovel', score: 6 },
  { suffix: 'iron_shovel', score: 5 }
]

// Kapak dipakai khusus untuk mematahkan shield lawan: satu pukulan kapak
// mematikan shield selama 5 detik. Urutannya terpisah dari WEAPONS karena
// pemilihan senjata biasa selalu memilih pedang.
const AXES = [
  { suffix: 'netherite_axe', score: 100 },
  { suffix: 'diamond_axe', score: 90 },
  { suffix: 'iron_axe', score: 80 },
  { suffix: 'stone_axe', score: 70 },
  { suffix: 'golden_axe', score: 60 },
  { suffix: 'wooden_axe', score: 50 }
]

const ARMOR_MATERIALS = {
  netherite: 60,
  diamond: 50,
  iron: 40,
  chainmail: 30,
  golden: 25,
  leather: 20,
  turtle: 45
}

const ARMOR_SLOTS = [
  { suffix: 'helmet', destination: 'head', index: 5 },
  { suffix: 'chestplate', destination: 'torso', index: 6 },
  { suffix: 'leggings', destination: 'legs', index: 7 },
  { suffix: 'boots', destination: 'feet', index: 8 }
]

function bareName (name) {
  return String(name || '').replace(/^minecraft:/, '')
}

function isHostile (name) {
  return HOSTILE_MOBS.has(bareName(name))
}

function weaponScore (name) {
  const bare = bareName(name)
  const weapon = WEAPONS.find(entry => bare === entry.suffix || bare.endsWith(`_${entry.suffix}`))
  return weapon?.score || 0
}

function armorInfo (name) {
  const bare = bareName(name)
  if (bare === 'turtle_helmet') {
    return { destination: 'head', slot: 5, score: ARMOR_MATERIALS.turtle }
  }
  for (const slot of ARMOR_SLOTS) {
    if (!bare.endsWith(`_${slot.suffix}`)) continue
    const material = bare.slice(0, -(slot.suffix.length + 1))
    const base = ARMOR_MATERIALS[material]
    if (!base) return null
    return { destination: slot.destination, slot: slot.index, score: base + slot.index }
  }
  return null
}

function bestArmor (items) {
  const best = new Map()
  for (const item of items || []) {
    const info = armorInfo(item.name)
    if (!info) continue
    const current = best.get(info.destination)
    if (!current || info.score > current.score) {
      best.set(info.destination, { item, ...info })
    }
  }
  return best
}

function axeScore (name) {
  const bare = bareName(name)
  const axe = AXES.find(entry => bare === entry.suffix || bare.endsWith(`_${entry.suffix}`))
  return axe?.score || 0
}

function bestAxe (items) {
  let best = null
  for (const item of items || []) {
    const score = axeScore(item.name)
    if (score <= 0) continue
    if (!best || score > best.score) best = { item, score }
  }
  return best
}

function bestWeapon (items) {
  let best = null
  for (const item of items || []) {
    const score = weaponScore(item.name)
    if (!best || score > best.score) best = { item, score }
  }
  return best
}

class CombatManager {
  constructor (bot, config, logger, options = {}) {
    this.bot = bot
    this.config = config?.combat || config || {}
    this.logger = logger
    this.enabled = this.config.enabled !== false
    this.attackRange = Number(this.config.attackRange) || 3.5
    this.detectRadius = Number(this.config.detectRadius) || 8
    this.maxPursueDistance = Number(this.config.maxPursueDistance) || 6
    this.attackCooldownMs = Number(this.config.attackCooldownMs) || 650
    this.defendTimeoutMs = Number(this.config.defendTimeoutMs) || 12000
    this.autoArmor = this.config.autoArmor !== false
    this.interval = null
    this.nextAttackAt = 0
    this.nextArmorAt = 0
    this.engagedSince = 0
    this.busy = false
    this.stopped = false
    this._onEnd = () => this.stop()
  }

  start () {
    if (this.interval || !this.enabled) return
    this.bot.once('end', this._onEnd)
    this.interval = setInterval(() => {
      this.tick().catch(err => this.logger?.debug(`Combat gagal: ${err.message}`))
    }, 500)
    this.interval.unref?.()
  }

  stop () {
    this.stopped = true
    if (this.interval) clearInterval(this.interval)
    this.interval = null
    try { this.bot.removeListener('end', this._onEnd) } catch {}
  }

  entityName (entity) {
    return bareName(entity?.name || entity?.displayName || '')
  }

  findTarget () {
    if (!this.bot?.entity) return null
    const position = this.bot.entity.position
    let best = null
    const inNether = isNether(this.bot)
    const wearingGold = hasGoldArmor(this.bot)

    for (const entity of Object.values(this.bot.entities || {})) {
      if (!entity || entity === this.bot.entity || !entity.position) continue
      if (entity.username) continue
      const name = this.entityName(entity)
      if (!isHostile(name)) continue

      // In Nether, if wearing gold armor, piglins are neutral unless attacking us
      if (inNether && wearingGold && name === 'piglin') {
        const isAttackingUs = entity.target === this.bot.entity
        if (!isAttackingUs) continue
      }

      if (typeof entity.health === 'number' && entity.health <= 0) continue
      const distance = position.distanceTo(entity.position)
      if (distance > this.detectRadius) continue
      if (!best || distance < best.distance) best = { entity, distance }
    }
    return best
  }

  async equipWeapon () {
    const items = this.bot.inventory?.items?.() || []
    const best = bestWeapon(items)
    if (!best || best.score <= 0) return false
    const held = this.bot.heldItem
    if (held && held.type === best.item.type) return true
    try {
      await withTimeout(this.bot.equip(best.item, 'hand'), 2000, 'Equip senjata timeout')
      return true
    } catch (err) {
      this.logger?.debug(`Equip senjata gagal: ${err.message}`)
      return false
    }
  }

  async maybeUpgradeArmor (force = false) {
    if (!this.autoArmor) return
    const now = Date.now()
    if (!force && now < this.nextArmorAt) return
    this.nextArmorAt = now + 5000
    if (!this.bot.inventory?.slots || !this.bot.inventory?.items) return

    // In Nether, prioritize wearing at least 1 piece of gold armor if available
    const inNether = isNether(this.bot)
    if (inNether && !hasGoldArmor(this.bot)) {
      const gold = findGoldArmorInInventory(this.bot)
      if (gold) {
        const info = armorInfo(gold.name)
        if (info) {
          try {
            await withTimeout(this.bot.equip(gold, info.destination), 2000, 'Equip gold armor timeout')
            this.logger?.info(`Pakai gold armor ${gold.name} (${info.destination}) untuk keamanan piglin di Nether`)
          } catch {}
        }
      }
    }

    const best = bestArmor(this.bot.inventory.items())
    for (const [destination, candidate] of best) {
      // In Nether, keep gold armor on if we only have one piece
      if (inNether && hasGoldArmor(this.bot)) {
        const currentSlotItem = this.bot.inventory.slots[candidate.slot]
        if (currentSlotItem && currentSlotItem.name.startsWith('golden_')) {
          continue // preserve gold armor piece in Nether
        }
      }

      const current = this.bot.inventory.slots[candidate.slot]
      if (current && armorInfo(current.name)?.score >= candidate.score) continue
      try {
        await withTimeout(this.bot.equip(candidate.item, destination), 2000, 'Equip armor timeout')
        this.logger?.info(`Pakai armor ${candidate.item.name} (${destination})`)
      } catch (err) {
        this.logger?.debug(`Equip armor ${candidate.item.name} gagal: ${err.message}`)
      }
    }
  }

  async attack (target) {
    const now = Date.now()
    if (now < this.nextAttackAt) return false
    this.nextAttackAt = now + this.attackCooldownMs

    const distance = this.bot.entity.position.distanceTo(target.position)
    if (distance > this.attackRange) return false
    if (!await this.equipWeapon()) return false

    try {
      const eye = target.position.offset(0, 1, 0)
      await this.bot.lookAt(eye, true)
      this.bot.attack(target)
      if (!this.engagedSince) this.engagedSince = now
      return true
    } catch (err) {
      this.logger?.debug(`Attack gagal: ${err.message}`)
      this.engagedSince = 0
      return false
    }
  }

  async tick () {
    if (!this.enabled || this.stopped || !this.bot?.entity || this.busy) return
    if (this.bot.foodManager?.eating) return
    this.busy = true
    try {
      await this.maybeUpgradeArmor()
      const target = this.findTarget()
      if (!target) {
        this.engagedSince = 0
        return
      }
      if (this.engagedSince && Date.now() - this.engagedSince > this.defendTimeoutMs) {
        this.engagedSince = 0
        return
      }
      if (target.distance <= this.attackRange) {
        await this.attack(target.entity)
      }
    } finally {
      this.busy = false
    }
  }
}

module.exports = {
  CombatManager,
  HOSTILE_MOBS,
  isHostile,
  weaponScore,
  axeScore,
  bestAxe,
  armorInfo,
  bestArmor,
  bestWeapon
}
