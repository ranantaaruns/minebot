'use strict'

const Vec3 = require('vec3')
const { goals } = require('mineflayer-pathfinder')
const { applyMovements } = require('../movements')
const { sleep, withTimeout, CancelledError } = require('../util/async')
const { findItemName } = require('../util/inventory')
const { resolveItemName } = require('../materials/requirements')
const { substituteBlockState } = require('../materials/biomes')
const { orderActions } = require('./order')
const { pillarUp, removeTower } = require('./scaffold')
const {
  bareName,
  isAir,
  isReplaceable,
  isLiquid,
  inReach,
  matchesState,
  orderedReferences,
  candidateStandingSpots,
  collidesWithBlock,
  hasCollisionBox,
  isInteractable,
  isStairs,
  isDoor,
  isTrapdoor,
  isDirectionalOpposite,
  eyePosition,
  FACING_VECTORS,
  DIRECTIONAL_FACING_OPPOSITE,
  INTERACTABLE
} = require('./placement')

class Builder {
  constructor (bot, blueprint, options = {}) {
    this.bot = bot
    this.blueprint = blueprint
    this.options = options
    this.config = options.config
    this.logger = options.logger
    this.mcData = require('minecraft-data')(bot.version)
    this.materials = options.materials || null
    this.substitutions = options.substitutions || new Map()
    this.allowGather = options.allowGather !== false
    this.cancellation = options.cancellation || null
    this.origin = (options.origin || bot.entity.position.floored()).clone()
    this.paused = false
    this.scaffolds = []
    this.failedActions = []
    this.orientationWarnings = 0
    this.counted = new Set()

    this.progress = {
      total: 0,
      done: 0,
      skipped: 0,
      failed: 0,
      pass: 0,
      current: null
    }

    this.actions = this._buildActions()
    this.progress.total = this.actions.length
  }

  get isCreative () {
    return this.bot?.game?.gameMode === 'creative'
  }

  _buildActions () {
    const actions = []
    for (const block of this.blueprint.blocks) {
      const substituted = substituteBlockState(
        block.name,
        block.properties || {},
        this.substitutions,
        this.mcData
      )
      if (!substituted) {
        this.logger?.warn(`Alternatif untuk ${block.name} tidak tersedia`)
        continue
      }
      const state = { name: substituted.name, properties: substituted.properties }
      const resolved = resolveItemName(state, this.mcData)
      if (!resolved.itemName) {
        this.logger?.warn(`Blok ${block.name} di (${block.x}, ${block.y}, ${block.z}) dilewati: ${resolved.reason || 'tidak didukung'}`)
        continue
      }

      actions.push({
        pos: new Vec3(
          this.origin.x + block.x,
          this.origin.y + block.y,
          this.origin.z + block.z
        ),
        name: substituted.name,
        properties: substituted.properties,
        itemName: resolved.itemName,
        fallbackName: resolved.fallbackName || null,
        originalName: block.name
      })
    }

    return orderActions(actions, this.bot.entity.position)
  }

  _report () {
    if (typeof this.options?.onProgress === 'function') {
      this.options.onProgress(this.progress)
    }
  }

  _countOnce (action, kind) {
    const key = action.pos.toString()
    if (this.counted.has(key)) return
    this.counted.add(key)
    this.progress[kind]++
  }

  _assertSafe () {
    if (this.isCreative) return
    const minHealth = this.config?.safety?.minHealth ?? 6
    if (this.bot.health !== undefined && this.bot.health < minHealth) {
      throw new Error(`Health rendah (${this.bot.health}), build dihentikan`)
    }
  }

  async _waitIfPaused () {
    while (this.paused) {
      this.cancellation?.throwIfCancelled()
      await sleep(500, this.cancellation)
    }
  }

  pause () { this.paused = true }
  resume () { this.paused = false }

  _isDone (action) {
    const block = this.bot.blockAt(action.pos)
    if (!block) return false
    const matchesName = block.name === bareName(action.name) ||
      (action.fallbackName && block.name === bareName(action.fallbackName))
    return Boolean(matchesName && matchesState(block, action))
  }

