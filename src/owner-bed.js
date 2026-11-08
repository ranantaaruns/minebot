'use strict'

const Vec3 = require('vec3')
const { goals } = require('mineflayer-pathfinder')

// Vanilla: satu kasur hanya menampung satu pemain. Jadi saat owner tidur, bot
// mencoba kasur yang sama lebih dulu; kalau terpakai, bot memakai kasur kosong
// terdekat supaya titik spawn-nya tetap di tempat yang sama dengan owner.

function isBedBlock (block) {
  const name = String(block?.name || '').replace(/^minecraft:/, '')
  return name === 'bed' || name.endsWith('_bed')
}

function bedAt (bot, position) {
  if (!position) return null
  try {
    const block = bot.blockAt(position.floored())
    return isBedBlock(block) ? block : null
  } catch {
    return null
  }
}

// Cari kasur di sekitar posisi owner (pemilik sedang berbaring di dalamnya,
// jadi posisi kakinya bisa sedikit bergeser dari blok kasur).
function findBedsAround (bot, position, radius = 3) {
  const out = []
  const seen = new Set()
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dz = -radius; dz <= radius; dz++) {
        const pos = position.floored().offset(dx, dy, dz)
        const key = `${pos.x},${pos.y},${pos.z}`
        if (seen.has(key)) continue
        seen.add(key)
        const block = bedAt(bot, pos)
        if (block) out.push(block)
      }
    }
  }
  return out
}

class BedSpawnSync {
  constructor (bot, config = {}, logger = null) {
    this.bot = bot
    this.config = config || {}
    this.logger = logger
    this.enabled = this.config.syncBedSpawn !== false
    this.radius = Number(this.config.bedSearchRadius) || 6
    this.busy = false
    this.started = false
    this.stats = { syncs: 0, occupied: 0, failures: 0 }
    this.onEntitySleep = this._onEntitySleep.bind(this)
  }

  start () {
    if (this.started || !this.enabled) return this
    this.started = true
    this.bot.on?.('entitySleep', this.onEntitySleep)
    return this
  }

  stop () {
    if (!this.started) return this
    this.started = false
    try { this.bot.removeListener?.('entitySleep', this.onEntitySleep) } catch {}
    return this
  }

  _onEntitySleep (entity) {
    if (!this.enabled || this.busy) return
    const owner = this.config.username
    if (!owner || entity?.username !== owner) return
    if (this.bot.isSleeping) return
    this.busy = true
    this._sync(entity).catch(err => {
      this.stats.failures++
      this.logger?.debug(`Sinkron kasur gagal: ${err.message}`)
    }).finally(() => { this.busy = false })
  }

  async _sync (ownerEntity) {
    const bot = this.bot
    if (!bot.entity || typeof bot.sleep !== 'function') return
    const beds = findBedsAround(bot, ownerEntity.position, 2)
    if (beds.length === 0) {
      this.logger?.warn(`Owner tidur tapi tidak ada kasur yang terdeteksi di sekitarnya`)
      return
    }

    const ownerBed = beds[0]
    const ordered = [ownerBed, ...beds.slice(1)]
    // Kasur lain di dekatnya ikut disiapkan kalau kasur owner sedang dipakai.
    const extras = findBedsAround(bot, ownerEntity.position, this.radius)
      .filter(bed => !ordered.some(b => b.position.equals(bed.position)))
    for (const bed of [...ordered, ...extras]) {
      if (!(await this._approach(bed))) continue
      try {
        await bot.sleep(bed)
        this.stats.syncs++
        const shared = bed.position.equals(ownerBed.position)
        this.logger?.info(shared
          ? `Set spawn di kasur owner (${bed.position.x} ${bed.position.y} ${bed.position.z})`
          : `Kasur owner terpakai; set spawn di kasur sebelahnya (${bed.position.x} ${bed.position.y} ${bed.position.z})`)
        if (!shared) this.stats.occupied++
        return
      } catch (err) {
        this.logger?.debug(`Tidur di ${bed.position}: ${err.message}`)
      }
    }
    this.logger?.warn('Tidak ada kasur kosong di dekat owner; spawn bot tidak berubah')
  }

  async _approach (bed) {
    const bot = this.bot
    if (!bot.entity) return false
    if (bot.entity.position.distanceTo(bed.position) <= 2.5) return true
    if (typeof bot.pathfinder?.goto !== 'function') return false
    try {
      const p = bed.position
      await bot.pathfinder.goto(new goals.GoalNear(p.x, p.y, p.z, 2))
      return true
    } catch (err) {
      try { bot.pathfinder.stop() } catch {}
      this.logger?.debug(`Jalan ke kasur gagal: ${err.message}`)
      return false
    }
  }
}

module.exports = { BedSpawnSync, isBedBlock, findBedsAround, bedAt }
