'use strict'

const { createContext, nextState, STATES } = require('./fsm')
const { FallTracker } = require('./fall')
const { HotbarLoadout } = require('./loadout')
const { MaceSmasher, shouldSmash, shouldClutch } = require('./mace')
const { ElytraFlyer } = require('./fly')

// Jarak vertikal ke permukaan di bawah bot, dibatasi supaya tidak memindai
// seluruh dunia saat bot terbang tinggi.
function heightAboveGround (bot, maxScan = 24) {
  const pos = bot?.entity?.position
  if (!pos) return Infinity
  for (let dy = 1; dy <= maxScan; dy++) {
    let block = null
    try { block = bot.blockAt(pos.offset(0, -dy, 0)) } catch { block = null }
    if (block && block.name && block.name !== 'air' && block.name !== 'cave_air') {
      return dy - 1
    }
  }
  return Infinity
}

function bareName (item) {
  return String(item?.name || item || '').replace(/^minecraft:/, '')
}

class CombatEngine {
  constructor (bot, config = {}, logger = null, deps = {}) {
    this.bot = bot
    this.logger = logger
    const combat = config?.combat || {}
    const pvp = combat.pvp || {}
    this.settings = {
      enabled: pvp.enabled !== false,
      tickMs: Number(pvp.tickMs) || 50,
      clutchMinFall: Number(pvp.clutchMinFall) || 3,
      clutchHeight: Number(pvp.clutchHeight) || 1.8,
      smashRange: Number(pvp.smashRange) || 3.2,
      minFall: Number(pvp.minFall) || 1.5,
      chargeRange: Number(pvp.chargeRange) || 12,
      flyRange: Number(pvp.flyRange) || 15,
      shieldPunishMs: Number(combat.hunt?.shieldBreakPunishMs) || 5000
    }
    this.enabled = this.settings.enabled
    this.loadout = deps.loadout || new HotbarLoadout(bot, pvp.loadout || {}, logger)
    this.mace = deps.mace || new MaceSmasher(bot, this.loadout, logger, pvp)
    this.flyer = deps.flyer || new ElytraFlyer(bot, this.loadout, logger, pvp)
    this.shieldBreak = deps.shieldBreak || null
    this.fall = new FallTracker(bot)
    this.target = null
    this.state = STATES.IDLE
    this.busy = false
    this.burstPending = false
    this.started = false
    this.stats = { ticks: 0, launches: 0, smashes: 0, clutch: 0, charges: 0, shields: 0, flights: 0 }
    this.onTick = this.tick.bind(this)
    this.onDeath = this.onDeath.bind(this)
  }

  start () {
    if (this.started) return this
    this.started = true
    this.bot.on?.('physicsTick', this.onTick)
    this.bot.on?.('death', this.onDeath)
    return this
  }

  stop () {
    if (!this.started) return this
    this.started = false
    try { this.bot.removeListener?.('physicsTick', this.onTick) } catch {}
    try { this.bot.removeListener?.('death', this.onDeath) } catch {}
    this.clearTarget()
    try { this.flyer.release() } catch {}
    return this
  }

  onDeath () {
    this.clearTarget()
    this.state = STATES.IDLE
    this.fall.reset()
  }

  setTarget (entity) {
    this.target = entity || null
    this.state = STATES.IDLE
    return this.target
  }

  clearTarget () {
    this.target = null
    this.state = STATES.IDLE
    this.burstPending = false
  }

  currentTarget () {
    const target = this.target
    if (!target) return null
    if (typeof target.health === 'number' && target.health <= 0) {
      this.clearTarget()
      return null
    }
    // mineflayer mengganti objek entity setelah update metadata, jadi ambil
    // yang terbaru dari cache bila ada.
    const latest = this.bot?.entities?.[target.id]
    const entity = latest || target
    if (!entity.position) { this.clearTarget(); return null }
    return entity
  }

  blocking (target) {
    if (this.shieldBreak?.isBlocking) {
      try { return this.shieldBreak.isBlocking(target) === true } catch { return false }
    }
    return bareName(target?.heldItem) === 'shield'
  }

