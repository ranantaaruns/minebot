'use strict'

const { nextTick, startGlide } = require('./tick')
const { TAGS } = require('./loadout')
const { tangentialIntercept } = require('./charge')

class ElytraFlyer {
  constructor (bot, loadout, logger, options = {}) {
    this.bot = bot
    this.loadout = loadout
    this.logger = logger
    this.settings = {
      boostSpeed: 0.6,
      boostCooldownMs: 600,
      speed: 1.8,
      touchdownY: null,
      ...options
    }
    this.stats = { takeoffs: 0, boosts: 0, charges: 0, hits: 0 }
    this.lastBoost = 0
  }

  get flying () {
    return this.bot.entity?.elytraFlying === true || (this.bot.entity?.velocity?.y ?? 0) < -0.05
  }

  async takeOff () {
    const bot = this.bot
    if (!(await this.loadout.swapChest(TAGS.ELYTRA))) {
      this.logger?.debug?.('Elytra: tidak ada di inventori')
      return false
    }
    bot.setControlState('jump', true)
    await nextTick(bot, 2)
    bot.setControlState('jump', false)
    try {
      startGlide(bot, bot.registry)
    } catch (err) {
      this.logger?.debug?.(`Elytra: paket glide gagal: ${err.message}`)
      return false
    }
    this.stats.takeoffs++
    this.lastBoost = 0
    return true
  }

  async boost () {
    const bot = this.bot
    if (this.loadout.count(TAGS.FIREWORK) <= 0) return false
    if (!(await this.loadout.select(TAGS.FIREWORK))) return false
    bot.activateItem()
    bot.deactivateItem?.()
    this.stats.boosts++
    this.lastBoost = Date.now()
    return true
  }

  async flyTo (point) {
    const bot = this.bot
    await bot.lookAt(point, true)
    const speed = Math.hypot(bot.entity?.velocity?.x || 0, bot.entity?.velocity?.z || 0)
    const cooled = Date.now() - this.lastBoost > this.settings.boostCooldownMs
    if (speed < this.settings.boostSpeed && cooled) await this.boost()
    return true
  }

  async chargeAttack (target) {
    const bot = this.bot
    const computed = tangentialIntercept({
      self: bot.entity,
      target,
      speed: this.settings.speed
    })
    if (!computed.ok) {
      this.logger?.debug?.(`Charge dilewati: ${computed.reason}`)
      return computed
    }
    await this.loadout.select(TAGS.SPEAR)
    await bot.lookAt(computed.point, true)
    bot.attack(target)
    this.stats.charges++
    return computed
  }

  async land () {
    return this.loadout.swapChest(TAGS.CHESTPLATE)
  }
}

module.exports = { ElytraFlyer }
