'use strict'

const { nextTick, startGlide } = require('./tick')
const { TAGS } = require('./loadout')
const { tangentialIntercept, POST_HIT_PITCH } = require('./charge')

const DEG = Math.PI / 180

class ElytraFlyer {
  constructor (bot, loadout, logger, options = {}) {
    this.bot = bot
    this.loadout = loadout
    this.logger = logger
    this.settings = {
      boostSpeed: 0.6,
      boostCooldownMs: 600,
      speed: 1.8,
      flyRange: 15,
      touchdownY: null,
      ...options
    }
    this.stats = { takeoffs: 0, boosts: 0, charges: 0, hits: 0 }
    this.lastBoost = 0
    this.engaged = false
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

  // Tahan tombol use dengan spear: status "Engaged" pada charge attack.
  async engage () {
    if (this.engaged) return true
    if (!(await this.loadout.select(TAGS.SPEAR))) return false
    this.bot.activateItem()
    this.engaged = true
    return true
  }

  release () {
    if (!this.engaged) return
    this.engaged = false
    try { this.bot.deactivateItem?.() } catch {}
  }

  // Setelah hit terdaftar: pitch -15 derajat supaya tetap melayang.
  climbAway () {
    const yaw = this.bot.entity?.yaw ?? 0
    try {
      const r = this.bot.look?.(yaw, POST_HIT_PITCH * DEG, true)
      if (r && typeof r.catch === 'function') r.catch(() => {})
    } catch {}
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
    await this.engage()
    await bot.lookAt(computed.point, true)
    bot.attack(target)
    this.stats.charges++
    // Sapuan kamera melewati bounding box lalu naik -15 derajat.
    await bot.lookAt(this.aimCenter(target), true).catch(() => {})
    this.climbAway()
    return computed
  }

  aimCenter (target) {
    const height = Number(target?.height) || 1.8
    return target.position.offset(0, height * 0.5, 0)
  }

  async land () {
    this.release()
    return this.loadout.swapChest(TAGS.CHESTPLATE)
  }
}

module.exports = { ElytraFlyer }