  _collidesWith (pos, blockName = null) {
    if (blockName && !hasCollisionBox(this.mcData, blockName)) return false
    return collidesWithBlock(this.bot, pos)
  }

  async _pathTo (pos, distance = 1, timeoutMs = 8000) {
    try {
      const goal = distance === 0
        ? new goals.GoalBlock(pos.x, pos.y, pos.z)
        : new goals.GoalNear(pos.x, pos.y, pos.z, distance)
      await withTimeout(
        this.bot.pathfinder.goto(goal),
        timeoutMs,
        'Pathfinding timeout'
      )
      await sleep(50, this.cancellation)
      return true
    } catch (err) {
      this.logger?.debug(`Path ke ${pos} gagal: ${err.message}`)
      try { this.bot.pathfinder.stop() } catch {}
      return false
    }
  }

  /**
   * Walk directly to a nearby position without using A* pathfinder.
   * Works for short distances (1-3 blocks) where the pathfinder is overkill
   * or unable to compute a path in confined spaces.
   */
  async _directWalkTo (target, timeoutMs = 3000) {
    const targetCenter = target.offset(0.5, 0, 0.5)
    const startDist = this.bot.entity.position.distanceTo(targetCenter)
    if (startDist < 0.3) return true // already there
    if (startDist > 6) return false // too far for direct walk
    if (typeof this.bot.lookAt !== 'function' || typeof this.bot.setControlState !== 'function') return false

    const startTime = Date.now()
    try {
      // Look at target
      await this.bot.lookAt(targetCenter.offset(0, 1, 0), true)
      this.bot.setControlState('forward', true)

      while (Date.now() - startTime < timeoutMs) {
        this.cancellation?.throwIfCancelled()
        const dist = this.bot.entity.position.distanceTo(targetCenter)
        if (dist < 0.6) {
          this.bot.setControlState('forward', false)
          await sleep(50, this.cancellation)
          return true
        }

        // Re-look towards target during walk
        const currentDist = this.bot.entity.position.distanceTo(targetCenter)
        if (currentDist < startDist + 2) {
          await this.bot.lookAt(targetCenter.offset(0, 1, 0), true)
        } else {
          // Moving away, bail
          break
        }

        await sleep(50, this.cancellation)
      }
    } catch {
      // ignore
    } finally {
      try { this.bot.setControlState('forward', false) } catch {}
      try { this.bot.setControlState('back', false) } catch {}
      try { this.bot.setControlState('left', false) } catch {}
      try { this.bot.setControlState('right', false) } catch {}
    }
    return false
  }

  /**
   * Move to a position, trying direct walk first, then A* pathfinder,
   * then creative teleport as a last resort.
   */
  async _moveTo (pos, distance = 0) {
    const targetCenter = pos.offset(0.5, 0, 0.5)
    const currentDist = this.bot.entity.position.distanceTo(targetCenter)

    // Already close enough
    if (currentDist < (distance > 0 ? distance : 0.6)) return true

    // In creative mode, if far away or vertical jump, teleport directly for speed
    if (this.isCreative && (currentDist > 3 || Math.abs(this.bot.entity.position.y - targetCenter.y) > 1.5)) {
      const ok = await this._creativeTeleport(pos)
      if (ok) return true
    }

    // For short distances, try direct walk first (avoids A* issues in confined spaces)
    if (currentDist < 4 && distance === 0) {
      const ok = await this._directWalkTo(pos, 2000)
      if (ok) return true
    }

    // Try A* pathfinder with shorter timeout for build movements
    const ok = await this._pathTo(pos, distance, 3000)
    if (ok) return true

    // In creative mode, use /tp as last resort
    if (this.isCreative) {
      return this._creativeTeleport(pos)
    }

    return false
  }

