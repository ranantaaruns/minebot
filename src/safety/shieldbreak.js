'use strict'

function bareName (name) {
  return String(name || '').replace(/^minecraft:/, '').toLowerCase()
}

// Apakah lawan memegang shield (tangan utama maupun off-hand). Untuk player lain
// mineflayer mengisi `heldItem`; `equipment` dipakai kalau ada.
function enemyHoldsShield (entity) {
  if (!entity) return false
  const items = []
  if (entity.heldItem) items.push(entity.heldItem)
  if (Array.isArray(entity.equipment)) items.push(...entity.equipment)
  if (entity.equipment && typeof entity.equipment === 'object') {
    for (const value of Object.values(entity.equipment)) items.push(value)
  }
  return items.some(item => item && bareName(item.name) === 'shield')
}

// Bit "tangan aktif" di metadata LivingEntity (1.13+). Nomor indeks bergeser
// antar versi, jadi beberapa slot diperiksa dan hanya dipercaya kalau lawan
// memang memegang shield.
function enemyRaisingShield (entity) {
  if (!enemyHoldsShield(entity)) return false
  const metadata = entity?.metadata
  if (!Array.isArray(metadata)) return false
  for (const index of [6, 7, 8]) {
    const value = metadata[index]
    if (typeof value === 'number' && (value & 0x01) === 1) return true
  }
  return false
}

// Strategi mematahkan shield lawan:
//   1. deteksi lawan memblok (pegang shield + tangan aktif, atau pukulan kita
//      tidak mengurangi darahnya),
//   2. pukul dengan kapak — satu pukulan mematikan shield 5 detik,
//   3. selama shield cooldown, serang balik dengan pedang.
// Modul ini murni keputusan; eksekusi (equip/attack) tetap di PlayerHunter.
class ShieldBreakStrategy {
  constructor (options = {}) {
    this.settings = {
      enabled: true,
      punishMs: 5000,
      windowMs: 1500,
      ...options
    }
    this.pending = null
    this.blockedHits = 0
    this.blockingUntil = 0
    this.punishUntil = 0
    this.stats = { breaks: 0, blockedHits: 0 }
  }

  get enabled () {
    return this.settings.enabled !== false
  }

  reset () {
    this.pending = null
    this.blockedHits = 0
    this.blockingUntil = 0
    this.punishUntil = 0
    this.stats = { breaks: 0, blockedHits: 0 }
  }

  get punishMs () {
    return Number(this.settings.punishMs) || 0
  }

  // Shield lawan sedang cooldown gara-gara kapak kita.
  inPunishWindow (now = Date.now()) {
    return now < this.punishUntil
  }

  isBlocking (entity, now = Date.now()) {
    if (!this.enabled) return false
    if (this.inPunishWindow(now)) return false
    if (enemyRaisingShield(entity)) return true
    return now < this.blockingUntil && enemyHoldsShield(entity)
  }

  // Senjata untuk pukulan berikutnya.
  weapon (entity, now = Date.now()) {
    if (!this.enabled) return 'sword'
    if (this.inPunishWindow(now)) return 'sword'
    return this.isBlocking(entity, now) ? 'axe' : 'sword'
  }

  // Dicatat tepat sebelum memukul, supaya darah sebelum/sesudah bisa dibandingkan.
  beforeAttack (entity, now = Date.now()) {
    this.pending = { at: now, health: Number(entity?.health) }
  }

  // Dipanggil sebelum pukulan berikutnya; mengembalikan hasil pukulan sebelumnya:
  // 'hit' (darah lawan turun), 'blocked' (shield menahan), 'broke' (kapak
  // mematikan shield), atau 'unknown' (data darah tidak tersedia/terlalu lama).
  afterAttack (entity, weapon = 'sword', now = Date.now()) {
    const pending = this.pending
    if (!pending) return 'unknown'
    if (now - pending.at > Number(this.settings.windowMs)) {
      this.pending = null
      return 'unknown'
    }
    const after = Number(entity?.health)
    if (!Number.isFinite(after) || !Number.isFinite(pending.health)) return 'unknown'

    this.pending = null
    const damage = pending.health - after
    if (damage > 0.01) {
      this.blockedHits = 0
      this.blockingUntil = 0
      return 'hit'
    }

    if (weapon === 'axe') {
      // Pukulan kapak sendiri masih ditahan shield, tapi shield lawan langsung
      // cooldown 5 detik — itu justru tujuan strateginya.
      this.punishUntil = now + this.punishMs
      this.blockedHits = 0
      this.blockingUntil = 0
      this.stats.breaks++
      return 'broke'
    }

    this.blockedHits++
    this.stats.blockedHits++
    this.blockingUntil = now + Number(this.settings.windowMs)
    return 'blocked'
  }
}

module.exports = { ShieldBreakStrategy, enemyHoldsShield, enemyRaisingShield }
