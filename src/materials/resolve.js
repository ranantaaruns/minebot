'use strict'

const mcDataLoader = require('minecraft-data')
const { MINE_SOURCES, SMELT_SOURCES, LOG_TYPES } = require('./sources')
const { countItemName } = require('../util/inventory')
const { withTimeout } = require('../util/async')
const { withdrawFromChests } = require('./chests')
const { executeCraftPlan, planCraft, craftRecipeFallback } = require('./craft')
const { smeltItem } = require('./smelt')
const { mineItem } = require('./gather')
const { mineAncientDebris } = require('./ancient-debris')
const { ensureTool } = require('./tools')
const {
  detectBiomeConflicts,
  getBiomeName,
  applySubstitutions,
  customAlternative,
  formatConflict
} = require('./biomes')
const { waitForOwnerSupply } = require('./owner-supply')
const { normalizeAnswer } = require('../owner-dialog')

class MaterialManager {
  constructor (bot, config, logger, options = {}) {
    this.bot = bot
    this.config = config
    this.logger = logger
    this.mcData = mcDataLoader(bot.version)
    this.origin = options.origin || null
    this.minedCount = 0
    this.inProgress = new Set()
    this.missing = new Map()
  }

  have (name) {
    return countItemName(this.bot, this.mcData, name)
  }

  get gatherDir () {
    return this.config.gather
  }

  _mineOptions (cancellation, overrides = {}) {
    return {
      logger: this.logger,
      cancellation,
      mineRadius: overrides.mineRadius ?? this.gatherDir.mineRadius,
      mineYMin: overrides.mineYMin ?? this.gatherDir.mineYMin,
      mineYMax: overrides.mineYMax ?? this.gatherDir.mineYMax,
      protectOrigin: overrides.protectOrigin !== undefined ? overrides.protectOrigin : this.origin,
      protectRadius: overrides.protectRadius ?? this.gatherDir.protectRadius,
      maxMinePerJob: overrides.maxMinePerJob ?? this.gatherDir.maxMinePerJob,
      preferCaves: overrides.preferCaves ?? this.gatherDir.preferCaves,
      caveRadius: overrides.caveRadius ?? this.gatherDir.caveRadius,
      caveTravelTimeoutMs: overrides.caveTravelTimeoutMs ?? this.gatherDir.caveTravelTimeoutMs,
      caveMinOreDistance: overrides.caveMinOreDistance ?? this.gatherDir.caveMinOreDistance,
      digTimeoutMs: overrides.digTimeoutMs ?? this.gatherDir.digTimeoutMs,
      walkTimeoutMs: overrides.walkTimeoutMs ?? this.gatherDir.walkTimeoutMs,
      maxStalled: overrides.maxStalled ?? this.gatherDir.maxStalled,
      minHealth: this.config.safety.minHealth,
      movementOptions: {
        allowTower: this.config.owner?.allowTower !== false,
        towerBlocks: this.config.owner?.towerBlocks
      },
      ...overrides
    }
  }

  async _withdraw (name, needed, cancellation) {
    if (!this.config.gather?.preferChests || needed <= 0) return 0
    const item = this.mcData.itemsByName[name]
    if (!item) return 0

    try {
      return await withTimeout(
        withdrawFromChests(this.bot, this.mcData, item.id, needed, {
          radius: this.gatherDir.chestRadius,
          logger: this.logger,
          cancellation,
          clearObstructions: this.config.gather?.clearChestObstructions !== false,
          clearHeight: this.config.gather?.clearHeight ?? 3
        }),
        60000,
        'Mengambil dari chest timeout'
      )
    } catch (err) {
      this.logger.debug(`Chest untuk ${name} gagal: ${err.message}`)
      return 0
    }
  }

  _chooseWoodType () {
    for (const type of LOG_TYPES) {
      if (this.have(`${type}_log`) > 0 || this.have(`${type}_planks`) > 0) return type
    }

    try {
      const ids = LOG_TYPES
        .map(type => this.mcData.blocksByName[`${type}_log`]?.id)
        .filter(id => id !== undefined)
      if (ids.length > 0) {
        const found = this.bot.findBlocks({ matching: ids, maxDistance: this.gatherDir.mineRadius, count: 1 })
        const block = found.length > 0 ? this.bot.blockAt(found[0]) : null
        const type = block?.name?.replace(/_log$/, '')
        if (LOG_TYPES.includes(type)) return type
      }
    } catch (err) {
      this.logger.debug(`Deteksi jenis kayu gagal: ${err.message}`)
    }

    return 'oak'
  }