  /**
   * Teleport to a position using /tp command (creative mode only).
   */
  async _creativeTeleport (pos) {
    if (!this.isCreative) return false
    try {
      const tp = pos.offset(0.5, 0, 0.5)
      this.bot.chat(`/tp ${this.bot.username} ${tp.x.toFixed(1)} ${tp.y.toFixed(1)} ${tp.z.toFixed(1)}`)
      await sleep(80, this.cancellation)

      // Verify we actually moved close to the destination
      const dist = this.bot.entity.position.distanceTo(tp)
      if (dist < 2) {
        this.logger?.debug(`Teleport ke ${pos} berhasil`)
        return true
      }
    } catch (err) {
      this.logger?.debug(`Teleport gagal: ${err.message}`)
    }
    return false
  }

  async _stepAwayFrom (targetPos) {
    const spots = candidateStandingSpots(this.bot, targetPos, {
      radius: 3,
      reach: this.config.build.reach,
      allowAir: this.isCreative
    })

    for (const spot of spots.slice(0, 4)) {
      this.cancellation?.throwIfCancelled()
      const ok = await this._moveTo(spot.feet, 0)
      if (ok && !this._collidesWith(targetPos)) {
        return true
      }
    }

    try {
      const cur = this.bot.entity.position
      const dx = cur.x - (targetPos.x + 0.5)
      const dz = cur.z - (targetPos.z + 0.5)
      const dist = Math.hypot(dx, dz)
      const dirX = dist > 0.01 ? dx / dist : -1
      const dirZ = dist > 0.01 ? dz / dist : 0
      const stepX = Math.floor(cur.x + dirX * 1.5)
      const stepZ = Math.floor(cur.z + dirZ * 1.5)
      const fallbackPos = new Vec3(stepX, Math.floor(cur.y), stepZ)

      const ok = await this._moveTo(fallbackPos, 0)
      if (ok && !this._collidesWith(targetPos)) return true
    } catch {}

    return false
  }

  async _clearTarget (action) {
    const block = this.bot.blockAt(action.pos)
    if (!block) return false
    if (isAir(block)) return true
    const isTarget = block.name === bareName(action.name) ||
      (action.fallbackName && block.name === bareName(action.fallbackName))
    if (isTarget && matchesState(block, action)) return true
    if (isLiquid(block)) return false
    if (!block.diggable) {
      this.logger?.warn(`Blok ${block.name} di ${action.pos} tidak bisa digali`)
      return false
    }
    if (isInteractable(block)) {
      this.logger?.warn(`Tidak menghancurkan ${block.name} di ${action.pos}`)
      return false
    }

    if (!inReach(this.bot, action.pos, this.config.build.reach)) {
      const ok = await this._moveTo(action.pos, 2)
      if (!ok) return false
    }

    if (this.isCreative) {
      try {
        await withTimeout(this.bot.dig(block), 3000, 'Menggali blok timeout')
        await sleep(80, this.cancellation)
        const after = this.bot.blockAt(action.pos)
        return !after || isAir(after)
      } catch (err) {
        this.logger?.debug(`Gagal menggali target creative ${action.pos}: ${err.message}`)
        return false
      }
    }

    try {
      if (typeof this.bot.tool?.equipForBlock === 'function') {
        await this.bot.tool.equipForBlock(block)
      }
      await withTimeout(this.bot.dig(block), 15000, 'Menggali blok timeout')
      await sleep(150, this.cancellation)
      const after = this.bot.blockAt(action.pos)
      return !after || isAir(after)
    } catch (err) {
      this.logger?.debug(`Gagal menggali target ${action.pos}: ${err.message}`)
      return false
    }
  }

  _placementOptions (action) {
    const opts = { swingArm: 'right' }
    const props = action.properties || {}
    const bare = bareName(action.name || '')

    if (props.type === 'top' || props.half === 'top') opts.half = 'top'
    if (props.type === 'bottom' || props.half === 'bottom') opts.half = 'bottom'

    // Calculate delta for doors to correctly place hinge (left vs right)
    if (isDoor(bare) && props.facing && FACING_VECTORS[props.facing]) {
      const f = FACING_VECTORS[props.facing]
      const leftVec = new Vec3(f.z, 0, -f.x)
      const sideVec = props.hinge === 'left' ? leftVec : leftVec.scaled(-1)
      opts.delta = new Vec3(0.5 + sideVec.x * 0.3, 1.0, 0.5 + sideVec.z * 0.3)
    }

    return opts
  }

