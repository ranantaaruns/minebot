'use strict'

const Vec3 = require('vec3')

function bareName (name) {
  return String(name || '').replace(/^minecraft:/, '').toLowerCase()
}

const BOW_NAMES = new Set(['bow', 'crossbow'])

// Panah, panah spectral, dan panah tipped semuanya muncul sebagai entitas
// `arrow`, tapi nama mentahnya bisa berbeda-beda antar versi.
function isArrowEntity (entity) {
  if (!entity || !entity.position) return false
  return /arrow/.test(bareName(entity.name || entity.displayName))
}

// Kecepatan panah per tick. `entity.velocity` diisi server untuk proyektil;
// kalau kosong (beberapa versi tidak mengirimnya), pakai selisih posisi antar
// pembacaan sebagai cadangan.
function arrowVelocity (entity, previous, dtMs) {
  const velocity = entity?.velocity
  if (velocity && Math.hypot(velocity.x, velocity.y, velocity.z) > 0.01) {
    return new Vec3(velocity.x, velocity.y, velocity.z)
  }
  if (!previous || !entity?.position) return null
  const ticks = Math.max(0.25, (Number(dtMs) || 50) / 50)
  return entity.position.minus(previous).scaled(1 / ticks)
}

// Lintasan panah per tick, persis fisika server: pos += v; v *= 0.99; v.y -= 0.05.
function simulatePath (position, velocity, options = {}) {
  const drag = Number.isFinite(options.drag) ? options.drag : 0.99
  const gravity = Number.isFinite(options.gravity) ? options.gravity : 0.05
  const ticks = Math.max(1, Number(options.ticks) || 40)

  const path = []
  let point = position.clone ? position.clone() : new Vec3(position.x, position.y, position.z)
  let speed = velocity.clone ? velocity.clone() : new Vec3(velocity.x, velocity.y, velocity.z)
  for (let tick = 0; tick < ticks; tick++) {
    path.push({ tick, position: point.clone() })
    point = point.plus(speed)
    speed = new Vec3(speed.x * drag, speed.y * drag - gravity, speed.z * drag)
  }
  return path
}

// Arah mengelak: tegak lurus terhadap arah terbang panah, dipilih sisi yang
// membuat bot menjauh dari garis tembakan.
function escapeDirection (arrowPosition, velocity, center) {
  let perpendicularX = -velocity.z
  let perpendicularZ = velocity.x
  const length = Math.hypot(perpendicularX, perpendicularZ)
  if (!(length > 1e-6)) return new Vec3(1, 0, 0)
  perpendicularX /= length
  perpendicularZ /= length

  const toBotX = center.x - arrowPosition.x
  const toBotZ = center.z - arrowPosition.z
  if (perpendicularX * toBotX + perpendicularZ * toBotZ < 0) {
    perpendicularX = -perpendicularX
    perpendicularZ = -perpendicularZ
  }
  return new Vec3(perpendicularX, 0, perpendicularZ)
}

// Apakah panah ini akan melewati badan bot, dan berapa tick lagi.
// `hitRadius` = jarak lateral maksimum yang masih dianggap membahayakan
// (setengah lebar badan 0.3 + toleransi).
function arrowThreat (arrow, self, options = {}) {
  if (!arrow || !self?.position) return null
  const hitRadius = Number.isFinite(options.hitRadius) ? options.hitRadius : 0.55
  const height = Number(self.height) || 1.8
  const velocity = options.velocity || arrow.velocity
  if (!velocity) return null

  const flatSpeed = Math.hypot(velocity.x, velocity.z)
  if (!(flatSpeed > 0.05)) return null

  const feet = self.position
  const center = feet.offset(0, height * 0.5, 0)
  // Hanya panah yang mendekat. Panah yang menjauh (termasuk panah kita sendiri)
  // tidak perlu dihindari.
  if (velocity.x * (center.x - arrow.position.x) + velocity.z * (center.z - arrow.position.z) <= 0) {
    return null
  }

  const path = simulatePath(arrow.position, velocity, options)
  let closest = null
  for (const step of path) {
    const point = step.position
    if (point.y < feet.y - 0.1 || point.y > feet.y + height + 0.1) continue
    const distance = Math.hypot(point.x - feet.x, point.z - feet.z)
    if (!closest || distance < closest.distance) {
      closest = { distance, tick: step.tick, position: point }
    }
  }

  if (!closest || closest.distance > hitRadius || closest.tick < 1) return null
  return {
    tick: closest.tick,
    distance: closest.distance,
    position: closest.position,
    direction: escapeDirection(arrow.position, velocity, center)
  }
}

