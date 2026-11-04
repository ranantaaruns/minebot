'use strict'

const Vec3 = require('vec3')
const { goals } = require('mineflayer-pathfinder')
const { sleep, withTimeout } = require('../util/async')
const { bestWeapon } = require('./combat')
const { applyMovements } = require('../movements')
const { findSafeSpot, isStandable } = require('./lava')

const ARROW_NAMES = new Set(['arrow', 'spectral_arrow', 'tipped_arrow'])
const BOW_SCORES = { bow: 10, crossbow: 8 }

// Nilai fisika panah Minecraft (per tick): kecepatan tarikan penuh ~3 blok/tick,
// gravitasi ~0.05 blok/tick^2. Dipakai untuk memprediksi titik bidik.
const ARROW_SPEED = 3
const ARROW_GRAVITY = 0.05

const REASON_TEXT = {
  killed: 'target mati',
  'not-found': 'player tidak ditemukan di server',
  'not-ready': 'bot belum siap (belum spawn)',
  self: 'tidak bisa menyerang bot sendiri',
  lost: 'target hilang dari pandangan',
  timeout: 'waktu habis sebelum target mati',
  unreachable: 'target tidak terjangkau',
  cancelled: 'dibatalkan'
}

function reasonText (reason) {
  return REASON_TEXT[reason] || reason || 'tidak diketahui'
}

function bareName (name) {
  return String(name || '').replace(/^minecraft:/, '').toLowerCase()
}

function findPlayer (bot, name) {
  const wanted = bareName(name)
  if (!wanted) return { player: null, entity: null }

  let player = null
  for (const [username, entry] of Object.entries(bot?.players || {})) {
    if (String(username).toLowerCase() !== wanted) continue
    player = entry
    if (entry?.entity) return { player: entry, entity: entry.entity }
  }

  for (const entity of Object.values(bot?.entities || {})) {
    if (!entity || entity === bot?.entity) continue
    if (String(entity.username || '').toLowerCase() === wanted) return { player, entity }
  }

  return { player, entity: null }
}

function arrowCount (bot) {
  let total = 0
  for (const item of bot?.inventory?.items?.() || []) {
    if (ARROW_NAMES.has(bareName(item.name))) total += Number(item.count) || 0
  }
  return total
}

function bestBow (bot) {
  let best = null
  for (const item of bot?.inventory?.items?.() || []) {
    const score = BOW_SCORES[bareName(item.name)]
    if (!score) continue
    if (!best || score > best.score) best = { item, score }
  }
  return best
}

function aimPoint (entity, distance) {
  const position = entity?.position || new Vec3(0, 0, 0)
  const velocity = entity?.velocity || { x: 0, y: 0, z: 0 }
  const ticks = Math.max(0, Number(distance) || 0) / ARROW_SPEED
  const drop = 0.5 * ARROW_GRAVITY * ticks * ticks
  const height = Number(entity?.height) || 1.8

  return new Vec3(
    position.x + (Number(velocity.x) || 0) * ticks,
    position.y + height * 0.8 + (Number(velocity.y) || 0) * ticks + drop,
    position.z + (Number(velocity.z) || 0) * ticks
  )
}

class PlayerHunter {
  constructor (bot, config, logger) {
    this.bot = bot
    this.logger = logger
    const combat = config?.combat || {}
    this.attackCooldownMs = Number(combat.attackCooldownMs) || 650
    this.settings = {
      meleeRange: 3.2,
      bowRange: 24,
      drawMs: 1000,
      tickMs: 250,
      timeoutMs: 180000,
      approachRefreshMs: 800,
      maxNoPath: 3,
      retreatEnabled: true,
      retreatHealth: 10,
      retreatResumeHealth: 16,
      retreatDistance: 12,
      retreatRadius: 14,
      retreatHealTimeoutMs: 45000,
      ...(combat.hunt || {})
    }

    this.nextAttackAt = 0
    this.nextShotAt = 0
    this.nextApproachAt = 0
    this.noPathCount = 0
    this.retreating = false
  }

