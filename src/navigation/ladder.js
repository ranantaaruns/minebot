'use strict'

const Vec3 = require('vec3')
const mcDataLoader = require('minecraft-data')

const CLIMBABLE_NAMES = new Set([
  'ladder',
  'vine',
  'scaffolding',
  'weeping_vines',
  'weeping_vines_plant',
  'twisting_vines',
  'twisting_vines_plant',
  'cave_vines',
  'cave_vines_plant'
])

function isClimbable (block) {
  if (!block) return false
  const name = String(block.name || '').replace(/^minecraft:/, '')
  return CLIMBABLE_NAMES.has(name)
}

function getWallVector (block) {
  if (!block) return new Vec3(0, 0, -1)
  const facing = block._properties?.facing || block.properties?.facing
  if (facing === 'north') return new Vec3(0, 0, -1)
  if (facing === 'south') return new Vec3(0, 0, 1)
  if (facing === 'west') return new Vec3(-1, 0, 0)
  if (facing === 'east') return new Vec3(1, 0, 0)
  return new Vec3(0, 0, -1)
}

class LadderNavigator {
  constructor (bot, config, logger, options = {}) {
    this.bot = bot
    this.config = config
    this.logger = logger
    this.getTarget = options.getTarget || (() => null)

    this.active = false
    this.busy = false
    this.climbing = false
    this._lastTrapdoorOpen = 0

    this._onPhysicsTick = () => this._tick()
    this.bot.on('physicsTick', this._onPhysicsTick)
  }

  destroy () {
    this.bot.removeListener('physicsTick', this._onPhysicsTick)
  }

  getClimbableAt (pos) {
    if (!this.bot?.blockAt || !pos) return null
    const b = this.bot.blockAt(pos.floored())
    if (b && isClimbable(b)) return b
    return null
  }

  getCurrentLadder () {
    if (!this.bot?.entity?.position) return null
    const pos = this.bot.entity.position
    const feet = this.getClimbableAt(pos)
    if (feet) return feet
    const waist = this.getClimbableAt(pos.offset(0, 1, 0))
    if (waist) return waist
    const below = this.getClimbableAt(pos.offset(0, -0.4, 0))
    if (below) return below
    return null
  }

  isOnLadder () {
    return Boolean(this.getCurrentLadder())
  }

  isLadderNearby (targetPoint, maxDist = 16) {
    if (this.isOnLadder()) return true
    if (!this.bot?.entity?.position || !targetPoint) return false
    const botPos = this.bot.entity.position
    const heightGap = Math.abs(targetPoint.y - botPos.y)
    if (heightGap < 2) return false

    const mcData = this.bot.registry || mcDataLoader(this.bot.version || '1.21.1')
    if (!mcData?.blocksByName) return false

    const ids = []
    for (const name of CLIMBABLE_NAMES) {
      const b = mcData.blocksByName[name]
      if (b && !ids.includes(b.id)) ids.push(b.id)
    }
    if (ids.length === 0) return false

    if (typeof this.bot.findBlocks === 'function') {
      try {
        const found = this.bot.findBlocks({
          matching: ids,
          maxDistance: maxDist,
          count: 1
        })
        return found.length > 0
      } catch {}
    }
    return false
  }

  _resolveTarget () {
    const custom = this.getTarget ? this.getTarget() : null
    if (custom && Number.isFinite(custom.y)) return custom

    const goal = this.bot?.pathfinder?.goal
    if (goal && Number.isFinite(goal.y)) {
      return new Vec3(goal.x ?? this.bot.entity.position.x, goal.y, goal.z ?? this.bot.entity.position.z)
    }

    return null
  }

  async _checkTrapdoorAbove (ladderBlock) {
    if (!ladderBlock || !this.bot.activateBlock) return
    const now = Date.now()
    if (now - this._lastTrapdoorOpen < 1000) return

    const abovePos = ladderBlock.position.offset(0, 1, 0)
    const above2Pos = ladderBlock.position.offset(0, 2, 0)

    for (const checkPos of [abovePos, above2Pos]) {
      const block = this.bot.blockAt(checkPos)
      if (block && block.name.endsWith('_trapdoor') && !block.name.includes('iron')) {
        const isOpen = block._properties?.open === true || block.properties?.open === true
        if (!isOpen) {
          this._lastTrapdoorOpen = now
          this.logger?.debug(`[Ladder] Membuka trapdoor tertutup di (${checkPos.x}, ${checkPos.y}, ${checkPos.z})`)
          try {
            await this.bot.activateBlock(block)
          } catch {}
          break
        }
      }
    }
  }

  _tick () {
    if (!this.bot?.entity || !this.bot.entity.position) return

    const ladder = this.getCurrentLadder()
    if (!ladder) {
      if (this.climbing) {
        this.climbing = false
        this.busy = false
      }
      return
    }

    const target = this._resolveTarget()
    if (!target) return

    const botY = this.bot.entity.position.y
    const targetY = target.y
    const diffY = targetY - botY

    if (this.bot.entity.onGround && diffY <= 0.3) {
      if (this.climbing) {
        this.climbing = false
        this.busy = false
      }
      return
    }

    if (diffY > 0.3) {
      // Climbing UP
      this.climbing = true
      this.busy = true

      this._checkTrapdoorAbove(ladder).catch(() => {})

      const wallVec = getWallVector(ladder)
      const lookPos = this.bot.entity.position.offset(wallVec.x, 0.4, wallVec.z)
      try {
        this.bot.lookAt(lookPos, true).catch?.(() => {})
      } catch {}

      this.bot.setControlState('forward', true)
      this.bot.setControlState('jump', true)
      this.bot.setControlState('sneak', false)
      this.bot.setControlState('sprint', false)
    } else if (diffY < -0.5) {
      // Climbing DOWN
      this.climbing = true
      this.busy = true

      const wallVec = getWallVector(ladder)
      const lookPos = this.bot.entity.position.offset(wallVec.x * 0.5, -0.2, wallVec.z * 0.5)
      try {
        this.bot.lookAt(lookPos, true).catch?.(() => {})
      } catch {}

      this.bot.setControlState('jump', false)
      this.bot.setControlState('sneak', false)
      this.bot.setControlState('forward', false)
    } else {
      if (this.climbing) {
        this.climbing = false
        this.busy = false
        this.bot.setControlState('jump', true)
        this.bot.setControlState('forward', true)
      }
    }
  }
}

module.exports = { LadderNavigator, isClimbable, getWallVector, CLIMBABLE_NAMES }
