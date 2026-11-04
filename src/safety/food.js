'use strict'

const mcDataLoader = require('minecraft-data')
const { sleep, withTimeout } = require('../util/async')

const EAT_TIMEOUT_MS = 5000

function pickFood (bot, mcData) {
  const foods = []
  for (const item of bot.inventory.items()) {
    const food = mcData.foodsByName[item.name]
    if (!food || food.foodPoints <= 0) continue
    foods.push({ item, food })
  }
  foods.sort((a, b) => (b.food.effectiveQuality || b.food.foodPoints) - (a.food.effectiveQuality || a.food.foodPoints))
  return foods[0] || null
}

class FoodManager {
  constructor (bot, config, logger, options = {}) {
    this.bot = bot
    this.config = config
    this.logger = logger
    this.owner = options.owner || null
    this.water = options.water || null
    this.onStarving = options.onStarving || null

    this.eating = false
    this.pending = false
    this.waitingForFood = false
    this.lastAttemptAt = 0
    this.lastWarningAt = 0
    this._warnedNoFood = false
    this._started = false
    this._destroyed = false
    this._mcData = null
    this._interval = null

    this._onHealth = () => {
      this.check().catch(err => this.logger?.debug(`Cek makanan gagal: ${err.message}`))
    }
  }

  get safety () {
    return this.config.safety || {}
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

  get enabled () {
    return this.safety.autoEat !== false
  }

  get threshold () {
    const value = Number(this.safety.eatThreshold)
    return Number.isFinite(value) ? value : 16
  }

  get criticalFood () {
    const value = Number(this.safety.criticalFood)
    return Number.isFinite(value) ? value : 6
  }

  attach (owner, water) {
    if (owner) this.owner = owner
    if (water) this.water = water
  }

  start () {
    if (this._started || this._destroyed) return
    this._started = true
    this.bot.on('health', this._onHealth)
    const intervalMs = Number(this.safety.eatCheckIntervalMs) || 2000
    this._interval = setInterval(() => this._onHealth(), intervalMs)
    this._interval.unref?.()
    this.bot.once('end', () => this.stop())
  }

  stop () {
    if (this._destroyed) return
    this._destroyed = true
    this.bot.removeListener('health', this._onHealth)
    if (this._interval) clearInterval(this._interval)
    this._interval = null
  }

  pickFood () {
    const mcData = this.mcData
    if (!mcData) return null
    try {
      return pickFood(this.bot, mcData)
    } catch {
      return null
    }
  }

  shouldYield () {
    return this.pending || this.eating || this.waitingForFood
  }

  isStarving () {
    return this.waitingForFood
  }

  manualResume () {
    if (!this.waitingForFood) return false
    const food = Number(this.bot.food)
    if (Number.isFinite(food) && food <= this.criticalFood && !this.pickFood()) return false
    this.waitingForFood = false
    this._warnedNoFood = false
    this._resumeMovement()
    return true
  }

  async waitUntilReady (cancellation) {
    if (!this.enabled) return true
    while (this.pending || this.eating) {
      cancellation?.throwIfCancelled()
      await sleep(100, cancellation)
    }
    return !this.waitingForFood
  }

  async check () {
    if (!this._started || this._destroyed || !this.enabled) return
    if (!this.bot.entity || this.bot.isAlive === false) return
    if (this.eating) return

    const food = Number(this.bot.food)
    if (!Number.isFinite(food)) return

    if (food > this.threshold) {
      this._warnedNoFood = false
      this.lastWarningAt = 0
      this.pending = false
      if (this.waitingForFood) {
        this.waitingForFood = false
        this._resumeMovement()
      }
      return
    }

    const choice = this.pickFood()
    if (choice) {
      this.pending = true
      await this._tryEat(choice)
      return
    }

    this.pending = false
    this._warnNoFood(food)

    if (food <= this.criticalFood && this.safety.noFoodAction !== 'continue') {
      this._starve(food)
    } else if (this.waitingForFood) {
      this.waitingForFood = false
      this._resumeMovement()
    }
  }

  async _tryEat (choice) {
    if (this.eating || this._destroyed) return
    if (this._isBusy()) return

    const retryMs = Number(this.safety.eatRetryMs) || 4000
    if (Date.now() - this.lastAttemptAt < retryMs) return

    const beforeFood = Number(this.bot.food)
    this.eating = true
    this.pending = false
    this.bot.autoEating = true
    this._pauseMovement()

    let success = false
    try {
      await this.bot.equip(choice.item, 'hand')
      await withTimeout(this.bot.consume(), EAT_TIMEOUT_MS, 'Makan timeout')
      success = true
      this.logger?.info(`Makan ${choice.item.name} (food=${this.bot.food})`)
    } catch (err) {
      this.logger?.debug(`Gagal makan: ${err.message}`)
      try { this.bot.deactivateItem?.() } catch {}
    } finally {
      const food = Number(this.bot.food)
      if (success && Number.isFinite(beforeFood) && Number.isFinite(food) && food <= beforeFood) {
        this.logger?.debug('Food belum terlihat bertambah setelah makan')
      }
      this.eating = false
      this.bot.autoEating = false
      this.lastAttemptAt = Date.now()

      if (success || (Number.isFinite(food) && food > this.criticalFood)) {
        this.waitingForFood = false
      }
      if (!success && Number.isFinite(food) && food <= this.threshold && this.pickFood()) {
        this.pending = true
      }
      this._resumeMovement()
    }
  }

  _isBusy () {
    if (this.bot.targetDigBlock) return true
    if (this.bot.usingHeldItem) return true
    if (this.bot.currentWindow) return true
    if (this.bot.pathfinder?.isBuilding?.() || this.bot.pathfinder?.isMining?.()) return true
    return false
  }

  _pauseMovement (force = false) {
    if (!force && this.safety.pauseMovementWhileEating === false) return
    this.owner?.holdForFood?.()
    this.water?.setPaused?.(true)
  }

  _resumeMovement () {
    if (this.waitingForFood) return
    this.water?.setPaused?.(false)
    this.owner?.releaseFoodHold?.()
  }

  _warnNoFood (food) {
    if (this._warnedNoFood) return
    const now = Date.now()
    if (this.lastWarningAt && now - this.lastWarningAt < 30000) return
    this._warnedNoFood = true
    this.lastWarningAt = now
    this.logger?.warn(`Makanan habis di inventory (food=${food})`)
  }

  _starve (food) {
    if (this.waitingForFood) return
    this.waitingForFood = true
    this.pending = false
    this._pauseMovement(true)

    const username = this.config.owner?.username
    if (username) {
      try {
        this.bot.whisper(username, `Aku kehabisan makanan (food=${food}). Tolong beri makanan.`)
      } catch (err) {
        this.logger?.debug(`Gagal whisper owner: ${err.message}`)
      }
    }

    this.logger?.warn(`Food kritis (${food}); berhenti dan menunggu makanan`)
    this.onStarving?.(food)
  }
}

module.exports = { FoodManager, pickFood }
