'use strict'

const { goals } = require('mineflayer-pathfinder')
const Vec3 = require('vec3')
const { sleep, withTimeout } = require('./util/async')
const { applyMovements } = require('./movements')
const { isNether, findNearbyPortal } = require('./safety/nether')

const STUCK_MOVEMENT_THRESHOLD = 0.25

function parseCoordinates (text) {
  if (!text) return null
  const raw = String(text).replace(/§./g, '')

  const keyed = raw.match(/x\s*[:=]?\s*(-?\d+(?:\.\d+)?)\D{1,12}y\s*[:=]?\s*(-?\d+(?:\.\d+)?)\D{1,12}z\s*[:=]?\s*(-?\d+(?:\.\d+)?)/i)
  if (keyed) {
    return new Vec3(Number(keyed[1]), Number(keyed[2]), Number(keyed[3]))
  }

  const plain = raw.match(/(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)/)
  if (plain) {
    return new Vec3(Number(plain[1]), Number(plain[2]), Number(plain[3]))
  }

  return null
}

function isStuck (position, lastPosition, lastProgressAt, now, timeoutMs, minMovement = STUCK_MOVEMENT_THRESHOLD) {
  if (!position || !lastPosition) return false
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return false
  if (now - lastProgressAt < timeoutMs) return false
  return position.distanceTo(lastPosition) < minMovement
}

class OwnerTracker {
  constructor (bot, config, logger, options = {}) {
    this.bot = bot
    this.config = config
    this.logger = logger
    const opts = options || {}
    this.towerSupply = opts.towerSupply || null
    this.waterNavigator = opts.waterNavigator || null
    this.ladderNavigator = opts.ladderNavigator || null
    this.structureAvoidance = opts.structureAvoidance || bot.structureAvoidance || null
    this.portalFollowBusy = false
    this.paused = false
    this.stopped = false
    this.commanding = false
    this.recovering = false
    this.foodPaused = false
    this.noPathBusy = false
    this.target = null
    this.pathing = false
    this.lastAskAt = 0
    this.lastOwnerPos = null
    this.interval = null
    this.lastProgressPos = null
    this.lastProgressAt = 0
    this.stuckRetries = 0
    this.stuckCooldownUntil = 0
    this.lastProgressDistance = null
    this.towerGathering = false
    this.towerAttempts = 0
    this.towerCooldownUntil = 0

    this._onPathUpdate = results => {
      if (results?.status !== 'noPath') return
      if (this.commanding) return
      this.logger.debug('Path tidak ditemukan; memeriksa air dan kebutuhan tower')
      this._handleNoPath().catch(err => {
        this.logger.debug(`Penanganan noPath gagal: ${err.message}`)
      })
    }

    this._onChat = (username, message) => {
      if (username !== config.username) return
      const coords = parseCoordinates(message)
      if (coords) {
        this.setTarget(coords)
        this.logger.info(`Owner mengirim koordinat: ${coords.x} ${coords.y} ${coords.z}`)
      }
    }
    this._onWhisper = this._onChat

    bot.on('chat', this._onChat)
    bot.on('whisper', this._onWhisper)
    bot.on('path_update', this._onPathUpdate)
  }

  start () {
    if (this.interval) return
    this.interval = setInterval(() => this.tick().catch(err => {
      this.logger.debug(`Follow error: ${err.message}`)
    }), 2000)
    this.interval.unref?.()
  }

  pause () {
    this.paused = true
    this._cancelFollowGoal()
  }

  resume () {
    this.paused = false
  }

  holdForFood () {
    this.foodPaused = true
    this._cancelFollowGoal()
  }

  releaseFoodHold () {
    if (!this.foodPaused) return
    this.foodPaused = false
    if (this.stopped || this.paused || this.commanding || this.towerGathering) return
    if (this.waterNavigator?.busy) return
    const point = this._currentPoint()
    if (!point || !this.bot.entity) return
    if (this.bot.entity.position.distanceTo(point) > this.config.followDistance + 1) {
      this._startFollowGoal(point)
    }
  }

  onWaterEnter () {
    if (!this.paused) this._cancelFollowGoal()
  }

  onWaterExit () {
    this._resetProgress()
    if (this.stopped || this.paused || this.foodPaused || this.commanding || this.towerGathering) return
    const point = this._currentPoint()
    if (!point || !this.bot.entity) return
    if (this.bot.entity.position.distanceTo(point) > this.config.followDistance + 1) {
      this._startFollowGoal(point)
    }
  }