  async _tryPlaceAt (action) {
    if (this._collidesWith(action.pos, action.name)) return false
    if (!inReach(this.bot, action.pos, this.config.build.reach)) return false

    const refs = orderedReferences(this.bot, action.pos, action, this.mcData)
    if (refs.length === 0) return false

    const item = findItemName(this.bot, this.mcData, action.itemName)
    if (!item) return false

    const options = this._placementOptions(action)
    const bareActionName = bareName(action.name || '')
    const desiredFacing = action.properties?.facing || (action.properties?.orientation ? action.properties.orientation.split('_')[0] : null)

    for (const ref of refs) {
      this.cancellation?.throwIfCancelled()
      let sneaked = false
      try {
        await this.bot.equip(item, 'hand')

        // Orient bot look direction for directional blocks
        if (desiredFacing) {
          const faceVec = FACING_VECTORS[desiredFacing]
          if (faceVec && typeof this.bot.lookAt === 'function') {
            const eye = eyePosition(this.bot)
            if (isDoor(bareActionName)) {
              // Doors face the same direction the player looks
              await this.bot.lookAt(eye.plus(faceVec), true)
              options.forceLook = 'ignore'
              await sleep(15, this.cancellation)
            } else if (isDirectionalOpposite(bareActionName)) {
              // Stairs, observer, dispenser, dropper, piston, crafter, chest, furnace face opposite
              const lookVec = faceVec.scaled(-1)
              await this.bot.lookAt(eye.plus(lookVec), true)
              options.forceLook = 'ignore'
              await sleep(15, this.cancellation)
            }
          }
        }

        // If placing against an interactable block, bot must sneak so it doesn't open the container GUI
        const isSneakNeeded = ref.interactable || isInteractable(ref.block) || isInteractable(bareActionName)
        if (isSneakNeeded) {
          this.bot.setControlState('sneak', true)
          sneaked = true
          await sleep(20, this.cancellation)
        }

        if (typeof this.bot._placeBlockWithOptions === 'function') {
          await this.bot._placeBlockWithOptions(ref.block, ref.face, options)
        } else {
          await this.bot.placeBlock(ref.block, ref.face)
        }

        if (sneaked) {
          this.bot.setControlState('sneak', false)
          sneaked = false
        }

        // Auto-close any container GUI that might have opened
        if (this.bot.currentWindow) {
          try { this.bot.closeWindow(this.bot.currentWindow) } catch {}
        }

        const placed = this.bot.blockAt(action.pos)
        const placedMatch = placed && (
          placed.name === bareName(action.name) ||
          (action.fallbackName && placed.name === bareName(action.fallbackName))
        )
        if (placedMatch) {
          if (!matchesState(placed, action)) {
            this.orientationWarnings++
            this.logger?.debug(`Orientasi ${placed.name} di ${action.pos} tidak persis seperti blueprint`)
          }
          return true
        }
      } catch (err) {
        this.logger?.debug(`Place gagal ${action.name} di ${action.pos}: ${err.message}`)
        if (/still air/i.test(err.message)) {
          await this._stepAwayFrom(action.pos)
        }
      } finally {
        if (sneaked || (typeof this.bot.getControlState === 'function' && this.bot.getControlState('sneak'))) {
          this.bot.setControlState('sneak', false)
        }
        if (this.bot.currentWindow) {
          try { this.bot.closeWindow(this.bot.currentWindow) } catch {}
        }
      }
    }

    return false
  }