// Ubah arah dunia menjadi tombol gerak. Minecraft: forward = (-sin yaw, -cos yaw),
// right = (cos yaw, -sin yaw). Kalau arahnya menyerong, dua tombol ditekan
// sekaligus supaya pergeserannya lebih besar.
function chooseControls (yaw, direction) {
  if (!direction) return []
  const angle = Number(yaw) || 0
  const forward = { x: -Math.sin(angle), z: -Math.cos(angle) }
  const right = { x: Math.cos(angle), z: -Math.sin(angle) }
  const dx = direction.x
  const dz = direction.z

  const scores = [
    ['forward', dx * forward.x + dz * forward.z],
    ['back', -(dx * forward.x + dz * forward.z)],
    ['right', dx * right.x + dz * right.z],
    ['left', -(dx * right.x + dz * right.z)]
  ].sort((a, b) => b[1] - a[1])

  if (scores[0][1] <= 0) return []
  const controls = [scores[0][0]]
  if (scores[1][1] > 0 && scores[1][1] >= scores[0][1] * 0.6) controls.push(scores[1][0])
  return controls
}

function heldItemNames (entity) {
  const items = []
  if (entity?.heldItem) items.push(entity.heldItem)
  if (Array.isArray(entity?.equipment)) items.push(...entity.equipment)
  if (entity?.equipment && typeof entity.equipment === 'object' && !Array.isArray(entity.equipment)) {
    for (const value of Object.values(entity.equipment)) items.push(value)
  }
  return items.map(item => bareName(item?.name || item?.displayName || ''))
}

// Sinyal "siap menembak": memegang busur dan tangan sedang aktif menarik
// (metadata LivingEntity bit 0x01; nomor indeks bergeser antar versi).
function entityDrawingBow (entity) {
  const names = heldItemNames(entity)
  if (!names.some(name => BOW_NAMES.has(name))) return false
  const metadata = entity?.metadata
  if (!Array.isArray(metadata)) return false
  for (const index of [6, 7, 8]) {
    const value = metadata[index]
    if (typeof value === 'number' && (value & 0x01) === 1) return true
  }
  return false
}

// Pengelak panah: dipanggil tiap `tickMs`. Sumber ancaman ada dua:
//   1. panah yang sudah terbang dan lintasannya melewati badan bot,
//   2. lawan/mob yang memegang busur dan sedang menariknya ke arah bot.
// Reaksi: geser menyamping (strafe) sesaat, lalu lepas tombolnya lagi.
class ArrowDodger {
  constructor (bot, config, logger) {
    const options = config?.safety?.arrowDodge || {}
    this.bot = bot
    this.logger = logger
    this.enabled = options.enabled !== false
    this.settings = {
      radius: 0.55,
      detectRange: 16,
      drawRange: 20,
      dodgeMs: 220,
      cooldownMs: 500,
      tickMs: 80,
      ticks: 40,
      ...options
    }
    this.stats = { dodges: 0, preempts: 0 }
    this.interval = null
    this.busyUntil = 0
    this.nextDodgeAt = 0
    this.pressed = []
    this.history = new Map()
    this.timer = null
    this.stopped = false
  }

  get hitRadius () {
    return Number(this.settings.radius) || 0.55
  }

  get dodgeMs () {
    return Math.max(20, Number(this.settings.dodgeMs) || 220)
  }

  start () {
    if (this.interval || !this.enabled || this.stopped) return
    const intervalMs = Math.max(20, Number(this.settings.tickMs) || 80)
    this.interval = setInterval(() => {
      try {
        this.update()
      } catch (err) {
        this.logger?.debug(`Gagal mengelak panah: ${err.message}`)
      }
    }, intervalMs)
    this.interval.unref?.()
  }