  _foodBusy () {
    const manager = this.bot.foodManager
    return Boolean(this.foodPaused || manager?.waitingForFood || manager?.eating || manager?.pending)
  }

  async _waitForFood (timeoutMs = 120000) {
    const startedAt = Date.now()
    while (this._foodBusy() && Date.now() - startedAt < timeoutMs) {
      await sleep(250)
    }
    return !this._foodBusy()
  }

  async _handleNoPath () {
    if (this.noPathBusy || this.stopped || this.paused || this.commanding) return
    if (this.recovering || this.towerGathering || this.foodPaused) return
    if (this.ladderNavigator?.busy || this.ladderNavigator?.isOnLadder?.()) return
    if (this.bot.foodManager?.shouldYield?.()) return
    if (this.waterNavigator?.busy) return

    this.noPathBusy = true
    try {
      const point = this._currentPoint()
      if (!point || !this.bot.entity) return

      if (this.ladderNavigator?.isLadderNearby?.(point)) {
        this.logger.debug('Ada ladder di dekat bot/tujuan, membatalkan tower supply')
        return
      }

      if (this.waterNavigator) {
        try {
          if (this.waterNavigator.canApproach(point)) {
            const reachedWater = await this.waterNavigator.approach(point)
            if (reachedWater) return
            if (this.stopped || this.paused || this.commanding || this.foodPaused) return
            if (this.waterNavigator.busy) return
          }
        } catch (err) {
          this.logger.debug(`Pendekatan air gagal: ${err.message}`)
        }
      }

      await this._tryTowerSupply()
    } finally {
      this.noPathBusy = false
    }
  }

  stop () {
    this.stopped = true
    this.commanding = false
    if (this.interval) clearInterval(this.interval)
    this.interval = null
    this.bot.removeListener('chat', this._onChat)
    this.bot.removeListener('whisper', this._onWhisper)
    this.bot.removeListener('path_update', this._onPathUpdate)
    this._cancelFollowGoal()
    try { this.bot.pathfinder?.stop() } catch {}
  }

  setTarget (coords) {
    this.target = coords ? new Vec3(coords.x, coords.y, coords.z) : null
    this.towerAttempts = 0
    this.towerCooldownUntil = 0
  }

  getOwnerEntity () {
    const targetName = String(this.config.username || '').toLowerCase()
    if (!targetName) return null

    for (const [name, player] of Object.entries(this.bot.players || {})) {
      if (name.toLowerCase() === targetName && player?.entity) return player.entity
    }

    for (const entity of Object.values(this.bot.entities || {})) {
      if (entity?.username?.toLowerCase() === targetName && entity !== this.bot.entity) return entity
    }
    return null
  }

  _currentPoint () {
    const entity = this.getOwnerEntity()
    if (entity) return entity.position.clone()
    return this.target ? this.target.clone() : null
  }

  _resetProgress () {
    this.lastProgressPos = this.bot.entity ? this.bot.entity.position.clone() : null
    this.lastProgressAt = Date.now()
    const point = this._currentPoint()
    this.lastProgressDistance = point && this.bot.entity
      ? this.bot.entity.position.distanceTo(point)
      : null
  }

  _applyFollowMovements (point) {
    if (!this.bot.registry || !this.bot.inventory) return
    try {
      applyMovements(this.bot, 'follow', { ...this.config, surfaceTarget: point })
    } catch (err) {
      this.logger.debug(`Gagal menyiapkan movements follow: ${err.message}`)
    }
  }

  _startFollowGoal (point) {
    if (!this.bot.pathfinder || !this.bot.entity) return
    const range = Number(this.config.followDistance) || 3
    try {
      this._applyFollowMovements(point)
      this.bot.pathfinder.setGoal(new goals.GoalNear(point.x, point.y, point.z, range))
      this._resetProgress()
    } catch (err) {
      this.logger.debug(`Gagal membuat follow goal: ${err.message}`)
    }
  }

  _cancelFollowGoal () {
    if (this.bot.pathfinder?.goal) {
      try { this.bot.pathfinder.setGoal(null) } catch {}
    } else {
      try { this.bot.clearControlStates?.() } catch {}
    }
    this._resetProgress()
  }