  _planCraftFor (name, count) {
    const inventoryItems = this.bot.inventory.items().map(item => ({ id: item.type, count: item.count }))
    const woodType = this._chooseWoodType()
    const logItem = this.mcData.itemsByName[`${woodType}_log`]

    for (const syntheticCount of [0, 1, 2]) {
      if (syntheticCount > 0 && !logItem) continue
      const availableItems = inventoryItems.map(item => ({ ...item }))
      const syntheticBase = []
      if (syntheticCount > 0) {
        availableItems.push({ id: logItem.id, count: syntheticCount })
        syntheticBase.push({ id: logItem.id, count: syntheticCount })
      }

      const plan = planCraft(this.bot, this.mcData, name, count, availableItems)
      if (plan && plan.status !== 'failure' && plan.recipesToDo.length > 0) {
        return { plan, baseItems: this._mergeItems(plan.itemsRequiredBase, syntheticBase), additive: true }
      }
    }

    const plan = planCraft(this.bot, this.mcData, name, count)
    return { plan, baseItems: plan?.itemsRequiredBase || [], additive: false }
  }

  _mergeItems (items, extra) {
    const map = new Map()
    for (const item of [...(items || []), ...(extra || [])]) {
      const current = map.get(item.id) || { id: item.id, count: 0 }
      current.count += item.count
      map.set(item.id, current)
    }
    return [...map.values()]
  }

  async _acquireBaseItems (baseItems, cancellation, additive = false) {
    let allOk = true
    for (const base of baseItems || []) {
      const item = this.mcData.items[base.id]
      if (!item) {
        allOk = false
        continue
      }
      const target = additive ? this.have(item.name) + base.count : base.count
      const result = await this.ensureItem(item.name, target, cancellation)
      if (!result.ok) allOk = false
    }
    return allOk
  }


  async _ensureInventorySpace (cancellation, options = {}) {
    const storage = this.bot.storageManager
    if (!storage || typeof storage.shouldDeposit !== 'function' || !storage.shouldDeposit()) {
      return { ok: true, deposited: 0 }
    }
    const result = await storage.depositIfNeeded(cancellation, {
      origin: options.origin || this.origin,
      protectRadius: this.config.gather?.protectRadius
    })
    if (!result.ok) {
      throw new Error(`Inventory penuh dan storage tidak tersedia (${result.reason})`)
    }
    if (result.deposited > 0) this.logger.info(`Deposit otomatis: ${result.deposited} item`)
    return result
  }

  _biomeConfig () {
    return this.config.build?.biomeMaterials || {}
  }

  _biomeChoice (group, answer, cancellation, cfg) {
    const normalized = normalizeAnswer(answer)
    if (['1', 'ganti', 'alternatif', 'replace'].includes(normalized)) {
      if (!group.alternative || group.alternative.items.size === 0) {
        return { ok: false, reason: 'Tidak ada alternatif otomatis untuk material ini.' }
      }
      return {
        ok: true,
        action: 'substitute',
        family: group.alternative.family,
        items: group.alternative.items
      }
    }
    if (['2', 'tetap', 'punyaku', 'keep'].includes(normalized)) {
      return { ok: true, action: 'keep' }
    }
    if (['3', 'stop', 'batal', 'cancel'].includes(normalized)) {
      cancellation?.cancel('Dibatalkan oleh owner saat memilih material biome')
      cancellation?.throwIfCancelled()
    }
    if (cfg.allowCustomAlternative !== false) {
      const custom = customAlternative(answer, group, this.mcData)
      if (custom) {
        return { ok: true, action: 'substitute', family: custom.family, items: custom.items }
      }
    }
    return { ok: false, reason: 'Jawaban tidak dikenal.' }
  }

  async _askBiomeGroup (group, missing, options) {
    const { dialog, cancellation, cfg } = options
    const label = group.kind === 'wood' ? `family ${group.family}` : group.family
    const optionLines = []
    if (group.alternative && group.alternative.items.size > 0) {
      optionLines.push(`1. Ganti ke ${group.alternative.family}`)
    }
    optionLines.push('2. Tetap pakai material asli; kamu carikan dan berikan ke bot')
    optionLines.push('3. Stop')
    if (cfg.allowCustomAlternative !== false) {
      optionLines.push('Atau ketik nama item alternatif.')
    }

    let prompt = [
      `Material lintas biome: ${label} (${formatConflict(group)}).`,
      `Build di biome ${group.biome}, material ini alami di ${group.allowedBiomes.join(', ')}.`,
      `Kurang: ${missing.map(item => `${item.name} x${item.count}`).join(', ')}.`,
      optionLines.join(' ')
    ].join(' ')

    for (;;) {
      const answer = await dialog.ask(prompt, {
        cancellation,
        reminderMs: cfg.reminderMs ?? 30000
      })
      const choice = this._biomeChoice(group, answer, cancellation, cfg)
      if (choice.ok) return choice
      prompt = `${choice.reason} ${optionLines.join(' ')}`
    }
  }