  _facingScore (spot, action) {
    const bareActionName = bareName(action.name || '')
    const desiredFacing = action.properties?.facing || (action.properties?.orientation ? action.properties.orientation.split('_')[0] : null)
    if (!desiredFacing) return 0

    let targetVec = FACING_VECTORS[desiredFacing]
    if (!targetVec) return 0

    // For directional opposite blocks (like observer, dispenser, dropper, piston, crafter, stairs, furnace, chest),
    // the bot needs to look opposite to desired facing.
    // So standing at `spot` and looking toward `action.pos` should align with targetVec.scaled(-1).
    if (isDirectionalOpposite(bareActionName)) {
      targetVec = targetVec.scaled(-1)
    }

    const dir = new Vec3(action.pos.x - spot.x, 0, action.pos.z - spot.z)
    if (dir.x === 0 && dir.z === 0) return 0
    const length = Math.sqrt(dir.x * dir.x + dir.z * dir.z)
    dir.x /= length
    dir.z /= length
    return dir.x * targetVec.x + dir.z * targetVec.z
  }

  async _tryFromStandingSpots (action) {
    const radius = 3
    let spots = candidateStandingSpots(this.bot, action.pos, {
      radius,
      reach: this.config.build.reach,
      allowAir: this.isCreative
    })
    if (spots.length === 0) return false

    spots = spots
      .map(spot => ({ ...spot, score: this._facingScore(spot.feet, action) }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score
        return a.distance - b.distance
      })
      .slice(0, 6)

    let consecutiveFails = 0
    for (const spot of spots) {
      this.cancellation?.throwIfCancelled()
      const spotCenter = spot.feet.offset(0.5, 0, 0.5)
      const dist = this.bot.entity.position.distanceTo(spotCenter)
      const isColliding = this._collidesWith(action.pos, action.name)

      if (dist > 0.45 || isColliding) {
        const ok = await this._moveTo(spot.feet, 0)
        if (!ok) {
          consecutiveFails++
          // If pathfinding fails 3 times in a row, bail early — the area is likely inaccessible
          if (consecutiveFails >= 3) {
            this.logger?.debug(`3 path gagal berturut-turut untuk ${action.pos}, melewati...`)
            return false
          }
          continue
        }
        consecutiveFails = 0
      }

      if (this._collidesWith(action.pos, action.name)) continue

      if (await this._tryPlaceAt(action)) return true
    }

    return false
  }

  async _ensureCreativeItem (itemName) {
    let item = findItemName(this.bot, this.mcData, itemName)
    if (item) return item
    if (!this.isCreative || !this.bot.creative) return null

    const bare = bareName(itemName)
    const itemDef = this.mcData.itemsByName[bare]
    if (!itemDef) return null

    let Item = null
    try {
      Item = require('prismarine-item')(this.bot.version || this.mcData?.version?.minecraftVersion || '1.21.1')
    } catch {
      return null
    }

    const quickbarSlots = [36, 37, 38, 39, 40, 41, 42, 43, 44]
    const emptySlot = quickbarSlots.find(s => !this.bot.inventory?.slots?.[s]) || 36

    try {
      await this.bot.creative.setInventorySlot(emptySlot, new Item(itemDef.id, 64))
      await sleep(50, this.cancellation)
      return findItemName(this.bot, this.mcData, itemName)
    } catch (err) {
      this.logger?.debug(`Gagal spawn item creative ${itemName}: ${err.message}`)
      return null
    }
  }

  async _ensureScaffoldBlock () {
    const candidates = this.config.build.scaffold.blocks
    for (const name of candidates) {
      if (findItemName(this.bot, this.mcData, name)) return name
    }
    if (this.isCreative) {
      const scaffold = candidates[0] || 'scaffolding'
      const item = await this._ensureCreativeItem(scaffold)
      if (item) return scaffold
    }
    if (!this.materials || !this.allowGather) return null

    for (const name of candidates) {
      try {
        const result = await this.materials.ensureItem(name, 4, this.cancellation)
        if (result.ok && findItemName(this.bot, this.mcData, name)) return name
      } catch (err) {
        this.logger?.debug(`Scaffold ${name} gagal disiapkan: ${err.message}`)
      }
    }
    return null
  }