  _checkStuck () {
    if (this.recovering || this.towerGathering || this.foodPaused || !this.bot.entity) return
    if (this.waterNavigator?.busy || this.ladderNavigator?.busy || this.ladderNavigator?.climbing || this.ladderNavigator?.isOnLadder?.()) return
    if (this.bot.pathfinder?.isBuilding?.() || this.bot.pathfinder?.isMining?.()) return
    if (!this.lastProgressPos) {
      this._resetProgress()
      return
    }

    const now = Date.now()
    const position = this.bot.entity.position
    const point = this._currentPoint()
    const distance = point ? position.distanceTo(point) : null
    if (distance !== null && (this.lastProgressDistance === null || distance < this.lastProgressDistance - 0.5)) {
      this.stuckRetries = 0
      this.lastProgressDistance = distance
      this.lastProgressPos = position.clone()
      this.lastProgressAt = now
      return
    }

    const moved = position.distanceTo(this.lastProgressPos)
    if (moved >= STUCK_MOVEMENT_THRESHOLD) {
      this.lastProgressPos = position.clone()
      this.lastProgressAt = now
      return
    }

    const timeoutMs = Number(this.config.stuckTimeoutMs)
    if (!isStuck(
      this.bot.entity.position,
      this.lastProgressPos,
      this.lastProgressAt,
      now,
      Number.isFinite(timeoutMs) ? timeoutMs : 4000
    )) return

    this._recoverFromStuck().catch(err => {
      this.logger.debug(`Recovery follow gagal: ${err.message}`)
    })
  }

  async _nudge () {
    if (!this.config.unstickJump || !this.bot.entity?.onGround) return
    try {
      this.bot.setControlState('back', true)
      this.bot.setControlState('jump', true)
      await sleep(180)
    } finally {
      this.bot.setControlState('jump', false)
      this.bot.setControlState('back', false)
    }
  }

  async _recoverFromStuck () {
    if (this.recovering || this.towerGathering || this.stopped || this.paused || this.commanding) return
    if (this.foodPaused || this.waterNavigator?.busy) return
    this.recovering = true
    this.stuckRetries++
    const position = this.bot.entity?.position
    const where = position ? `${position.x.toFixed(1)} ${position.y.toFixed(1)} ${position.z.toFixed(1)}` : '-'
    this.logger.warn(`Follow macet di ${where}; menghitung ulang rute (${this.stuckRetries})`)

    try {
      this._cancelFollowGoal()
      this.bot.clearControlStates?.()
      await this._nudge()
      await sleep(400)

      if (this.stopped || this.paused || this.commanding || this.foodPaused || this.waterNavigator?.busy) return

      const maxRetries = Number.isFinite(Number(this.config.maxStuckRetries))
        ? Number(this.config.maxStuckRetries)
        : 2
      if (this.stuckRetries > maxRetries) {
        const cooldown = Number(this.config.stuckCooldownMs) || 10000
        this.stuckCooldownUntil = Date.now() + cooldown
        this.logger.warn(`Follow masih macet; berhenti sementara ${(cooldown / 1000).toFixed(0)} detik`)
        return
      }

      const point = this._currentPoint()
      if (point) this._startFollowGoal(point)
    } finally {
      this.recovering = false
      this._resetProgress()
    }
  }

  async _tryTowerSupply () {
    if (this.stopped || this.paused || this.commanding || this.recovering || this.towerGathering) return
    if (this.foodPaused || this.waterNavigator?.busy || this.ladderNavigator?.busy) return
    if (this.ladderNavigator?.isOnLadder?.()) return
    if (this.bot.foodManager?.shouldYield?.()) return
    if (this.bot.entity?.isInWater) return
    if (!this.towerSupply || this.config.allowTower === false) return

    const settings = this.config.towerGather || {}
    if (settings.enabled === false) return
    if (this.towerCooldownUntil) {
      if (Date.now() < this.towerCooldownUntil) return
      this.towerCooldownUntil = 0
      this.towerAttempts = 0
    }

    const point = this._currentPoint()
    if (!point || !this.bot.entity) return
    const gap = point.y - this.bot.entity.position.y
    if (gap < (Number(settings.minGap) || 2)) return

    if (this.ladderNavigator?.isLadderNearby?.(point)) {
      this.logger.debug('Ada ladder di dekat bot/tujuan, membatalkan tower supply')
      return
    }

    const maxAttempts = Number(settings.maxAttempts) || 3
    if (this.towerAttempts >= maxAttempts) {
      const cooldown = Number(settings.cooldownMs) || 30000
      this.towerCooldownUntil = Date.now() + cooldown
      this._cancelFollowGoal()
      this.logger.warn(`Tower belum cukup setelah ${maxAttempts} percobaan; berhenti sementara ${(cooldown / 1000).toFixed(0)} detik`)
      return
    }

    this.towerGathering = true
    this.towerAttempts++
    this._cancelFollowGoal()
    this.bot.clearControlStates?.()

    try {
      const result = await this.towerSupply.ensure(point)
      if (this.stopped || this.paused || this.commanding || this.foodPaused || this.waterNavigator?.busy) return
      if (!result.ok) {
        this.logger.debug(`Tower supply belum berhasil: ${result.reason || 'blok tidak ditemukan'}`)
        return
      }
      this._startFollowGoal(this._currentPoint() || point)
    } finally {
      this.towerGathering = false
      this._resetProgress()
    }
  }

