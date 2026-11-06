'use strict'

const Vec3 = require('vec3')
const { nextTick } = require('./tick')

function bareName (value) {
  return String(value?.name || value || '').replace(/^minecraft:/, '').toLowerCase()
}

function isLavaBlock (block) {
  return bareName(block) === 'lava' || bareName(block) === 'flowing_lava'
}

function isAirBlock (block) {
  return ['air', 'cave_air', 'void_air'].includes(bareName(block))
}

class LavaBucketAttack {
  constructor (bot, logger = null, options = {}) {
    this.bot = bot
    this.logger = logger
    this.settings = {
      enabled: options.enabled !== false,
      range: Number(options.range) || 3.2,
      cooldownMs: Number(options.cooldownMs) || 12000,
      burnTicks: Number(options.burnTicks) || 8,
      pickupAttempts: Number(options.pickupAttempts) || 3,
      selfDistance: Number(options.selfDistance) || 1.5
    }
    this.stats = { uses: 0, recoveries: 0, failures: 0 }
    this.activeSource = null
    this.nextUseAt = 0
    this.busy = false
  }

  item (name) {
    const items = this.bot?.inventory?.items?.() || []
    return items.find(item => bareName(item) === name && (item.count || 1) > 0) || null
  }

  count (name) {
    const items = this.bot?.inventory?.items?.() || []
    return items.reduce((sum, item) => sum + (bareName(item) === name ? (item.count || 1) : 0), 0)
  }

  placementFor (target) {
    const bot = this.bot
    if (!target?.position || !bot?.entity?.position || typeof bot.blockAt !== 'function') return null
    if (bot.entity.position.distanceTo(target.position) > this.settings.range + 0.6) return null
    const source = target.position.floored()
    const center = source.offset(0.5, 0, 0.5)
    const selfDistance = Math.hypot(
      center.x - bot.entity.position.x,
      center.z - bot.entity.position.z
    )
    if (selfDistance < this.settings.selfDistance) return null

    let current = null
    let support = null
    try {
      current = bot.blockAt(source)
      support = bot.blockAt(source.offset(0, -1, 0))
    } catch {
      return null
    }
    // Air saja: jangan membuat obsidian/cobble di air atau menghapus blok lain.
    if (!isAirBlock(current)) return null
    if (!support || isAirBlock(support) || isLavaBlock(support) || support.boundingBox === 'empty') return null
    return { source, support }
  }

  async tryAttack (target) {
    if (!this.settings.enabled || this.busy || Date.now() < this.nextUseAt) return false
    const bucket = this.item('lava_bucket')
    const placement = this.placementFor(target)
    if (!bucket || !placement) return false

    this.busy = true
    this.nextUseAt = Date.now() + this.settings.cooldownMs
    try {
      await this.bot.equip(bucket, 'hand')
      this.activeSource = placement.source
      if (typeof this.bot.activateBlock === 'function') {
        await this.bot.activateBlock(placement.support, new Vec3(0, 1, 0), new Vec3(0.5, 0, 0.5))
      } else {
        await this.bot.lookAt(placement.source.offset(0.5, 0, 0.5), true)
        this.bot.activateItem()
      }
      await nextTick(this.bot, 2)
      if (!isLavaBlock(this.bot.blockAt(placement.source))) {
        this.activeSource = null
        return false
      }

      this.stats.uses++
      await nextTick(this.bot, this.settings.burnTicks)
      const recovered = await this.recover()
      if (!recovered) this.stats.failures++
      return recovered
    } catch (err) {
      this.logger?.debug?.(`Lava attack gagal: ${err.message}`)
      await this.recover().catch(() => false)
      return false
    } finally {
      this.busy = false
    }
  }

  async recover () {
    const source = this.activeSource
    if (!source) return true
    for (let attempt = 0; attempt < this.settings.pickupAttempts; attempt++) {
      if (!isLavaBlock(this.bot.blockAt(source)) && this.count('lava_bucket') > 0) {
        this.activeSource = null
        this.stats.recoveries++
        return true
      }
      const empty = this.item('bucket')
      if (empty) await this.bot.equip(empty, 'hand')
      await this.bot.lookAt(source.offset(0.5, 0.5, 0.5), true)
      this.bot.activateItem()
      await nextTick(this.bot, 2)
    }
    if (!isLavaBlock(this.bot.blockAt(source)) && this.count('lava_bucket') > 0) {
      this.activeSource = null
      this.stats.recoveries++
      return true
    }
    this.logger?.warn?.(`Lava belum dapat diambil di ${source.x}, ${source.y}, ${source.z}; akan dicoba lagi saat attack selesai`)
    return false
  }
}

module.exports = { LavaBucketAttack, isLavaBlock, isAirBlock }