  stop () {
    this.stopped = true
    if (this.interval) clearInterval(this.interval)
    this.interval = null
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.release()
  }

  release () {
    const pressed = this.pressed
    this.pressed = []
    for (const control of pressed) {
      try { this.bot.setControlState(control, false) } catch {}
    }
  }

  // Ancaman terdekat: panah dengan waktu tabrak paling singkat.
  findThreat (self, now = Date.now()) {
    const range = Number(this.settings.detectRange) || 16
    let best = null
    const ticks = Number(this.settings.ticks) || 40

    for (const entity of Object.values(this.bot?.entities || {})) {
      if (!isArrowEntity(entity)) continue
      if (self && entity.id === self.id) continue
      if (entity.position.distanceTo(self.position) > range) continue

      const previous = this.history.get(entity.id)
      const velocity = arrowVelocity(entity, previous, previous ? now - previous.at : 50)
      if (velocity) this.history.set(entity.id, { position: entity.position.clone(), at: now })
      else continue

      const threat = arrowThreat(entity, self, {
        hitRadius: this.hitRadius,
        ticks,
        velocity
      })
      if (!threat) continue
      if (!best || threat.tick < best.tick) best = { ...threat, kind: 'arrow', id: entity.id }
    }

    return best
  }

  // Siap menembak: lawan/mob berbusur dalam jarak `drawRange` sedang menarik
  // busur. Bot menggeser sedikit sebelum panahnya lahir, karena panah jarak
  // dekat datang terlalu cepat untuk dihindari setelah terbang.
  findDraw (self) {
    const range = Number(this.settings.drawRange) || 20
    let best = null

    for (const entity of Object.values(this.bot?.entities || {})) {
      if (!entity?.position || entity === self) continue
      if (entity.id === self.id) continue
      if (entity.position.distanceTo(self.position) > range) continue
      if (!entityDrawingBow(entity)) continue
      const distance = entity.position.distanceTo(self.position)
      if (!best || distance < best.distance) best = { entity, distance }
    }

    if (!best) return null
    const away = best.entity.position.minus(self.position)
    away.y = 0
    if (away.norm() < 0.01) return null
    // Sisi kiri/kanan relatif terhadap garis tembakan.
    const direction = new Vec3(-away.z, 0, away.x).normalize()
    return { kind: 'draw', tick: Infinity, distance: best.distance, direction, id: best.entity.id }
  }

  update (now = Date.now()) {
    if (!this.enabled || this.stopped) return null
    const self = this.bot?.entity
    if (!self?.position) return null
    // Bergeser saat makan akan membatalkan konsumsi (dan membuat bot kelaparan
    // di tengah pertarungan), jadi tunggu makan selesai.
    if (this.bot?.consuming || this.bot?.foodManager?.eating) return null

    this.history.forEach((entry, id) => {
      if (!this.bot.entities?.[id]) this.history.delete(id)
    })

    if (now < this.busyUntil) return null
    if (now < this.nextDodgeAt) return null

    const threat = this.findThreat(self, now) || this.findDraw(self)
    if (!threat) return null

    const controls = chooseControls(self.yaw, threat.direction)
    if (!controls.length) return null

    this.pressed = controls
    for (const control of controls) {
      try { this.bot.setControlState(control, true) } catch {}
    }
    this.busyUntil = now + this.dodgeMs
    this.nextDodgeAt = now + this.dodgeMs + (Number(this.settings.cooldownMs) || 500)
    this.stats.dodges++
    if (threat.kind === 'draw') this.stats.preempts++

    const label = threat.kind === 'draw'
      ? 'menggeser badan karena lawan menarik busur'
      : `menggeser badan menghindari panah (${threat.distance.toFixed(2)} blok dari lintasan, ${threat.tick} tick lagi)`
    this.logger?.debug(label)

    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      this.release()
    }, this.dodgeMs)
    this.timer.unref?.()

    return { ...threat, controls }
  }
}

module.exports = {
  ArrowDodger,
  isArrowEntity,
  arrowVelocity,
  simulatePath,
  escapeDirection,
  arrowThreat,
  chooseControls,
  entityDrawingBow
}