  async come (coords) {
    if (coords) {
      this.setTarget(coords)
    }
    const entity = this.getOwnerEntity()
    const point = coords ? this.target : (entity ? entity.position : this.target)
    if (!point) {
      return { ok: false, reason: 'owner tidak terlihat dan tidak ada koordinat' }
    }

    if (this.bot.foodManager?.waitingForFood) {
      return { ok: false, reason: 'makanan habis' }
    }
    if (this.foodPaused && !await this._waitForFood(15000)) {
      return { ok: false, reason: 'masih makan' }
    }

    this.commanding = true
    this.towerAttempts = 0
    this.towerCooldownUntil = 0
    this._cancelFollowGoal()
    try {
      if (this.waterNavigator?.busy && !(await this.waterNavigator.waitUntilExit())) {
        return { ok: false, reason: 'renang timeout' }
      }
      const arrived = await this._goto(point, 2)
      if (arrived) this.towerAttempts = 0
      return { ok: arrived }
    } finally {
      this.commanding = false
      this._resetProgress()
    }
  }

  async _goto (point, distance = 2) {
    if (this.pathing) return false
    this.pathing = true

    const settings = this.config.towerGather || {}
    const maxAttempts = Math.max(1, Number(settings.maxAttempts) || 3)
    let foodRetries = 0
    let waterRetries = 0
    let goalRetries = 0
    let towerNoProgress = 0

    try {
      for (let attempt = 0; attempt <= maxAttempts; attempt++) {
        try {
          this._applyFollowMovements(point)
          await this.bot.pathfinder.goto(new goals.GoalNear(point.x, point.y, point.z, distance))
          return true
        } catch (err) {
          this.logger.debug(`Goto gagal: ${err.message}`)
          if (this.stopped) return false

          if (this.foodPaused || this.bot.foodManager?.eating || this.bot.foodManager?.waitingForFood) {
            if (foodRetries++ >= 3) return false
            if (!(await this._waitForFood())) return false
            attempt--
            continue
          }

          if (this.waterNavigator?.busy) {
            if (waterRetries++ >= 3) return false
            if (!(await this.waterNavigator.waitUntilExit())) return false
            attempt--
            continue
          }

          if ((err.name === 'GoalChanged' || err.name === 'PathStopped') && goalRetries++ < 3) {
            await sleep(250)
            attempt--
            continue
          }

          if (err.name !== 'NoPath') return false

          if (this.waterNavigator) {
            let reachedWater = false
            try {
              if (this.waterNavigator.canApproach(point)) {
                reachedWater = await this.waterNavigator.approach(point)
              }
            } catch (waterErr) {
              this.logger.debug(`Pendekatan air gagal: ${waterErr.message}`)
            }
            if (this.foodPaused) {
              if (foodRetries++ >= 3) return false
              if (!(await this._waitForFood())) return false
              attempt--
              continue
            }
            if (this.waterNavigator.busy) {
              if (waterRetries++ >= 3) return false
              if (!(await this.waterNavigator.waitUntilExit())) return false
              attempt--
              continue
            }
            if (reachedWater) {
              attempt--
              continue
            }
          }

          if (!this.towerSupply || this.config.allowTower === false) return false
          if (!this.bot.entity || point.y - this.bot.entity.position.y < (Number(settings.minGap) || 2)) return false
          if (this.ladderNavigator?.isOnLadder?.() || this.ladderNavigator?.isLadderNearby?.(point)) return false
          if (attempt >= maxAttempts) break

          const result = await this.towerSupply.ensure(point)
          if (!result.ok) {
            this.logger.debug(`Tower supply gagal: ${result.reason || 'blok tidak ditemukan'}`)
            return false
          }
          if (result.gathered <= 0) {
            if (towerNoProgress++ >= 1) return false
            attempt--
            continue
          }
        }
      }
      return false
    } finally {
      this.pathing = false
    }
  }

