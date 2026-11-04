'use strict'

const Vec3 = require('vec3')
const mcDataLoader = require('minecraft-data')
const { sleep } = require('../util/async')

const WATER_NAMES = ['water', 'flowing_water']
const LAVA_NAMES = ['lava', 'flowing_lava']

function isLiquidName (name, names) {
  return names.includes(String(name || '').replace(/^minecraft:/, ''))
}

class WaterNavigator {
  constructor (bot, config, logger, options = {}) {
    this.bot = bot
    this.config = config
    this.logger = logger
    this.getTarget = options.getTarget || (() => null)
    this.getJobPaused = options.getJobPaused || (() => false)
    this.onEnterWater = options.onEnterWater || null
    this.onExitWater = options.onExitWater || null
    this.onTimeout = options.onTimeout || null

    this.active = false
    this.approaching = false
    this.paused = false
    this.timedOut = false
    this._dryTicks = 0

    this._destroyed = false
    this._mcData = null
    this._lastLookAt = 0
    this._swimStartedAt = 0
    this._swimLastPos = null
    this._swimProgressAt = 0
    this._strafeSide = 1
    this._strafeUntil = 0
    this._approach = null
    this._approachResolve = null
    this._approachTimer = null

    this._onPhysicsTick = () => this._tick()
    this.bot.on('physicsTick', this._onPhysicsTick)
  }

  get settings () {
    return this.config?.owner?.swim || this.config?.swim || {}
  }

  get safety () {
    return this.config?.safety || {}
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
    return this.settings.enabled !== false
  }

  get antiDrown () {
    return this.safety.preventDrowning !== false
  }

  get busy () {
    return this.active || this.approaching
  }

  _tick () {
    if (this._destroyed || !this.bot.entity) return

    const inWater = Boolean(this.bot.entity.isInWater)
    if (inWater) {
      this._dryTicks = 0
      if (!this.active) this._enterWater()
    } else if (this.active) {
      this._dryTicks++
      if (this._dryTicks >= 2) this._leaveWater()
      else if (!this.getJobPaused?.()) {
        this._stopSteering()
        this._setControl('jump', false)
      }
    }
    if (this.approaching && !inWater) this._tickApproach()
    if (this.active && inWater) this._tickSwim()
  }

  _enterWater () {
    this.active = true
    this._dryTicks = 0
    this.timedOut = false
    this._swimStartedAt = Date.now()
    this._resetSwimProgress()
    if (this.approaching) this._finishApproach(true)
    this.logger?.info('Masuk air, mode renang aktif')
    this.onEnterWater?.()
  }

  _leaveWater () {
    this.active = false
    this.timedOut = false
    this._dryTicks = 0
    this._strafeUntil = 0
    this._setControl('jump', false)
    this._setControl('forward', false)
    this._setControl('left', false)
    this._setControl('right', false)
    this._setControl('sprint', false)
    this.logger?.info('Keluar air, mode renang selesai')
    this.onExitWater?.()
  }

  _resetSwimProgress () {
    this._swimLastPos = this.bot.entity?.position?.clone?.() || null
    this._swimProgressAt = Date.now()
  }

  _tickSwim () {
    const settings = this.settings
    const jobPaused = Boolean(this.getJobPaused?.())
    this._setControl('sprint', false)
    if (this.antiDrown) this._setControl('jump', true)

    if (this.paused) {
      this._swimStartedAt = Date.now()
      this._stopSteering()
      return
    }
    if (!this.enabled) {
      this._stopSteering()
      return
    }
    if (jobPaused) {
      this.timedOut = false
      this._swimStartedAt = Date.now()
      return
    }

    const target = this.getTarget?.()
    if (!target) {
      this.timedOut = false
      this._swimStartedAt = Date.now()
      this._stopSteering()
      return
    }

    const timeoutMs = Number(settings.timeoutMs) || 0
    if (!this.timedOut && timeoutMs > 0 && Date.now() - this._swimStartedAt > timeoutMs) {
      this.timedOut = true
      this._stopSteering()
      this.logger?.warn(`Renang melebihi ${Math.round(timeoutMs / 1000)} detik; tetap mengapung`)
      this.onTimeout?.()
      return
    }
    if (this.timedOut) {
      this._stopSteering()
      return
    }

    this._steerToward(target)
    const horizontal = Math.hypot(target.x - this.bot.entity.position.x, target.z - this.bot.entity.position.z)
    if (horizontal <= 1.2) {
      this._stopSteering()
      if (horizontal > 0.5 && (target.y > this.bot.entity.position.y + 0.25 || this.bot.entity.isCollidedHorizontally)) {
        this._setControl('forward', true)
        this._setControl('jump', true)
      }
      return
    }

    this._setControl('forward', true)
    this._updateShoreStrafe()
  }

  _updateShoreStrafe () {
    const settings = this.settings
    const now = Date.now()
    const pos = this.bot.entity.position
    const moved = this._swimLastPos ? pos.distanceTo(this._swimLastPos) : 0

    if (moved >= 0.15) {
      this._swimLastPos = pos.clone()
      this._swimProgressAt = now
      if (now >= this._strafeUntil) {
        this._setControl('left', false)
        this._setControl('right', false)
      }
    }

    const strafeAfter = Number(settings.shoreStrafeAfterMs) || 0
    if (strafeAfter <= 0) return

    if (now < this._strafeUntil) return
    if (now - this._swimProgressAt < strafeAfter && !this.bot.entity.isCollidedHorizontally) return

    this._swimProgressAt = now
    this._strafeSide = -this._strafeSide
    this._strafeUntil = now + (Number(settings.strafeMs) || 800)
    this._setControl('left', this._strafeSide < 0)
    this._setControl('right', this._strafeSide > 0)
    this._setControl('jump', true)
    this._setControl('forward', true)
  }