  async resolveBiomeMaterials (requirements, options = {}) {
    const cfg = this._biomeConfig()
    const origin = options.origin || this.origin
    const biome = getBiomeName(this.bot, origin)
    const empty = {
      requirements,
      substitutions: new Map(),
      kept: new Map(),
      decisions: [],
      biome
    }
    if (cfg.enabled === false || !biome) return empty

    const conflicts = detectBiomeConflicts(requirements, biome, this.mcData)
    if (conflicts.length === 0) return empty

    const substitutions = new Map()
    const kept = new Map()
    const decisions = []
    const dialog = options.dialog
    const cancellation = options.cancellation

    for (const group of conflicts) {
      const missing = []
      for (const item of group.items) {
        if (this.config.gather?.preferChests) {
          await this._withdraw(item.name, item.count - this.have(item.name), cancellation)
        }
        const have = this.have(item.name)
        if (have < item.count) missing.push({ name: item.name, count: item.count - have, have })
      }
      if (missing.length === 0) continue

      if (!dialog || cfg.askOwner === false) {
        this.logger.warn(`Material lintas biome tidak tersedia: ${formatConflict(group)}`)
        continue
      }

      const choice = await this._askBiomeGroup(group, missing, { dialog, cancellation, cfg })
      if (choice.action === 'keep') {
        for (const item of missing) {
          kept.set(item.name, this.have(item.name) + item.count)
        }
        decisions.push({ key: group.key, action: 'keep', family: group.family, items: missing })
        continue
      }

      for (const [source, target] of choice.items) substitutions.set(source, target)
      decisions.push({
        key: group.key,
        action: 'substitute',
        family: group.family,
        targetFamily: choice.family,
        items: [...choice.items.entries()]
      })
    }

    const effective = applySubstitutions(requirements, substitutions, this.mcData)
    for (const [name, count] of kept) {
      if (this.have(name) >= count) continue
      this.logger.info(`Menunggu owner menyediakan ${name} (${this.have(name)}/${count})`)
      const result = await waitForOwnerSupply(this.bot, this.mcData, name, count, {
        config: this.config,
        logger: this.logger,
        cancellation,
        reminderMs: cfg.reminderMs ?? 30000,
        pickupRadius: cfg.pickupRadius ?? 8,
        timeoutMs: cfg.ownerSupplyTimeoutMs ?? 0,
        chestRadius: this.config.gather?.chestRadius ?? 32,
        preferChests: this.config.gather?.preferChests !== false,
        origin
      })
      if (!result.ok) throw new Error(`Owner supply ${name} gagal: ${result.reason}`)
    }

    for (const decision of decisions) {
      if (decision.action === 'substitute') {
        this.logger.info(`Material biome diganti: ${decision.family} -> ${decision.targetFamily}`)
      } else {
        this.logger.warn(`Material biome dipertahankan: ${decision.family}; menunggu owner`)
      }
    }

    return {
      requirements: effective,
      substitutions,
      kept,
      decisions,
      biome
    }
  }