  async tick () {
    if (this.stopped || this.paused || this.commanding || this.towerGathering || this.foodPaused || this.noPathBusy) return
    if (this.bot.foodManager?.shouldYield?.()) return
    if (this.waterNavigator?.busy || !this.bot.entity) return

    if (this.stuckCooldownUntil) {
      if (Date.now() < this.stuckCooldownUntil) return
      this.stuckCooldownUntil = 0
      this.stuckRetries = 0
    }

    if (this.towerCooldownUntil) {
      if (Date.now() < this.towerCooldownUntil) return
      this.towerCooldownUntil = 0
      this.towerAttempts = 0
    }

    // Nether structure avoidance check
    if (isNether(this.bot) && this.structureAvoidance && this.config.avoidStructures !== false) {
      this.structureAvoidance.scan()
      if (this.structureAvoidance.isInsideDangerZone(this.bot.entity.position)) {
        const nearest = this.structureAvoidance.getNearestZone(this.bot.entity.position)
        if (nearest) {
          this.logger.warn(`[Nether] Terlalu dekat dengan struktur ${nearest.type.toUpperCase()} di (${nearest.center.x.toFixed(0)}, ${nearest.center.y.toFixed(0)}, ${nearest.center.z.toFixed(0)})! Menjauh...`)
          await this._retreatFromDanger(nearest)
          return
        }
      }
    }

    // Portal follow check: when owner enters or just disappeared near a nether portal
    if (this.config.portalFollow !== false && !this.portalFollowBusy) {
      const entity = this.getOwnerEntity()
      if (entity) {
        this.lastOwnerPos = entity.position.clone()
        const portalPos = findNearbyPortal(this.bot, entity.position, 2)
        if (portalPos) {
          const dist = this.bot.entity.position.distanceTo(portalPos)
          if (dist < 16) {
            await this.followThroughPortal(portalPos)
            return
          }
        }
      } else if (this.lastOwnerPos) {
        const portalPos = findNearbyPortal(this.bot, this.lastOwnerPos, 3)
        if (portalPos) {
          const dist = this.bot.entity.position.distanceTo(portalPos)
          if (dist < 24) {
            this.logger.info(`Owner masuk ke nether portal di ${portalPos}. Mengikuti masuk portal...`)
            await this.followThroughPortal(portalPos)
            return
          }
        }
      }
    }

    if (!this.config.autoFollow && !this.target) return

    const entity = this.getOwnerEntity()
    if (entity) {
      this.lastOwnerPos = entity.position.clone()
      if (this.target) this.target = null
    }

    const point = entity ? entity.position : this.target
    if (!point) {
      if (this.config.askCoords) {
        const now = Date.now()
        if (now - this.lastAskAt >= this.config.askCoordsIntervalMs) {
          this.lastAskAt = now
          try {
            this.bot.whisper(this.config.username, 'Aku sudah login. Kirim koordinat (x y z) atau chat "come".')
            this.logger.info('Owner belum terlihat, meminta koordinat lewat whisper')
          } catch (err) {
            this.logger.debug(`Gagal whisper owner: ${err.message}`)
          }
        }
      }
      return
    }

    const distance = this.bot.entity.position.distanceTo(point)
    if (distance <= this.config.followDistance + 1) {
      if (!entity) this.target = null
      this.stuckRetries = 0
      this.towerAttempts = 0
      this.towerCooldownUntil = 0
      if (this.bot.pathfinder?.goal) this._cancelFollowGoal()
      return
    }

    if (this.bot.pathfinder?.goal) {
      this._checkStuck()
      return
    }

    this._startFollowGoal(point)
  }

