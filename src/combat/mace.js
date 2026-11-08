'use strict'

const Vec3 = require('vec3')
const { nextTick } = require('./tick')
const { TAGS } = require('./loadout')

// Jendela peluncuran vertical smash.
function inLaunchWindow (options = {}) {
  const {
    distance = Infinity, dy = 0, blocking = false,
    mace = false, ammo = 0,
    minRange = 4, maxRange = 10, minDy = -1, maxDy = 2
  } = options
  if (!mace || ammo <= 0 || blocking) return false
  return distance >= minRange && distance <= maxRange && dy >= minDy && dy <= maxDy
}

function predictPosition (entity, ticks = 1) {
  const pos = entity?.position || new Vec3(0, 0, 0)
  const vel = entity?.velocity || new Vec3(0, 0, 0)
  return pos.plus(vel.scaled(ticks))
}

function headPoint (entity, ticks = 1) {
  const predicted = predictPosition(entity, ticks)
  const height = Number(entity?.height) || 1.8
  return predicted.offset(0, height * 0.85, 0)
}

function shouldSmash (options = {}) {
  const {
    distance = Infinity, velocityY = 0, fallDistance = 0,
    smashRange = 3.2, minFall = 1.5
  } = options
  return velocityY < 0 && fallDistance >= minFall && distance <= smashRange
}

// Wind Burst mendorong bot naik lagi setelah smash: velocity.y melonjak
// positif padahal belum menyentuh tanah.
function detectWindBurst (options = {}) {
  const { velocityY = 0, onGround = false, prevVelocityY = 0, minBoost = 0.25 } = options
  return onGround !== true && velocityY > minBoost && prevVelocityY <= 0.1
}

// Failsafe MLG: target sudah jauh, bot hampir menyentuh tanah, jatuh terlalu tinggi.
function shouldClutch (options = {}) {
  const {
    distance = Infinity, fallDistance = 0, heightAbove = Infinity,
    targetInRange = null,
    minFall = 3, maxHeight = 1.8, smashRange = 3.2
  } = options
  const inRange = targetInRange === null ? distance <= smashRange : targetInRange
  return !inRange && fallDistance > minFall && heightAbove <= maxHeight
}

class MaceSmasher {
  constructor (bot, loadout, logger, options = {}) {
    this.bot = bot
    this.loadout = loadout
    this.logger = logger
    this.settings = {
      minRange: 0,
      maxRange: 10,
      minDy: -1,
      maxDy: 2,
      launchCooldownMs: 750,
      smashRange: 3.2,
      minFall: 1.5,
      chain: true,
      maxChains: 3,
      leadTicks: 1,
      ...options
    }
    this.stats = { launches: 0, smashes: 0, chains: 0, clutches: 0 }
    this.chainCount = 0
    this.prevVelocityY = 0
    this.nextLaunchAt = 0
  }

  canLaunch (context = {}) {
    if (Date.now() < this.nextLaunchAt) return false
    return inLaunchWindow({
      ...context,
      mace: this.loadout.has(TAGS.MACE),
      ammo: this.loadout.count(TAGS.WIND_CHARGE),
      minRange: this.settings.minRange,
      maxRange: this.settings.maxRange,
      minDy: this.settings.minDy,
      maxDy: this.settings.maxDy
    })
  }

  hasWindBurst () {
    try {
      const enchants = this.loadout.item(TAGS.MACE)?.enchants || []
      return enchants.some(enchant => String(enchant?.name || '').replace(/^minecraft:/, '') === 'wind_burst')
    } catch {
      return false
    }
  }

  async lookStraightDown () {
    const bot = this.bot
    const yaw = bot.entity?.yaw ?? 0
    // Konvensi pitch mineflayer: -π/2 = lurus ke bawah, +π/2 = lurus ke atas.
    // toNotchianPitch(-π/2) = +90°, yang di protokol memang "down".
    if (typeof bot.look === 'function') {
      await bot.look(yaw, -Math.PI / 2, true)
      return
    }
    // Fallback: titik 100 blok di bawah mata -> pitch -π/2.
    await bot.lookAt(bot.entity.position.offset(0, -100, 0), true)
  }