  async hunt (name, cancellation) {
    const target = String(name || '').trim()
    if (!target) throw new Error('Gunakan: attack <nama player>')

    const stats = { hits: 0, shots: 0, startedAt: Date.now() }
    if (!this.bot?.entity) return this._result(target, stats, 'not-ready')
    if (target.toLowerCase() === String(this.bot.username || '').toLowerCase()) {
      return this._result(target, stats, 'self')
    }

    const initial = findPlayer(this.bot, target)
    if (!initial.player && !initial.entity) return this._result(target, stats, 'not-found')

    let dead = false
    const wanted = target.toLowerCase()
    const onDead = entity => {
      if (!entity) return
      if (entity === initial.entity || String(entity.username || '').toLowerCase() === wanted) dead = true
    }
    const onPath = results => {
      if (results?.status === 'noPath') this.noPathCount++
    }

    this.bot.on?.('entityDead', onDead)
    this.bot.on?.('path_update', onPath)
    this.noPathCount = 0
    this.nextAttackAt = 0
    this.nextShotAt = 0
    this.nextApproachAt = 0

    const timeoutMs = Number(this.settings.timeoutMs) || 0
    const deadline = timeoutMs > 0 ? Date.now() + timeoutMs : Infinity

    try {
      await this._equipArmor()
      this.logger?.info(`Mulai menyerang ${target}`)
      return await this._loop(target, stats, cancellation, deadline, () => dead)
    } finally {
      this._stopPath()
      try { this.bot.removeListener?.('entityDead', onDead) } catch {}
      try { this.bot.removeListener?.('path_update', onPath) } catch {}
    }
  }

  async _loop (target, stats, cancellation, deadline, isDead) {
    while (true) {
      cancellation?.throwIfCancelled?.()
      if (isDead()) return this._result(target, stats, 'killed', true)
      if (Date.now() > deadline) return this._result(target, stats, 'timeout')
      if (this.noPathCount >= Number(this.settings.maxNoPath || 3)) {
        return this._result(target, stats, 'unreachable')
      }

      const entity = findPlayer(this.bot, target).entity
      if (!entity) {
        // Entitas bisa hilang karena mati (event entityDead) atau keluar jangkauan.
        if (!isDead()) await sleep(150, cancellation)
        return this._result(target, stats, isDead() ? 'killed' : 'lost', isDead())
      }
      if (typeof entity.health === 'number' && entity.health <= 0) {
        return this._result(target, stats, 'killed', true)
      }

      // Darah sekarat: mundur dulu, makan sampai pulih, baru lanjut menyerang.
      if (this._shouldRetreat()) {
        await this._retreat(entity, stats, cancellation)
        continue
      }

      const distance = this.bot.entity.position.distanceTo(entity.position)

      if (distance <= Number(this.settings.meleeRange)) {
        this._stopPath()
        if (await this.attackMelee(entity, distance)) stats.hits++
      } else if (this._bowReady() && distance <= Number(this.settings.bowRange)) {
        this._stopPath()
        if (await this.shoot(entity, distance, cancellation)) stats.shots++
      } else {
        this._approach(entity)
      }

      await sleep(Number(this.settings.tickMs) || 250, cancellation)
    }
  }

  _health () {
    const raw = this.bot?.health
    if (raw === undefined || raw === null) return NaN
    return Number(raw)
  }

  _shouldRetreat () {
    if (this.settings.retreatEnabled === false) return false
    const health = this._health()
    if (!Number.isFinite(health)) return false
    if (this.retreating) return health < Number(this.settings.retreatResumeHealth)
    return health <= Number(this.settings.retreatHealth)
  }

  async _retreat (entity, stats, cancellation) {
    const health = this._health()
    if (!this.retreating) {
      this.retreating = true
      stats.retreats = (stats.retreats || 0) + 1
      this.logger?.warn(`Darah rendah (${health}); mundur mencari tempat aman untuk heal`)
    }

    this._stopPath()
    try {
      const spot = this._findRetreatSpot(entity)
      if (spot) {
        await this._moveTo(spot)
      } else {
        this._keepDistance(entity)
      }

      await this._heal(cancellation)

      if (this._health() >= Number(this.settings.retreatResumeHealth)) {
        this.retreating = false
        this.logger?.info(`Darah pulih (${this._health()}); lanjut menyerang`)
        this._stopPath()
      }
    } catch (err) {
      if (err?.cancelled) throw err
      this.logger?.debug(`Retreat gagal: ${err.message}`)
    }
  }