  async followThroughPortal (portalPos, timeoutMs = 20000) {
    if (this.portalFollowBusy || !this.bot?.entity) return false
    this.portalFollowBusy = true
    this._cancelFollowGoal()
    this.logger.info(`Mengikuti owner masuk portal di (${portalPos.x}, ${portalPos.y}, ${portalPos.z})...`)

    const initialDimension = this.bot.game?.dimension
    let changed = false
    const onRespawn = () => { changed = true }
    this.bot.once('respawn', onRespawn)

    try {
      // 1. Move directly into the portal block
      if (this.bot.pathfinder?.goto) {
        try {
          await withTimeout(
            this.bot.pathfinder.goto(new goals.GoalBlock(portalPos.x, portalPos.y, portalPos.z)),
            5000,
            'Menuju portal timeout'
          )
        } catch {}
      }

      // If not yet inside portal, nudge bot toward portal center
      const portalCenter = portalPos.offset(0.5, 0, 0.5)
      if (typeof this.bot.lookAt === 'function' && typeof this.bot.setControlState === 'function') {
        await this.bot.lookAt(portalCenter, true)
        this.bot.setControlState('forward', true)
        await sleep(350)
        this.bot.setControlState('forward', false)
      }

      // 2. Wait inside portal block for dimension change
      const startedAt = Date.now()
      while (Date.now() - startedAt < timeoutMs) {
        if (changed || this.bot.game?.dimension !== initialDimension) break
        await sleep(250)
      }

      // 3. If dimension changed, step out of the portal so we don't accidentally re-teleport
      if (this.bot.game?.dimension !== initialDimension) {
        this.logger.info(`Berhasil berpindah dimensi ke ${this.bot.game?.dimension}! Mengikuti owner kembali...`)
        await sleep(1000)
        await this._stepOutOfPortal()
        this.lastOwnerPos = null
        this._applyFollowMovements(this._currentPoint())
        return true
      }
    } catch (err) {
      this.logger.debug(`Portal follow gagal: ${err.message}`)
    } finally {
      this.bot.removeListener('respawn', onRespawn)
      this.portalFollowBusy = false
      this._resetProgress()
    }
    return false
  }

  async _stepOutOfPortal () {
    if (!this.bot?.entity) return false
    const currentBlock = this.bot.blockAt(this.bot.entity.position.floored())
    if (!currentBlock || (currentBlock.name !== 'nether_portal' && currentBlock.name !== 'portal')) {
      return true
    }

    const offsets = [
      new Vec3(1, 0, 0), new Vec3(-1, 0, 0),
      new Vec3(0, 0, 1), new Vec3(0, 0, -1),
      new Vec3(2, 0, 0), new Vec3(-2, 0, 0),
      new Vec3(0, 0, 2), new Vec3(0, 0, -2)
    ]

    for (const off of offsets) {
      const targetPos = currentBlock.position.plus(off)
      const feet = this.bot.blockAt(targetPos)
      const floor = this.bot.blockAt(targetPos.offset(0, -1, 0))

      if (feet && feet.name !== 'nether_portal' && feet.name !== 'lava' && feet.name !== 'fire') {
        if (floor && floor.boundingBox !== 'empty' && floor.name !== 'lava') {
          try {
            if (this.bot.pathfinder?.goto) {
              await withTimeout(
                this.bot.pathfinder.goto(new goals.GoalBlock(targetPos.x, targetPos.y, targetPos.z)),
                3000,
                'Keluar portal timeout'
              )
            } else if (typeof this.bot.lookAt === 'function' && typeof this.bot.setControlState === 'function') {
              const dest = targetPos.offset(0.5, 0, 0.5)
              await this.bot.lookAt(dest, true)
              this.bot.setControlState('forward', true)
              await sleep(600)
              this.bot.setControlState('forward', false)
            }
            return true
          } catch {}
        }
      }
    }
    return false
  }

  async _retreatFromDanger (zone) {
    if (!this.bot?.entity || !zone) return false
    this._cancelFollowGoal()
    const retreatVec = this.structureAvoidance?.getRetreatVector?.(this.bot) || new Vec3(0, 0, 1)
    const targetPos = this.bot.entity.position.floored().plus(retreatVec.scaled(8).floored())

    try {
      if (this.bot.pathfinder?.goto) {
        await withTimeout(
          this.bot.pathfinder.goto(new goals.GoalNear(targetPos.x, targetPos.y, targetPos.z, 2)),
          5000,
          'Retreat timeout'
        )
        return true
      }
    } catch {}
    return false
  }
}

module.exports = { OwnerTracker, parseCoordinates, isStuck, STUCK_MOVEMENT_THRESHOLD }
