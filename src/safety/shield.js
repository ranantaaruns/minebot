'use strict'

const { withTimeout } = require('../util/async')

const SHIELD_NAMES = new Set(['shield'])

function bareName (name) {
  return String(name || '').replace(/^minecraft:/, '').toLowerCase()
}

function findShield (bot) {
  for (const item of bot?.inventory?.items?.() || []) {
    if (SHIELD_NAMES.has(bareName(item.name))) return item
  }
  return null
}

function offHandIsShield (bot) {
  try {
    const slot = bot?.inventory?.slots?.[45]
    return Boolean(slot) && SHIELD_NAMES.has(bareName(slot.name))
  } catch {
    return false
  }
}

// Penjaga shield untuk PvP. Shield dipasang di off-hand, diangkat selama lawan
// berada dalam jangkauan (atau saat gerakannya diprediksi memukul), dan TETAP
// terangkat walaupun bot memukul — di Java pukulan tangan utama tidak menurunkan
// block shield off-hand. Hanya aksi yang butuh tangan kanan (makan, memanah)
// yang menurunkannya.
class ShieldGuard {
  constructor (bot, config, logger) {
    this.bot = bot
    this.logger = logger
    this.settings = {
      enabled: true,
      blockRange: 4.5,
      predictMs: 400,
      approachWindow: 2.5,
      equipTimeoutMs: 2000,
      refreshMs: 900,
      face: true,
      ...(config?.shield || config?.combat?.shield || {})
    }

    this.blocking = false
    this.blockingSince = 0
    this.equipped = false
    this.raiseUntil = 0
    this.target = null
    this.listeners = null
    this.stats = { raised: 0, predicted: 0, refreshed: 0 }
  }

  get enabled () {
    return this.settings.enabled !== false
  }

  hasShield () {
    if (offHandIsShield(this.bot)) return true
    if (this.equipped && !this.bot?.inventory?.slots) return true
    return Boolean(findShield(this.bot))
  }

  setTarget (entity) {
    this.target = entity || null
  }

  start () {
    if (!this.enabled || this.listeners) return false
    const onSwing = entity => this.noteSwing(entity)
    // Shield bisa hilang statusnya tanpa kita tahu (kena axe, makan, ganti item);
    // tandai turun supaya tick berikutnya mengangkatnya lagi.
    const onHurt = entity => {
      if (entity && entity === this.bot?.entity) {
        this.blocking = false
        this.blockingSince = 0
      }
    }
    this.listeners = { swing: onSwing, hurt: onHurt }
    try { this.bot.on?.('entitySwingArm', onSwing) } catch {}
    try { this.bot.on?.('entityHurt', onHurt) } catch {}
    return true
  }

  stop () {
    this.lower()
    if (!this.listeners) return
    try { this.bot.removeListener?.('entitySwingArm', this.listeners.swing) } catch {}
    try { this.bot.removeListener?.('entityHurt', this.listeners.hurt) } catch {}
    this.listeners = null
  }

  // Ayunan tangan lawan = sinyal paling awal sebelum pukulan mendarat; angkat
  // shield sebelum damage-nya sampai ke server.
  noteSwing (entity) {
    if (!this.enabled || !entity || entity === this.bot?.entity) return false
    if (this.target && entity.id !== this.target.id) return false
    const distance = this._distanceTo(entity)
    if (distance > Number(this.settings.blockRange) + Number(this.settings.approachWindow)) return false

    this.raiseUntil = Date.now() + (Number(this.settings.predictMs) || 400)
    this.stats.predicted++
    return true
  }

  _distanceTo (entity) {
    const from = this.bot?.entity?.position
    const to = entity?.position
    if (!from || !to) return Infinity
    return from.distanceTo(to)
  }

  // Lawan mendekat cepat = kemungkinan besar langsung memukul saat sampai.
  _approaching (entity) {
    const velocity = entity?.velocity
    if (!velocity || !this.bot?.entity?.position || !entity.position) return false
    const towardX = this.bot.entity.position.x - entity.position.x
    const towardZ = this.bot.entity.position.z - entity.position.z
    const approach = (Number(velocity.x) || 0) * towardX + (Number(velocity.z) || 0) * towardZ
    return approach > 0.02
  }

  isThreat (entity, distance) {
    const range = Number(this.settings.blockRange) || 4.5
    if (!entity) return false
    if (Number(distance) <= range) return true
    if (Date.now() < this.raiseUntil) return true
    return Number(distance) <= range + Number(this.settings.approachWindow) && this._approaching(entity)
  }

  async _ensureEquipped () {
    const shield = findShield(this.bot)
    if (!shield) return offHandIsShield(this.bot)
    if (this.equipped && offHandIsShield(this.bot)) return true
    if (this.equipped && !this.bot?.inventory?.slots) return true
    try {
      await withTimeout(
        this.bot.equip(shield, 'off-hand'),
        Number(this.settings.equipTimeoutMs) || 2000,
        'Equip shield timeout'
      )
      this.equipped = true
      return true
    } catch (err) {
      this.logger?.debug(`Gagal memasang shield: ${err.message}`)
      return false
    }
  }

  // Shield hanya memblok serangan dari depan, jadi hadapkan bot ke lawan selama
  // tidak sedang jalan mengikuti pathfinder (yang memakai yaw sendiri).
  async _face (entity) {
    if (this.settings.face === false) return
    const position = entity?.position
    if (!position || typeof this.bot.lookAt !== 'function') return
    try { if (this.bot.pathfinder?.isMoving?.()) return } catch {}
    const height = (Number(entity.height) || 1.8) * 0.8
    try { await this.bot.lookAt(position.offset(0, height, 0), true) } catch {}
  }

  async raise (entity = null) {
    if (!this.enabled) return false
    if (this.blocking) {
      this._refresh()
      return true
    }
    if (!await this._ensureEquipped()) return false
    await this._face(entity || this.target)
    try {
      this.bot.activateItem(true)
      this.blocking = true
      this.blockingSince = Date.now()
      this.stats.raised++
      return true
    } catch (err) {
      this.logger?.debug(`Gagal mengangkat shield: ${err.message}`)
      return false
    }
  }

  // Kirim ulang state block secara berkala: kalau satu paket hilang atau server
  // menurunkan shield tanpa kita tahu, bot tidak berhenti memblok selamanya.
  _refresh () {
    const refreshMs = Number(this.settings.refreshMs) || 0
    if (refreshMs <= 0) return false
    if (Date.now() - this.blockingSince < refreshMs) return false
    try { this.bot.deactivateItem() } catch {}
    try { this.bot.activateItem(true) } catch {}
    this.blockingSince = Date.now()
    this.stats.refreshed++
    return true
  }

  lower () {
    if (!this.blocking) return false
    try { this.bot.deactivateItem() } catch {}
    this.blocking = false
    this.blockingSince = 0
    return true
  }

  // Dipanggil tiap tick PvP. needsHand=true hanya untuk aksi yang memakai tangan
  // kanan (makan/minum/memanah); memukul dengan senjata TIDAK menurunkan shield.
  async update (entity, distance, { needsHand = false } = {}) {
    if (!this.enabled) return false
    if (needsHand) {
      this.lower()
      return false
    }
    if (!this.hasShield()) {
      this.lower()
      return false
    }
    if (!this.isThreat(entity, distance)) {
      this.lower()
      return false
    }
    return this.raise(entity)
  }
}

module.exports = { ShieldGuard, findShield, offHandIsShield, SHIELD_NAMES }