  async _tryWithScaffold (action) {
    if (this.isCreative) {
      // In creative mode, NEVER place scaffold blocks (no dirt towering!).
      return false
    }

    if (!this.config.build.scaffold.enabled) return false
    if (action.pos.y <= this.bot.entity.position.y + 1) return false

    const scaffoldName = await this._ensureScaffoldBlock()
    if (!scaffoldName) return false

    const groundLevel = this.bot.entity.position.floored().y
    const pseudoTarget = new Vec3(action.pos.x, groundLevel, action.pos.z)
    const spots = candidateStandingSpots(this.bot, pseudoTarget, { radius: 3 })
      .filter(spot => {
        const horizontal = Math.abs(spot.feet.x - action.pos.x) + Math.abs(spot.feet.z - action.pos.z)
        return horizontal <= 3
      })
      .slice(0, 4)

    for (const spot of spots) {
      this.cancellation?.throwIfCancelled()
      const ok = await this._moveTo(spot.feet, 0)
      if (!ok) continue

      const result = await pillarUp(this.bot, action.pos.y - 1, {
        mcData: this.mcData,
        candidates: [scaffoldName],
        cancellation: this.cancellation,
        logger: this.logger
      })
      if (result.placed.length > 0) this.scaffolds.push(...result.placed)

      if (await this._tryPlaceAt(action)) return true
    }

    return false
  }

  async _placeAction (action) {
    this._assertSafe()

    let item = findItemName(this.bot, this.mcData, action.itemName)
    if (!item && this.isCreative) {
      item = await this._ensureCreativeItem(action.itemName)
    }
    if (!item && this.materials && this.allowGather && this.config.gather.enabled) {
      const result = await this.materials.ensureItem(action.itemName, 1, this.cancellation)
      if (result.ok) item = findItemName(this.bot, this.mcData, action.itemName)
    }
    if (!item) {
      this.logger?.warn(`Tidak punya ${action.itemName} untuk ${action.pos}`)
      return 'fail'
    }

    const current = this.bot.blockAt(action.pos)
    if (!isAir(current)) {
      const cleared = await this._clearTarget(action)
      if (!cleared) return 'defer'
    }

    if (this._collidesWith(action.pos, action.name)) {
      this.logger?.debug?.(`Bot berada di posisi blok ${action.pos}, melangkah keluar...`)
      await this._stepAwayFrom(action.pos)
    }

    if (!this._collidesWith(action.pos, action.name) && await this._tryPlaceAt(action)) return 'done'

    // If not in reach, try to move closer first before exhaustive standing-spot search
    if (!inReach(this.bot, action.pos, this.config.build.reach)) {
      const reached = await this._moveTo(action.pos, 2)
      if (reached && !this._collidesWith(action.pos, action.name) && await this._tryPlaceAt(action)) return 'done'
    }

    if (await this._tryFromStandingSpots(action)) return 'done'

    if (await this._tryWithScaffold(action)) return 'done'

    return 'defer'
  }

  async _removeScaffolds () {
    if (!this.config.build.removeScaffolds || this.scaffolds.length === 0) return
    const unique = new Map()
    for (const pos of this.scaffolds) unique.set(pos.toString(), pos)
    this.logger?.info(`Membongkar ${unique.size} blok scaffold...`)
    try {
      await removeTower(this.bot, [...unique.values()], {
        cancellation: this.cancellation,
        logger: this.logger
      })
    } catch (err) {
      this.logger?.debug(`Bongkar scaffold: ${err.message}`)
    }
  }