  buildContext (target) {
    this.fall.update()
    const ctx = createContext({ bot: this.bot, target, fallDistance: this.fall.distance })
    ctx.blocking = this.blocking(target)
    ctx.launchWindow = this.mace.canLaunch({ distance: ctx.distance, dy: ctx.dy, blocking: ctx.blocking })
    ctx.smashable = shouldSmash({
      distance: ctx.distance,
      velocityY: ctx.velocityY,
      fallDistance: this.fall.distance,
      smashRange: this.settings.smashRange,
      minFall: this.settings.minFall
    })
    ctx.burst = this.burstPending
    ctx.heightAbove = heightAboveGround(this.bot)
    ctx.clutch = shouldClutch({
      distance: ctx.distance,
      fallDistance: this.fall.distance,
      heightAbove: ctx.heightAbove,
      minFall: this.settings.clutchMinFall,
      maxHeight: this.settings.clutchHeight
    })
    return ctx
  }

  async tick () {
    if (!this.enabled || this.busy) return
    const target = this.currentTarget()
    if (!target) return
    this.stats.ticks++
    const ctx = this.buildContext(target)
    const state = nextState(this.state, ctx)
    this.state = state
    try {
      await this.dispatch(state, target, ctx)
    } catch (err) {
      this.logger?.debug?.(`Combat ${state}: ${err.message}`)
    }
  }

  async dispatch (state, target, ctx) {
    switch (state) {
      case STATES.CLUTCH:
        return this.doClutch()
      case STATES.SHIELD:
        return this.doShield(target)
      case STATES.SMASH:
        return this.doSmash(target)
      case STATES.BURST:
        return this.doBurst(target, ctx)
      case STATES.FLY:
        return this.doFly(target, ctx)
      case STATES.LAUNCH:
        return this.doLaunch(target)
      case STATES.CHARGE:
        return this.doCharge(target, ctx)
      default:
        return undefined
    }
  }

  async doClutch () {
    if (this.bot.entity?.onGround === true) return
    this.busy = true
    try {
      if (await this.mace.clutch()) {
        this.stats.clutch++
        this.fall.reset()
      }
    } finally {
      this.busy = false
    }
  }

  async doShield (target) {
    this.busy = true
    try {
      const weapon = this.shieldBreak?.weapon ? this.shieldBreak.weapon(target) : 'axe'
      await this.loadout.select(weapon === 'axe' ? 'axe' : 'spear')
      this.shieldBreak?.beforeAttack?.(target)
      const before = target.health
      await this.bot.lookAt(this.aimPoint(target), true).catch(() => {})
      this.bot.attack(target)
      this.shieldBreak?.afterAttack?.(target, weapon)
      this.stats.shields++
      if (typeof before === 'number' && typeof target.health === 'number') {
        this.logger?.debug?.(`Shield break ${before} -> ${target.health}`)
      }
    } finally {
      this.busy = false
    }
  }

  aimPoint (target) {
    const height = Number(target?.height) || 1.8
    return target.position.offset(0, height * 0.85, 0)
  }

  async doSmash (target) {
    this.busy = true
    try {
      await this.mace.smash(target)
      this.stats.smashes++
      this.burstPending = this.mace.settings.chain !== false
    } finally {
      this.busy = false
    }
  }

  async doBurst (target) {
    if (!this.burstPending) return
    if (this.mace.chainCount >= (this.mace.settings.maxChains || 3)) {
      this.burstPending = false
      return
    }
    await this.doSmash(target)
  }

  async doFly (target, ctx) {
    this.busy = true
    try {
      if (ctx.distance > this.settings.chargeRange) {
        await this.flyer.flyTo(this.aimPoint(target))
        return
      }
      const result = await this.flyer.chargeAttack(target)
      if (result?.ok) this.stats.charges++
      else this.flyer.release()
    } finally {
      this.busy = false
    }
  }

  async doLaunch (target) {
    this.busy = true
    try {
      if (await this.mace.launch(target)) this.stats.launches++
    } finally {
      this.busy = false
    }
  }

  async doCharge (target, ctx) {
    this.busy = true
    try {
      // Target jauh (> flyRange) dan bot masih di tanah: buka elytra dulu.
      if (!this.flyer.flying) {
        if (ctx.distance <= this.settings.flyRange) return
        if (!(await this.flyer.takeOff())) return
        this.stats.flights++
        return
      }
      const result = await this.flyer.chargeAttack(target)
      if (result?.ok) this.stats.charges++
      else this.flyer.release()
    } finally {
      this.busy = false
    }
  }
}

module.exports = { CombatEngine, heightAboveGround }