  _stopSteering () {
    this._setControl('forward', false)
    this._setControl('left', false)
    this._setControl('right', false)
  }

  _tickApproach () {
    const approach = this._approach
    if (!approach) return

    if (this.paused) {
      this._stopSteering()
      this._setControl('jump', false)
      return
    }

    const now = Date.now()
    const timeoutMs = Number(this.settings.approachTimeoutMs) || 4000
    if (now - approach.startedAt > timeoutMs) {
      this.logger?.debug('Pendekatan air timeout')
      this._finishApproach(false)
      return
    }

    const pos = this.bot.entity.position
    if (!approach.lastPos || pos.distanceTo(approach.lastPos) >= 0.2) {
      approach.lastPos = pos.clone()
      approach.lastProgressAt = now
    } else if (now - approach.lastProgressAt > timeoutMs) {
      this.logger?.debug('Pendekatan air tidak ada progres')
      this._finishApproach(false)
      return
    }

    const horizontal = Math.hypot(approach.point.x - pos.x, approach.point.z - pos.z)
    if (horizontal <= 1) {
      this._finishApproach(false)
      return
    }

    this._steerToward(approach.point)
    this._setControl('forward', true)
    this._setControl('jump', Boolean(this.bot.entity.isCollidedHorizontally))
  }

  async approach (point) {
    if (!point || this.busy) return false
    if (!this.canApproach(point)) return false

    this.approaching = true
    this._approach = {
      point: point.clone ? point.clone() : point,
      startedAt: Date.now(),
      lastPos: null,
      lastProgressAt: Date.now()
    }
    this.logger?.info('Mencoba mendekati air menuju owner')

    return await new Promise(resolve => {
      this._approachResolve = resolve
      const timeout = (Number(this.settings.approachTimeoutMs) || 4000) + 1000
      this._approachTimer = setTimeout(() => this._finishApproach(false), timeout)
      this._approachTimer.unref?.()
    })
  }

  _finishApproach (ok) {
    if (this._approachTimer) {
      clearTimeout(this._approachTimer)
      this._approachTimer = null
    }
    this.approaching = false
    this._approach = null
    this._stopSteering()
    if (!this.active) this._setControl('jump', false)
    const resolve = this._approachResolve
    this._approachResolve = null
    if (resolve) resolve(ok)
  }

  canApproach (point) {
    if (!point || this.active || this.approaching) return false
    if (!this.enabled || this.settings.approachFromShore === false) return false
    if (!this.bot.entity || this.bot.entity.isInWater) return false

    const mcData = this.mcData
    if (!mcData) return false

    const pos = this.bot.entity.position
    const dx = point.x - pos.x
    const dz = point.z - pos.z
    const distance = Math.hypot(dx, dz)
    const maxDistance = Number(this.settings.approachScanDistance) || 16
    if (distance <= 1) return false

    const stepX = dx / distance
    const stepZ = dz / distance
    const maxSteps = Math.min(Math.ceil(distance), maxDistance)
    let blocked = 0

    for (let step = 1; step <= maxSteps; step++) {
      const x = Math.floor(pos.x + stepX * step)
      const z = Math.floor(pos.z + stepZ * step)
      const feetY = Math.floor(pos.y)
      const feet = this.bot.blockAt(new Vec3(x, feetY, z))
      const head = this.bot.blockAt(new Vec3(x, feetY + 1, z))
      const below = this.bot.blockAt(new Vec3(x, feetY - 1, z))

      for (const block of [feet, head, below]) {
        if (!block) continue
        if (isLiquidName(block.name, LAVA_NAMES)) return false
        if (isLiquidName(block.name, WATER_NAMES)) return true
      }

      const solid = block => block && block.boundingBox === 'block' && !block.name.includes('water')
      if (solid(feet) && solid(head)) {
        blocked++
        if (blocked >= 3) break
      } else {
        blocked = 0
      }
    }

    return false
  }

  _steerToward (point) {
    const now = Date.now()
    const updateMs = Number(this.settings.updateMs) || 250
    if (now - this._lastLookAt < updateMs) return
    this._lastLookAt = now

    const pos = this.bot.entity.position
    const dx = point.x - pos.x
    const dz = point.z - pos.z
    if (Math.abs(dx) < 0.001 && Math.abs(dz) < 0.001) return

    const yaw = Math.atan2(-dx, -dz)
    try {
      const result = this.bot.look(yaw, 0, true)
      if (result?.catch) result.catch(() => {})
    } catch {}
  }

  _setControl (name, value) {
    try {
      this.bot.setControlState(name, value)
    } catch {}
  }

  setPaused (value) {
    this.paused = Boolean(value)
    if (this.paused) {
      this._stopSteering()
      this._setControl('sprint', false)
      if (this.active && this.antiDrown) this._setControl('jump', true)
      else this._setControl('jump', false)
    }
  }

  async waitUntilExit (timeoutMs = Number(this.settings.timeoutMs) || 120000) {
    const startedAt = Date.now()
    while (this.busy && Date.now() - startedAt < timeoutMs) {
      await sleep(100)
    }
    return !this.busy
  }

  destroy () {
    this._destroyed = true
    this.bot.removeListener('physicsTick', this._onPhysicsTick)
    if (this._approachTimer) clearTimeout(this._approachTimer)
    this._approachTimer = null
    const resolve = this._approachResolve
    this._approachResolve = null
    if (resolve) resolve(false)
    this.active = false
    this.approaching = false
  }
}

module.exports = { WaterNavigator, WATER_NAMES, LAVA_NAMES }