  async build () {
    applyMovements(this.bot, 'build')
    if (this.isCreative && typeof this.bot?.creative?.startFlying === 'function') {
      try { this.bot.creative.startFlying() } catch {}
    }
    this.logger?.info(
      `Build "${this.blueprint.name}" ${this.blueprint.size.x}x${this.blueprint.size.y}x${this.blueprint.size.z} ` +
      `(${this.actions.length} blok) di ${this.origin.x} ${this.origin.y} ${this.origin.z}`
    )

    let pending = this.actions

    const onWindowOpen = (window) => {
      this.logger?.debug?.(`Menutup window container (${window.title || window.type}) yang terbuka saat build`)
      try { this.bot.closeWindow(window) } catch {}
    }
    if (typeof this.bot?.on === 'function') {
      this.bot.on('windowOpen', onWindowOpen)
    }

    try {
      for (let pass = 0; pass < this.config.build.maxPasses && pending.length > 0; pass++) {
        this.progress.pass = pass + 1
        this.logger?.info(`Pass ${pass + 1}: ${pending.length} blok tersisa`)
        const deferred = []

        for (let i = 0; i < pending.length; i++) {
          this.cancellation?.throwIfCancelled()
          await this._waitIfPaused()
          if (!this.isCreative && this.bot.foodManager && !await this.bot.foodManager.waitUntilReady(this.cancellation)) {
            if (this.cancellation) {
              this.cancellation.cancel('Makanan habis')
              this.cancellation.throwIfCancelled()
            }
            throw new Error('Makanan habis')
          }
          this._assertSafe()

          const action = pending[i]
          this.progress.current = action

          if (this._isDone(action)) {
            this._countOnce(action, 'skipped')
            this._report()
            continue
          }

          let result = 'fail'
          try {
            result = await this._placeAction(action)
          } catch (err) {
            if (err instanceof CancelledError || err?.cancelled) throw err
            this.logger?.warn(`Blok gagal ${action.pos}: ${err.message}`)
          }

          if (result === 'done') {
            this._countOnce(action, 'done')
          } else if (result === 'defer') {
            deferred.push(action)
          } else {
            this._countOnce(action, 'failed')
            this.failedActions.push(action)
          }

          this._report()

          const processed = this.progress.done + this.progress.skipped + this.progress.failed
          if (processed % 10 === 0) {
            const pct = ((processed / this.progress.total) * 100).toFixed(1)
            this.logger?.info(`Progress ${processed}/${this.progress.total} (${pct}%)`)
          }

          const delay = this.isCreative ? 10 : (this.config.build.placeDelayMs ?? 20)
          if (delay > 0) {
            await sleep(delay, this.cancellation)
          }
        }

        pending = deferred
        if (deferred.length > 0 && pass < this.config.build.maxPasses - 1) {
          this.logger?.warn(`${deferred.length} blok ditunda, mencoba pass berikutnya`)
          pending = orderActions(pending, this.bot.entity.position)
        }
      }
    } finally {
      if (this.isCreative && typeof this.bot?.creative?.stopFlying === 'function') {
        try { this.bot.creative.stopFlying() } catch {}
      }
      if (typeof this.bot?.removeListener === 'function') {
        this.bot.removeListener('windowOpen', onWindowOpen)
      }
      if (this.bot?.currentWindow) {
        try { this.bot.closeWindow(this.bot.currentWindow) } catch {}
      }
      try { this.bot.pathfinder.stop() } catch {}
      applyMovements(this.bot, 'travel', this.config.owner)
    }

    for (const action of pending) {
      if (!this.counted.has(action.pos.toString())) {
        this.counted.add(action.pos.toString())
        this.progress.failed++
        this.failedActions.push(action)
      }
    }

    await this._removeScaffolds()

    const result = {
      total: this.progress.total,
      done: this.progress.done,
      skipped: this.progress.skipped,
      failed: this.progress.failed,
      remaining: pending.length,
      orientationWarnings: this.orientationWarnings,
      failedActions: this.failedActions
    }

    this.logger?.info(
      `Build selesai: ${result.done} dipasang, ${result.skipped} sudah ada, ` +
      `${result.failed} gagal, ${result.remaining} tersisa`
    )
    if (result.orientationWarnings > 0) {
      this.logger?.warn(`${result.orientationWarnings} blok punya orientasi berbeda dari blueprint`)
    }

    return result
  }
}

module.exports = { Builder, FACING_VECTORS }
