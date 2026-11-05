'use strict'

const { nextTick, startGlide } = require('./tick')
const { TAGS } = require('./loadout')
const { tangentialIntercept, POST_HIT_PITCH } = require('./charge')
const { horizontalSpeed, runupPoint, avoidancePoint, shouldStrike } = require('./flight')

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
      runupDistance: 12,
      attackSpeed: 1.2,
      minStrikeSpeed: 0.9,
      altitude: 4,
      avoidance: true,
      avoidanceDistance: 6,
      ...options
    }
    this.stats = { takeoffs: 0, boosts: 0, charges: 0, hits: 0, avoidances: 0 }
    this.lastBoost = 0
    this.engaged = false
    this.phase = 'idle'
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

  async flyTo (point, options = {}) {
    const bot = this.bot
    const safe = this.settings.avoidance
      ? avoidancePoint(bot, point, { distance: this.settings.avoidanceDistance })
      : { point, avoided: false }
    if (safe.avoided) this.stats.avoidances++
    await bot.lookAt(safe.point, true)
    const speed = horizontalSpeed(bot.entity)
    const targetSpeed = options.targetSpeed ?? this.settings.boostSpeed
    const cooled = Date.now() - this.lastBoost > this.settings.boostCooldownMs
    const allowBoost = options.allowBoost !== false
    if (!this.engaged && speed < targetSpeed && cooled && allowBoost) {
      await this.boost()
    }
    return true
  }

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

  climbAway () {
    const yaw = this.bot.entity?.yaw ?? 0
    try {
      const r = this.bot.look?.(yaw, POST_HIT_PITCH * DEG, true)
      if (r && typeof r.catch === 'function') r.catch(() => {})
    } catch {}
  }

  async attackRun (target) {
    const bot = this.bot
    if (bot.entity?.onGround === true || !this.flying) {
      const ok = await this.takeOff()
      this.phase = 'idle'
      return { ok: false, phase: ok ? 'takeoff' : 'failed' }
    }
    const dist = bot.entity.position.distanceTo(target.position)
    const speed = horizontalSpeed(bot.entity)
    if (this.phase !== 'strike' && (dist > this.settings.runupDistance || speed < this.settings.attackSpeed)) {
      this.phase = 'runup'
      const point = runupPoint(
        bot.entity.position,
        target.position,
        this.settings.runupDistance,
        this.settings.altitude
      )
      await this.flyTo(point, { targetSpeed: this.settings.attackSpeed })
      return { ok: false, phase: 'runup', speed }
    }
    this.phase = 'strike'
    await this.engage()
    // Hanya menyerang saat berada di dalam jangkauan spear (2.2–3.8 blok).
    if (shouldStrike({ distance: dist, speed, minSpeed: this.settings.minStrikeSpeed })) {
      const result = await this.chargeAttack(target)
      return result
    }
    // Belum cukup dekat: luruskan ke titik tengah target, menunggu masuk range.
    await this.flyTo(this.aimCenter(target), { allowBoost: false })
    return { ok: false, phase: 'strike' }
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