  _findRetreatSpot (entity) {
    try {
      return findSafeSpot(this.bot, {
        radius: Number(this.settings.retreatRadius) || 14,
        from: entity?.position || null,
        minDistance: Number(this.settings.retreatDistance) || 0
      })
    } catch (err) {
      this.logger?.debug(`Gagal mencari tempat aman: ${err.message}`)
      return null
    }
  }

  async _moveTo (spot) {
    if (!spot) return false
    if (isStandable(this.bot, spot) && this.bot.entity.position.distanceTo(spot) < 1.5) return true
    const timeoutMs = Math.max(1000, Number(this.settings.retreatMoveTimeoutMs) || 12000)
    try {
      if (typeof this.bot.pathfinder?.goto === 'function') {
        await withTimeout(
          this.bot.pathfinder.goto(new goals.GoalBlock(spot.x, spot.y, spot.z)),
          timeoutMs,
          'Mundur ke tempat aman timeout'
        )
        return true
      }
      this.bot.pathfinder?.setGoal?.(new goals.GoalBlock(spot.x, spot.y, spot.z), true)
      return true
    } catch (err) {
      this.logger?.debug(`Gagal mundur ke tempat aman: ${err.message}`)
      return false
    }
  }

  // Kalau tidak ada blok aman, minimal jaga jarak supaya tidak dipukul terus.
  _keepDistance (entity) {
    if (!entity) return
    const distance = Number(this.settings.retreatDistance) || 12
    try {
      this.bot.pathfinder?.setGoal?.(new goals.GoalInvert(new goals.GoalFollow(entity, distance)), true)
    } catch (err) {
      this.logger?.debug(`Gagal menjaga jarak: ${err.message}`)
    }
  }

  async _heal (cancellation) {
    const resumeAt = Number(this.settings.retreatResumeHealth)
    const deadline = Date.now() + (Number(this.settings.retreatHealTimeoutMs) || 45000)
    const food = this.bot.foodManager

    while (Date.now() < deadline) {
      cancellation?.throwIfCancelled?.()
      const health = this._health()
      if (!Number.isFinite(health) || health >= resumeAt) return true

      if (Number(this.bot.food) < 20) {
        const choice = typeof food?.pickFood === 'function' ? food.pickFood() : null
        if (!choice) {
          this.logger?.warn('Tidak ada makanan untuk heal; tetap menjauh dari target')
          return false
        }
        try {
          await withTimeout(this.bot.equip(choice.item, 'hand'), 2000, 'Equip makanan timeout')
          await withTimeout(this.bot.consume(), 5000, 'Makan timeout')
          this.logger?.info(`Makan ${choice.item.name} saat retreat (health=${this._health()})`)
        } catch (err) {
          if (err?.cancelled) throw err
          this.logger?.debug(`Gagal makan saat retreat: ${err.message}`)
        }
      }

      await sleep(500, cancellation)
    }

    return this._health() >= resumeAt
  }

  _bowReady () {
    return Boolean(bestBow(this.bot)) && arrowCount(this.bot) > 0
  }

  async _equipArmor () {
    try {
      await this.bot.combatManager?.maybeUpgradeArmor?.(true)
    } catch (err) {
      this.logger?.debug(`Equip armor gagal: ${err.message}`)
    }
  }