  // Urutan: stop pathfinder -> pilih wind charge -> hadap tepat ke bawah ->
  // BIARKAN paket rotasi sampai ke server (rotationTicks) -> lompat ->
  // tegaskan lagi pitch ke bawah -> lempar -> kembali ke mace dan bidik target.
  //
  // Kenapa rotasi ditegaskan dua kali: mineflayer mengirim rotasi di
  // updatePosition() pada physicsTick, bukan saat bot.look() dipanggil. Kalau
  // use_item dikirim pada tick yang sama dengan lompatan, paketnya masih
  // membawa pitch lama (mendatar) sehingga wind charge melayang horizontal,
  // bukan meledak di bawah kaki. Itu penyebab bot tidak terlempar ke atas.
  async launch (target) {
    const bot = this.bot
    if (bot.entity?.onGround !== true) return false
    try { bot.pathfinder?.stop?.() } catch {}
    await this.loadout.arrange()
    if (!(await this.loadout.select(TAGS.WIND_CHARGE))) {
      this.logger?.debug?.('Mace: wind charge tidak ada, peluncuran dilewati')
      return false
    }
    this.nextLaunchAt = Date.now() + this.settings.launchCooldownMs

    const rotationTicks = Math.max(1, Number(this.settings.rotationTicks) || 2)
    await this.lookStraightDown()
    await nextTick(bot, rotationTicks)

    // Lompat dulu supaya bot tidak menempel di lantai saat charge meledak.
    bot.setControlState('jump', true)
    await nextTick(bot, 1)
    bot.setControlState('jump', false)
    await nextTick(bot, 1)

    // Pastikan rotasi terakhir yang terkirim benar-benar ke bawah.
    await this.lookStraightDown()
    await nextTick(bot, 1)

    bot.activateItem()
    await nextTick(bot, 1)

    await this.loadout.select(TAGS.MACE)
    if (target?.position) {
      await bot.lookAt(headPoint(target, this.settings.leadTicks), true).catch(() => {})
    }

    // Verifikasi bot benar-benar terlempar. Kalau server menolak (anti-cheat,
    // charge hilang, atau paket rotasi terlambat) bot tidak boleh terus
    // membakar wind charge sambil berdiri di tanah.
    const lifted = await this.waitForLiftoff()
    this.stats.launches++
    this.chainCount = 0
    this.burstActive = false
    this.lastHitUsedBurst = false
    if (!lifted) {
      this.stats.failedLaunches = (this.stats.failedLaunches || 0) + 1
      this.logger?.warn?.('Mace: wind charge terlempar tapi bot tidak terangkat ke atas')
    }
    return lifted
  }

  // Tunggu sampai bot meninggalkan tanah / punya kecepatan naik.
  async waitForLiftoff (ticks = null) {
    const bot = this.bot
    const limit = Math.max(1, Number(ticks ?? this.settings.liftoffTicks) || 6)
    for (let i = 0; i < limit; i++) {
      await nextTick(bot, 1)
      const entity = bot.entity
      if (!entity) break
      if (entity.onGround === false) return true
      if ((entity.velocity?.y ?? 0) > 0.1) return true
    }
    return false
  }

  async smash (target) {
    const bot = this.bot
    await bot.lookAt(headPoint(target, this.settings.leadTicks), true)
    bot.attack(target)
    if (this.chainCount > 0 && this.stats.smashes > 0) this.stats.chains++
    this.stats.smashes++
    this.chainCount++
    this.prevVelocityY = bot.entity?.velocity?.y ?? 0
    return true
  }

  // Dipanggil tiap tick; true bila Wind Burst mendorong bot naik lagi.
  trackBurst () {
    const vy = this.bot.entity?.velocity?.y ?? 0
    const burst = detectWindBurst({
      velocityY: vy,
      onGround: this.bot.entity?.onGround,
      prevVelocityY: this.prevVelocityY
    })
    this.prevVelocityY = vy
    return burst
  }

  // MLG water: taruh air di bawah, tunggu tepat 1 physics tick, ambil kembali.
  async clutch () {
    const bot = this.bot
    const below = bot.blockAt(bot.entity.position.offset(0, -1, 0))
    if (!below) return false
    if (!(await this.loadout.select(TAGS.WATER))) return false
    await bot.lookAt(below.position, true)
    try {
      bot.activateItem()
      await nextTick(bot, 1)
      bot.activateItem()
      this.stats.clutches++
      await this.loadout.select(TAGS.MACE)
      return true
    } catch (err) {
      this.logger?.debug?.(`Water clutch gagal: ${err.message}`)
      return false
    }
  }
}

module.exports = {
  MaceSmasher,
  inLaunchWindow,
  predictPosition,
  headPoint,
  shouldSmash,
  detectWindBurst,
  shouldClutch
}
