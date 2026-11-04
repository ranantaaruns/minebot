'use strict'

const mcDataLoader = require('minecraft-data')
const { countItemName } = require('../util/inventory')
const { clamp, Cancellation } = require('../util/async')
const { applyMovements } = require('../movements')

function towerBlockCount (bot, mcData, names) {
  const seen = new Set()
  let count = 0
  for (const name of names || []) {
    const item = mcData.itemsByName[String(name).replace(/^minecraft:/, '')]
    if (!item || seen.has(item.id)) continue
    seen.add(item.id)
    count += countItemName(bot, mcData, item.name)
  }
  return count
}

function towerRequirement (botY, pointY, current, options = {}) {
  const reserve = Number(options.reserve) || 8
  const minGap = Number(options.minGap) || 2
  const maxTotal = (Number(options.maxPerAttempt) || 32) * (Number(options.maxAttempts) || 3)
  const gap = Number(pointY) - Number(botY)

  if (!Number.isFinite(gap) || gap < minGap) {
    return { gap, desired: current, missing: 0 }
  }

  const desired = clamp(Math.ceil(gap) + reserve, reserve, maxTotal)
  return {
    gap,
    desired,
    missing: Math.max(0, desired - current)
  }
}

class TowerSupply {
  constructor (bot, config, logger, materials) {
    this.bot = bot
    this.config = config
    this.logger = logger
    this.materials = materials
    this._mcData = null
  }

  get mcData () {
    if (this._mcData) return this._mcData
    const version = this.bot.version || this.config.server?.version
    if (!version) return null
    try {
      this._mcData = mcDataLoader(version)
    } catch {
      return null
    }
    return this._mcData
  }

  get ownerConfig () {
    return this.config.owner || {}
  }

  get settings () {
    return this.ownerConfig.towerGather || {}
  }

  have () {
    if (!this.mcData) return 0
    return towerBlockCount(this.bot, this.mcData, this.ownerConfig.towerBlocks)
  }

  async ensure (point, options = {}) {
    const { cancellation } = options
    const settings = this.settings

    if (!this.ownerConfig.allowTower || settings.enabled === false) {
      return { ok: false, have: this.have(), reason: 'tower-disabled' }
    }
    if (!point || !this.bot.entity) {
      return { ok: false, have: this.have(), reason: 'no-target' }
    }
    if (this.bot.entity.isInWater) {
      return { ok: false, have: this.have(), reason: 'in-water' }
    }
    if (this.bot.foodManager?.isStarving?.()) {
      return { ok: false, have: this.have(), reason: 'no-food' }
    }
    if (!this.materials || !this.mcData) {
      return { ok: false, have: this.have(), reason: 'not-ready' }
    }

    const current = this.have()
    const { desired, missing } = towerRequirement(
      this.bot.entity.position.y,
      point.y,
      current,
      settings
    )

    if (missing <= 0) {
      return { ok: true, have: current, needed: desired, gathered: 0 }
    }

    const itemName = String(settings.item || 'dirt').replace(/^minecraft:/, '')
    const item = this.mcData.itemsByName[itemName]
    if (!item) {
      return { ok: false, have: current, needed: desired, reason: 'unknown-item' }
    }

    const itemHave = countItemName(this.bot, this.mcData, itemName)
    const gatherCount = Math.min(missing, Number(settings.maxPerAttempt) || 32)
    const target = itemHave + gatherCount
    const beforeMined = this.materials.minedCount

    this.logger?.info(
      `Tower butuh ${desired} blok, ada ${current}. Mencari ${gatherCount} ${itemName}...`
    )

    const localCancellation = cancellation || new Cancellation()
    const timeoutMs = Number(settings.timeoutMs) || 120000
    let timer
    this.materials.minedCount = 0
    let result
    try {
      result = await Promise.race([
        this.materials.ensureItem(itemName, target, localCancellation, {
          mineRadius: Number(settings.radius) || 32,
          protectOrigin: point,
          protectRadius: Number(settings.protectRadius) || 0,
          maxMinePerJob: gatherCount,
          preferredBlocks: settings.preferredBlocks || [],
          allowHandMining: settings.allowHandMining !== false,
          avoidUnderBot: true
        }),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            localCancellation.cancel('Mencari blok tower timeout')
            reject(new Error('Mencari blok tower timeout'))
          }, timeoutMs)
        })
      ])
    } catch (err) {
      this.logger?.warn(`Gagal mencari blok tower: ${err.message}`)
      return { ok: false, have: this.have(), needed: desired, reason: err.message }
    } finally {
      clearTimeout(timer)
      this.materials.minedCount = beforeMined
      try {
        applyMovements(this.bot, 'travel', this.ownerConfig)
      } catch (err) {
        this.logger?.debug(`Gagal memulihkan movements: ${err.message}`)
      }
    }

    const after = this.have()
    if (after > current) {
      this.logger?.info(`Tower supply: ${after - current} blok didapat (${after}/${desired})`)
    } else {
      this.logger?.warn(`Tower supply gagal: ${result?.reason || 'blok tidak ditemukan'}`)
    }

    return {
      ok: after > current,
      have: after,
      needed: desired,
      gathered: after - current,
      reason: result?.ok ? null : result?.reason
    }
  }
}

module.exports = { TowerSupply, towerBlockCount, towerRequirement }
