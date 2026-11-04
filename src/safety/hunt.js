'use strict'

const Vec3 = require('vec3')
const { goals } = require('mineflayer-pathfinder')
const { sleep, withTimeout } = require('../util/async')
const { bestWeapon, bestAxe } = require('./combat')
const { applyMovements } = require('../movements')
const { ShieldGuard } = require('./shield')
const { fleeFrom } = require('./flee')
const { jumpCrit, canCrit } = require('./crit')
const { ShieldBreakStrategy } = require('./shieldbreak')

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
      retreatTickMs: 200,
      retreatFleeTimeoutMs: 15000,
      retreatZigzagDeg: 35,
      retreatZigzagMs: 400,
      critEnabled: true,
      critTickMs: 20,
      critRiseTimeoutMs: 250,
      critFallTimeoutMs: 500,
      shieldBreakEnabled: true,
      shieldBreakPunishMs: 5000,
      shieldBreakWindowMs: 1500,
      ...(combat.hunt || {})
    }

    this.nextAttackAt = 0
    this.nextShotAt = 0
    this.nextApproachAt = 0
    this.noPathCount = 0
    this.retreating = false
    this.lastWeapon = 'sword'
    this.axeWarned = false
    this.shield = new ShieldGuard(bot, combat, logger)
    this.shieldBreak = new ShieldBreakStrategy({
      enabled: this.settings.shieldBreakEnabled !== false,
      punishMs: Number(this.settings.shieldBreakPunishMs) || 5000,
      windowMs: Number(this.settings.shieldBreakWindowMs) || 1500
    })
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
    this.lastWeapon = 'sword'
    this.axeWarned = false
    this.shieldBreak.reset()
    this.nextAttackAt = 0
    this.nextShotAt = 0
    this.nextApproachAt = 0

    const timeoutMs = Number(this.settings.timeoutMs) || 0
    const deadline = timeoutMs > 0 ? Date.now() + timeoutMs : Infinity

    try {
      await this._equipArmor()
      this.shield.setTarget(initial.entity)
      this.shield.start()
      this.logger?.info(`Mulai menyerang ${target}`)
      return await this._loop(target, stats, cancellation, deadline, () => dead)
    } finally {
      this._stopPath()
      this.shield.stop()
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
      this.shield.setTarget(entity)
      await this.shield.update(entity, distance)

      if (distance <= Number(this.settings.meleeRange)) {
        this._stopPath()
        if (await this.attackMelee(entity, distance, stats)) stats.hits++
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

  // Darah sekarat: lari menjauh dari target sambil makan, tanpa pathfinding.
  // Jalur dibuat zigzag supaya serangan lawan sering meleset.
  async _retreat (entity, stats, cancellation) {
    const health = this._health()
    const resumeAt = Number(this.settings.retreatResumeHealth) || 16
    if (!this.retreating) {
      this.retreating = true
      stats.retreats = (stats.retreats || 0) + 1
      this.logger?.warn(`Darah rendah (${health}); lari dari ${entity?.username || 'target'} sambil makan`)
    }

    this._stopPath()
    this.shield.stop()

    let eating = null
    let lastEatAt = 0
    try {
      await fleeFrom(this.bot, entity, {
        cancellation,
        logger: this.logger,
        tickMs: Number(this.settings.retreatTickMs) || 200,
        durationMs: Number(this.settings.retreatFleeTimeoutMs) || 15000,
        distance: Number(this.settings.retreatDistance) || 12,
        zigzagDeg: Number(this.settings.retreatZigzagDeg) || 0,
        zigzagMs: Number(this.settings.retreatZigzagMs) || 400,
        // Sprint membatalkan makan, jadi selama mengunyah bot berjalan saja
        // (tetap menjauh dan tetap zigzag, hanya tidak ngebut).
        sprint: () => !eating,
        stopWhen: () => this._health() >= resumeAt,
        onTick: () => {
          if (eating) return
          if (Date.now() - lastEatAt < 500) return
          if (!this._canEatNow()) return
          lastEatAt = Date.now()
          eating = this._eatOnce(cancellation)
            .catch(() => {})
            .finally(() => { eating = null })
        }
      })
    } catch (err) {
      if (err?.cancelled) throw err
      this.logger?.debug(`Lari dari target gagal: ${err.message}`)
    } finally {
      this.shield.setTarget(entity)
      this.shield.start()
    }

    if (this._health() >= resumeAt) {
      this.retreating = false
      this.logger?.info(`Darah pulih (${this._health()}); lanjut menyerang`)
    }
  }

  // Apel emas tetap bisa dimakan walau makanan penuh, dan itu yang dipakai
  // untuk heal saat sekarat.
  _canEatNow () {
    if (Number(this.bot.food) < 20) return true
    return this._itemCount('golden_apple') + this._itemCount('enchanted_golden_apple') > 0
  }

  _itemCount (name) {
    const wanted = String(name).toLowerCase()
    let total = 0
    for (const item of this.bot.inventory?.items?.() || []) {
      if (String(item.name || '').replace(/^minecraft:/, '').toLowerCase() !== wanted) continue
      total += Number(item.count) || 0
    }
    return total
  }

  async _eatOnce (cancellation) {
    const food = this.bot.foodManager
    const choice = typeof food?.pickFood === 'function' ? food.pickFood() : null
    if (!choice) {
      this.logger?.warn('Tidak ada makanan untuk heal; tetap lari dari target')
      return false
    }

    // Penyebab makan gagal saat retreat: bot terus sprint, dan sprint membatalkan
    // makan di Java sehingga paket "selesai makan" tidak pernah datang.
    try { this.bot.setControlState?.('sprint', false) } catch {}
    this.shield.lower()
    this.bot.autoEating = true

    const name = choice.item.name
    const beforeCount = this._itemCount(name)
    const beforeHealth = this._health()

    try {
      for (let attempt = 1; attempt <= 2; attempt++) {
        cancellation?.throwIfCancelled?.()
        try {
          await withTimeout(this.bot.equip(choice.item, 'hand'), 2000, 'Equip makanan timeout')
          await withTimeout(this.bot.consume(), 6000, 'Makan timeout')
          this.logger?.info(`Makan ${name} sambil lari (health=${this._health()})`)
          return true
        } catch (err) {
          if (err?.cancelled) throw err
          // Kadang makanannya benar-benar termakan walau konfirmasi server telat.
          const eaten = this._itemCount(name) < beforeCount || this._health() > beforeHealth
          if (eaten) {
            this.logger?.info(`Makan ${name} sambil lari (health=${this._health()})`)
            return true
          }
          this.logger?.debug(`Gagal makan saat retreat (${attempt}/2): ${err.message}`)
          try { this.bot.deactivateItem?.() } catch {}
          await sleep(120, cancellation)
        }
      }
      return false
    } finally {
      this.bot.autoEating = false
    }
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
    return this.equipWeapon('sword')
  }

  // Kapak hanya untuk mematahkan shield; kalau tidak ada kapak di inventory,
  // kembali ke senjata terbaik supaya bot tidak berhenti menyerang.
  async equipWeapon (kind = 'sword') {
    const items = this.bot.inventory?.items?.() || []
    let best = kind === 'axe' ? bestAxe(items) : bestWeapon(items)
    if (kind === 'axe' && (!best || best.score <= 0)) {
      if (!this.axeWarned) {
        this.axeWarned = true
        this.logger?.warn('Musuh memblok dengan shield, tapi tidak ada kapak di inventory')
      }
      best = bestWeapon(items)
    }
    if (!best || best.score <= 0) return null
    const actual = bestAxe([best.item]) ? 'axe' : 'sword'
    const held = this.bot.heldItem
    if (held && held.type === best.item.type) return actual
    try {
      await withTimeout(this.bot.equip(best.item, 'hand'), 2000, 'Equip senjata timeout')
      return actual
    } catch (err) {
      this.logger?.debug(`Equip senjata gagal: ${err.message}`)
      return null
    }
  }

  async attackMelee (entity, distance, stats = null) {
    const now = Date.now()
    if (now < this.nextAttackAt) return false
    if (distance > Number(this.settings.meleeRange) + 0.6) return false

    // Nilai dulu pukulan sebelumnya: kalau darah lawan tidak turun berarti
    // shield-nya menahan, jadi pukulan berikutnya pakai kapak.
    const verdict = this.shieldBreak.afterAttack(entity, this.lastWeapon, now)
    if (verdict === 'blocked') this.logger?.debug('Serangan ditahan shield musuh')
    if (verdict === 'broke') {
      this.logger?.info('Kapak mematahkan shield musuh; serang dengan pedang selama shield cooldown')
    }

    const weapon = this.shieldBreak.weapon(entity, now)
    if (weapon === 'axe' && this.lastWeapon !== 'axe') {
      this.logger?.info('Musuh memblok dengan shield: pakai kapak untuk mematahkannya')
    }
    const used = await this.equipWeapon(weapon)
    if (!used) return false

    this.nextAttackAt = now + this.attackCooldownMs
    this.shieldBreak.beforeAttack(entity, now)
    this.lastWeapon = used
    try {
      const height = (Number(entity.height) || 1.8) * 0.8
      await this.bot.lookAt(entity.position.offset(0, height, 0), true)
    } catch (err) {
      this.logger?.debug(`Gagal menghadap target: ${err.message}`)
    }

    // Melompat lalu memukul saat jatuh = critical hit. Shield tetap terangkat
    // karena pukulan tangan utama tidak menurunkan block off-hand.
    const crit = await this._jumpCrit(entity)
    if (crit.attacked) {
      if (stats) stats.crits = (stats.crits || 0) + 1
      return true
    }

    try {
      this.bot.attack(entity)
      return true
    } catch (err) {
      this.logger?.debug(`Serangan gagal: ${err.message}`)
      return false
    }
  }

  async _jumpCrit (entity) {
    if (this.settings.critEnabled === false) return { attacked: false, crit: false }
    if (!canCrit(this.bot)) return { attacked: false, crit: false }
    const result = await jumpCrit(this.bot, entity, {
      tickMs: Number(this.settings.critTickMs) || 20,
      riseTimeoutMs: Number(this.settings.critRiseTimeoutMs) || 250,
      fallTimeoutMs: Number(this.settings.critFallTimeoutMs) || 500,
      maxRange: Number(this.settings.meleeRange) + 1.2
    })
    if (result.crit) this.logger?.debug('Critical hit: memukul saat jatuh')
    return result
  }

  async shoot (entity, distance, cancellation) {
    const now = Date.now()
    if (now < this.nextShotAt) return false
    const bow = bestBow(this.bot)
    if (!bow || arrowCount(this.bot) <= 0) return false

    const drawMs = Math.max(50, Number(this.settings.drawMs) || 1000)
    this.nextShotAt = now + drawMs + 150

    try {
      await this.shield.update(entity, distance, { needsHand: true })
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
      crits: stats.crits || 0,
      breaks: this.shieldBreak.stats.breaks,
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
    logger?.info(`Target ${result.target} mati (${result.hits} pukulan, ${result.crits || 0} kritikal, ${result.shots} panah, ${seconds}s)`)
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
