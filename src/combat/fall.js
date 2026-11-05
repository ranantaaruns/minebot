'use strict'

// Mineflayer tidak mengirim fallDistance pemain, jadi dihitung sendiri:
// simpan Y tertinggi selama tidak menyentuh tanah, selisihnya = jarak jatuh.

function fallDistanceFrom (peakY, y) {
  if (!Number.isFinite(peakY) || !Number.isFinite(y)) return 0
  return Math.max(0, peakY - y)
}

class FallTracker {
  constructor (bot) {
    this.bot = bot
    this.peakY = null
    this.distance = 0
    this.grounded = true
  }

  update () {
    const entity = this.bot?.entity
    const y = entity?.position?.y
    if (!Number.isFinite(y)) return 0
    if (entity.onGround === true) {
      this.grounded = true
      this.peakY = y
      this.distance = 0
      return 0
    }
    this.grounded = false
    if (!Number.isFinite(this.peakY) || y > this.peakY) this.peakY = y
    this.distance = fallDistanceFrom(this.peakY, y)
    return this.distance
  }

  reset () {
    this.peakY = null
    this.distance = 0
    this.grounded = true
  }
}

module.exports = { FallTracker, fallDistanceFrom }