  async ensureItem (name, count, cancellation, options = {}) {
    const have = this.have(name)
    if (have >= count) return { ok: true, have, missing: 0 }

    if (this.inProgress.has(name)) {
      this.logger.debug(`Rekursi material untuk ${name} dicegah`)
      return { ok: false, have, missing: count - have, reason: 'cycle' }
    }

    this.inProgress.add(name)
    this.logger.info(`Material ${name}: butuh ${count}, ada ${have}`)

    let reason = null

    try {
      try {
        await this._ensureInventorySpace(cancellation, options)
      } catch (err) {
        return { ok: false, have, missing: count - have, reason: err.message }
      }

      if (this.bot.foodManager && !await this.bot.foodManager.waitUntilReady(cancellation)) {
        return { ok: false, have, missing: count - have, reason: 'no-food' }
      }

      let current = have

      const chestGain = await this._withdraw(name, count - current, cancellation)
      if (chestGain > 0) current = this.have(name)
      if (current >= count) return { ok: true, have: current, missing: 0 }

      const shortfall = count - current

      const { plan, baseItems, additive } = this._planCraftFor(name, shortfall)
      if (plan && plan.recipesToDo.length > 0 && plan.status !== 'failure') {
        const baseOk = await this._acquireBaseItems(baseItems, cancellation, additive)
        if (baseOk) {
          try {
            await executeCraftPlan(
              this.bot, this.mcData, this, plan,
              this.logger, cancellation
            )
          } catch (err) {
            reason = `craft: ${err.message}`
            this.logger.debug(`Craft ${name} gagal: ${err.message}`)
          }
        } else {
          reason = 'base-material'
        }
        current = this.have(name)
        if (current >= count) return { ok: true, have: current, missing: 0 }
      }

      if (current < count) {
        try {
          const fallback = await craftRecipeFallback(
            this.bot, this.mcData, this, name, count, this.logger, cancellation
          )
          if (fallback.ok) {
            current = this.have(name)
            if (current >= count) return { ok: true, have: current, missing: 0 }
          } else if (!reason) {
            reason = `craft-fallback: ${fallback.reason || 'gagal'}`
          }
        } catch (err) {
          if (!reason) reason = `craft-fallback: ${err.message}`
          this.logger.debug(`Fallback craft ${name} gagal: ${err.message}`)
        }
      }

      if (SMELT_SOURCES[name]) {
        try {
          await smeltItem(
            this.bot, this.mcData, this, name, current + (count - current),
            this.logger, cancellation
          )
        } catch (err) {
          reason = `smelt: ${err.message}`
          this.logger.debug(`Smelt ${name} gagal: ${err.message}`)
        }
        current = this.have(name)
        if (current >= count) return { ok: true, have: current, missing: 0 }
      }

      if (!this.config.gather?.enabled) {
        reason = reason || 'gather-disabled'
      } else if (name === 'ancient_debris') {
        try {
          const res = await mineAncientDebris(
            this.bot, this.mcData, this, count,
            this._mineOptions(cancellation, options)
          )
          if (!res.ok && res.reason) reason = `debris: ${res.reason}`
        } catch (err) {
          reason = `debris: ${err.message}`
          this.logger.debug(`Ancient debris gagal: ${err.message}`)
        }
        current = this.have(name)
        if (current >= count) return { ok: true, have: current, missing: 0 }
      } else if (MINE_SOURCES[name] && !MINE_SOURCES[name].craftOnly) {
        try {
          const res = await mineItem(
            this.bot, this.mcData, this, name, count,
            this._mineOptions(cancellation, options)
          )
          if (res.reason) reason = `mine: ${res.reason}`
        } catch (err) {
          reason = `mine: ${err.message}`
          this.logger.debug(`Mine ${name} gagal: ${err.message}`)
        }
        current = this.have(name)
        if (current >= count) return { ok: true, have: current, missing: 0 }
      } else if (!reason) {
        reason = 'no-source'
      }

      const result = {
        ok: current >= count,
        have: current,
        missing: Math.max(0, count - current),
        reason
      }
      if (!result.ok) {
        this.missing.set(name, { needed: count, have: current, reason })
        this.logger.warn(`Material kurang: ${name} (${current}/${count}, ${reason || 'tidak diketahui'})`)
      }
      return result
    } finally {
      this.inProgress.delete(name)
    }
  }

  async ensureTool (type, tier, cancellation) {
    return ensureTool(this, type, tier, cancellation)
  }

  async prepare (requirements, cancellation) {
    this.missing.clear()
    this.minedCount = 0
    this.bot.storageManager?.addKeep([...requirements.items.keys()])

    const items = [...requirements.items.values()].sort((a, b) => b.count - a.count)
    if (items.length === 0) {
      return { ok: true, missing: [], skipped: requirements.skipped, unsupported: requirements.unsupported }
    }

    this.logger.info(`Menyiapkan ${items.length} jenis material...`)
    let index = 0
    for (const item of items) {
      cancellation?.throwIfCancelled()
      index++
      this.logger.info(`[${index}/${items.length}] ${item.name} x${item.count}`)
      await this.ensureItem(item.name, item.count, cancellation)
    }

    const missing = []
    for (const item of items) {
      const have = this.have(item.name)
      if (have < item.count) {
        missing.push({
          name: item.name,
          needed: item.count,
          have,
          reason: this.missing.get(item.name)?.reason || 'tidak cukup'
        })
      }
    }

    return {
      ok: missing.length === 0,
      missing,
      skipped: requirements.skipped,
      unsupported: requirements.unsupported,
      minedBlocks: this.minedCount
    }
  }

  status (requirements) {
    if (!requirements) return null
    const rows = []
    for (const item of requirements.items.values()) {
      const have = this.have(item.name)
      rows.push({ name: item.name, needed: item.count, have, ok: have >= item.count })
    }
    return rows
  }
}

module.exports = { MaterialManager }
