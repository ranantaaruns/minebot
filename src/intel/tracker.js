'use strict'

const fs = require('fs')
const path = require('path')
const { horizontalDistance, bearingDeg, compassPoint, predictPosition, formatCoords } = require('./geo')
const { TrackerStore } = require('./store')

const round1 = value => Math.round(Number(value) * 10) / 10

// Hanya observasi: mendengar paket entity tracking yang sudah dikirim server,
// tidak pernah menggerakkan bot. Satu player = satu record berisi ring buffer
// sampel; posisi di luar jangkauan tracking jadi prediksi (dead reckoning).
class PlayerTracker {
  constructor (bot, config, logger) {
    const options = config?.intel?.tracker || {}
    this.bot = bot
    this.logger = logger
    this.enabled = options.enabled !== false
    this.settings = {
      historyLength: 64,
      staleMs: 15000,
      saveDebounceMs: 2000,
      alertRadius: 32,
      alertChat: false,
      alertCooldownMs: 10000,
      predictTicks: 100,
      maxSpeed: 12,
      dir: 'data/tracker',
      ...options
    }
    this.stats = { samples: 0, tracked: 0, alerts: 0 }
    this.players = new Map()
    // Satu bot = satu file supaya bot swarm tidak saling menimpa.
    this.store = new TrackerStore(this.settings.dir, {
      debounceMs: this.settings.saveDebounceMs,
      file: `players-${this.fileTag()}.json`
    })
    this.running = false
    this.onSpawn = entity => this.sample(entity, 'spawn')
    this.onMove = entity => this.sample(entity, 'move')
    this.onGone = entity => this.sample(entity, 'gone')
  }

  fileTag () {
    return String(this.bot?.username || 'bot').replace(/[^a-zA-Z0-9_-]/g, '_')
  }

  async start () {
    if (this.running) return
    this.running = true
    if (!this.enabled) return
    // Listener dipasang lebih dulu supaya event yang datang saat file masih
    // dibaca tidak hilang.
    this.bot.on?.('entitySpawn', this.onSpawn)
    this.bot.on?.('entityMoved', this.onMove)
    this.bot.on?.('entityGone', this.onGone)
    const saved = await this.store.load()
    for (const [name, record] of Object.entries(saved.players || {})) {
      if (this.players.has(name)) continue
      this.players.set(name, {
        username: name,
        uuid: record.uuid || null,
        samples: (record.samples || []).slice(-this.settings.historyLength),
        lastSeen: Number(record.lastSeen) || 0,
        dimension: record.dimension || null,
        gone: true,
        lastAlert: 0
      })
    }
    this.stats.tracked = this.players.size
  }

  stop () {
    if (!this.running) return
    this.running = false
    try { this.bot.removeListener('entitySpawn', this.onSpawn) } catch {}
    try { this.bot.removeListener('entityMoved', this.onMove) } catch {}
    try { this.bot.removeListener('entityGone', this.onGone) } catch {}
    this.store.schedule(this.snapshot())
    this.store.flush().catch(() => {})
  }

  sample (entity, reason = 'move') {
    if (!this.enabled || !entity || entity.type !== 'player') return null
    const username = entity.username
    const position = entity.position
    if (!username || username === this.bot.username) return null
    if (!Number.isFinite(position?.x) || !Number.isFinite(position?.z)) return null

    const now = Date.now()
    let record = this.players.get(username)
    if (!record) {
      record = { username, uuid: entity.uuid || null, samples: [], lastSeen: now, dimension: null, gone: false, lastAlert: 0 }
      this.players.set(username, record)
      this.stats.tracked = this.players.size
    }
    record.uuid = entity.uuid || record.uuid
    if (reason !== 'gone') {
      record.lastSeen = now
      record.gone = false
      record.dimension = this.bot.game?.dimension || null
      record.samples.push({ t: now, x: round1(position.x), y: round1(position.y), z: round1(position.z), dim: record.dimension, reason })
      if (record.samples.length > this.settings.historyLength) record.samples.shift()
      this.stats.samples += 1
    } else {
      record.gone = true
    }

    this.store.schedule(this.snapshot())
    this.maybeAlert(record)
    return record
  }

  maybeAlert (record) {
    const radius = Number(this.settings.alertRadius) || 0
    if (!radius || record.gone) return
    const distance = this.distanceToBot(record)
    if (!(distance <= radius)) return
    const now = Date.now()
    if (now - (record.lastAlert || 0) < this.settings.alertCooldownMs) return
    record.lastAlert = now
    this.stats.alerts += 1
    const message = `[track] ${record.username} dalam ${distance.toFixed(0)} blok (${formatCoords(this.lastPosition(record))})`
    this.logger?.warn?.(message)
    if (this.settings.alertChat) {
      try { this.bot.chat?.(message) } catch {}
    }
  }

  lastPosition (record) {
    return record?.samples?.[record.samples.length - 1] || null
  }

  distanceToBot (record) {
    const last = this.lastPosition(record)
    const own = this.bot.entity?.position
    if (!last || !own) return Infinity
    return horizontalDistance(last, own)
  }

  where (username) {
    const record = this.players.get(String(username))
    if (!record) return null
    const last = this.lastPosition(record)
    const now = Date.now()
    const ageMs = Math.max(0, now - (record.lastSeen || 0))
    const stale = record.gone || ageMs > this.settings.staleMs
    const horizonMs = stale ? Math.min(10000, ageMs) + this.settings.predictTicks * 50 : this.settings.predictTicks * 50
    const prediction = last ? predictPosition(record.samples, horizonMs, { maxSpeed: this.settings.maxSpeed }) : null
    const own = this.bot.entity?.position
    const bearing = last && own ? bearingDeg(own, last) : null
    return {
      username: record.username,
      uuid: record.uuid,
      dimension: record.dimension,
      samples: record.samples.length,
      ageMs,
      stale,
      gone: Boolean(record.gone),
      distance: last ? horizontalDistance(last, own) : Infinity,
      bearing,
      compass: compassPoint(bearing),
      coords: formatCoords(last),
      prediction
    }
  }

  list () {
    return [...this.players.values()]
      .map(record => this.where(record.username))
      .filter(Boolean)
      .sort((a, b) => a.distance - b.distance)
  }

  snapshot () {
    const players = {}
    for (const [name, record] of this.players) players[name] = record
    return { version: 1, players }
  }

  async exportTo (file) {
    const target = path.resolve(file)
    await fs.promises.mkdir(path.dirname(target), { recursive: true })
    await fs.promises.writeFile(target, JSON.stringify(this.snapshot(), null, 2), 'utf8')
    return target
  }

  clear () {
    this.players.clear()
    this.stats.tracked = 0
    this.store.schedule(this.snapshot())
  }
}

module.exports = { PlayerTracker }