  async equipMelee () {
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

  async attackMelee (entity, distance) {
    const now = Date.now()
    if (now < this.nextAttackAt) return false
    if (distance > Number(this.settings.meleeRange) + 0.6) return false
    if (!await this.equipMelee()) return false

    this.nextAttackAt = now + this.attackCooldownMs
    try {
      const height = (Number(entity.height) || 1.8) * 0.8
      await this.bot.lookAt(entity.position.offset(0, height, 0), true)
      this.bot.attack(entity)
      return true
    } catch (err) {
      this.logger?.debug(`Serangan gagal: ${err.message}`)
      return false
    }
  }

  async shoot (entity, distance, cancellation) {
    const now = Date.now()
    if (now < this.nextShotAt) return false
    const bow = bestBow(this.bot)
    if (!bow || arrowCount(this.bot) <= 0) return false

    const drawMs = Math.max(50, Number(this.settings.drawMs) || 1000)
    this.nextShotAt = now + drawMs + 150

    try {
      if (this.bot.heldItem?.type !== bow.item.type) {
        await withTimeout(this.bot.equip(bow.item, 'hand'), 2000, 'Equip bow timeout')
      }
      await this.bot.lookAt(aimPoint(entity, distance), true)
      this.bot.activateItem()
      await sleep(drawMs, cancellation)
      await this.bot.lookAt(aimPoint(entity, distance), true)
      this.bot.deactivateItem()
      return true
    } catch (err) {
      try { this.bot.deactivateItem() } catch {}
      if (err?.cancelled) throw err
      this.logger?.debug(`Memanah gagal: ${err.message}`)
      return false
    }
  }

  _approach (entity) {
    const now = Date.now()
    if (now < this.nextApproachAt) return
    this.nextApproachAt = now + (Number(this.settings.approachRefreshMs) || 800)
    const range = Math.max(1, Number(this.settings.meleeRange) - 1)
    try {
      this.bot.pathfinder?.setGoal?.(new goals.GoalFollow(entity, range), true)
    } catch (err) {
      this.logger?.debug(`Gagal mendekati target: ${err.message}`)
    }
  }

  _stopPath () {
    try { this.bot.pathfinder?.stop?.() } catch {}
    this.nextApproachAt = 0
  }

  _result (target, stats, reason, killed = false) {
    return {
      ok: killed,
      killed,
      target,
      reason,
      hits: stats.hits,
      shots: stats.shots,
      retreats: stats.retreats || 0,
      durationMs: Date.now() - stats.startedAt
    }
  }
}

function logHuntResult (logger, result) {
  if (!result || result.cancelled) return
  const seconds = ((result.durationMs || 0) / 1000).toFixed(1)
  if (result.killed) {
    logger?.info(`Target ${result.target} mati (${result.hits} pukulan, ${result.shots} panah, ${seconds}s)`)
  } else {
    logger?.warn(`Gagal membunuh ${result.target}: ${reasonText(result.reason)} (${seconds}s)`)
  }
}

async function startHuntJob (session, target, options = {}) {
  const name = String(target || '').trim()
  if (!name) throw new Error('Gunakan: attack <nama player>')

  const bot = session?.bot
  if (!bot) throw new Error('Bot belum terhubung ke server')
  if (!bot.entity) throw new Error('Bot belum spawn / belum login')
  if (!session.jobs) throw new Error('Job manager belum siap')
  if (session.jobs.busy) throw new Error(`Masih ada job: ${session.jobs.name}. Jalankan "stop" dulu.`)

  const config = options.config || session.config || {}
  const logger = options.logger || session.logger

  return session.jobs.run('attack', async cancellation => {
    session.owner?.pause()
    const combatManager = bot.combatManager
    const wasEnabled = combatManager?.enabled
    // CombatManager otomatis bisa menukar senjata saat kita sedang memanah.
    if (combatManager) combatManager.enabled = false

    try {
      const hunter = new PlayerHunter(bot, config, logger)
      const result = await hunter.hunt(name, cancellation)
      logHuntResult(logger, result)
      return result
    } finally {
      if (combatManager) combatManager.enabled = wasEnabled
      try { bot.pathfinder?.stop?.() } catch {}
      try { applyMovements(bot, 'travel', config.owner) } catch {}
      session.owner?.resume()
    }
  })
}

module.exports = {
  PlayerHunter,
  findPlayer,
  aimPoint,
  arrowCount,
  bestBow,
  reasonText,
  logHuntResult,
  startHuntJob
}
