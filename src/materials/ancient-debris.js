'use strict'

const Vec3 = require('vec3')
const { goals } = require('mineflayer-pathfinder')
const { withTimeout, sleep } = require('../util/async')
const { countItemName, findItemName } = require('../util/inventory')
const { isNether, isSafeFromLava, lavaNear, hasGoldArmor, findGoldArmorInInventory } = require('../safety/nether')
const { escapeLava, isInLava } = require('../safety/lava')
const { applyMovements } = require('../movements')

async function mineAncientDebris (bot, mcData, materials, count, options = {}) {
  const {
    logger,
    cancellation,
    timeoutPerBlockMs = 45000,
    targetDebrisY = 14,
    mineRadius = 48,
    maxRounds = 40,
    maxLavaTurns = 4
  } = options

  const before = countItemName(bot, mcData, 'ancient_debris')
  if (before >= count) return { ok: true, have: before, mined: 0, missing: 0 }

  // 1. Verify dimension is Nether
  if (!isNether(bot)) {
    const msg = 'Ancient debris hanya ada di Nether (Y 8-22)! Masuklah ke portal Nether bersama bot terlebih dahulu.'
    logger?.warn(msg)
    return { ok: false, have: before, missing: count - before, reason: 'dimension-not-nether', message: msg }
  }

  // 2. Verify Pickaxe Requirement (Diamond or Netherite Pickaxe)
  let pickaxe = findItemName(bot, mcData, 'diamond_pickaxe') || findItemName(bot, mcData, 'netherite_pickaxe')
  if (!pickaxe) {
    if (materials && typeof materials.ensureTool === 'function') {
      const ok = await materials.ensureTool('pickaxe', 'diamond', cancellation)
      if (ok) pickaxe = findItemName(bot, mcData, 'diamond_pickaxe') || findItemName(bot, mcData, 'netherite_pickaxe')
    }
  }

  if (!pickaxe) {
    const msg = 'Menambang ancient debris membutuhkan Diamond Pickaxe atau Netherite Pickaxe agar tidak hancur sia-sia! Siapkan pickaxe tersebut di inventory bot.'
    logger?.warn(msg)
    return { ok: false, have: before, missing: count - before, reason: 'no-diamond-pickaxe', message: msg }
  }

  // 3. Equip gold armor for piglin pacification if available
  if (!hasGoldArmor(bot)) {
    const goldArmor = findGoldArmorInInventory(bot)
    if (goldArmor) {
      try {
        const dest = goldArmor.name.endsWith('_helmet') ? 'head'
          : goldArmor.name.endsWith('_chestplate') ? 'torso'
          : goldArmor.name.endsWith('_leggings') ? 'legs' : 'feet'
        await bot.equip(goldArmor, dest)
        logger?.info(`Memakai ${goldArmor.name} agar piglin bersikap netral di Nether`)
      } catch {}
    }
  }

  // 4. Set movements
  const gatherMovements = applyMovements(bot, 'gather', options)
  if (bot.collectBlock && gatherMovements) {
    // collectBlock mengganti movements pathfinder dengan miliknya sendiri; pakai
    // movements gather agar bot tetap bisa menumpuk 1x1 saat mengejar blok.
    bot.collectBlock.movements = gatherMovements
  }

  const structureAvoidance = bot.structureAvoidance
  let have = before
  let mined = 0

  const debrisId = mcData.blocksByName.ancient_debris?.id
  if (!debrisId) {
    return { ok: false, have: before, missing: count - before, reason: 'unknown-block' }
  }

  logger?.info(`Mulai menambang ancient debris: target ${count}, saat ini ${have}`)

  let round = 0
  let lavaTurns = 0
  let stopReason = null

  while (have < count && round++ < maxRounds) {
    cancellation?.throwIfCancelled()

    // Safety checks in Nether
    if (bot.health !== undefined && bot.health < 10) {
      logger?.warn(`Health rendah di Nether (${bot.health}), berhenti menambang untuk keselamatan`)
      stopReason = 'low-health'
      break
    }
    if (bot.foodManager && !await bot.foodManager.waitUntilReady(cancellation)) {
      logger?.warn('Makanan habis di Nether, berhenti menambang')
      stopReason = 'no-food'
      break
    }

    // Refresh structure avoidance scan
    structureAvoidance?.scan()

    // Check if any ancient debris is visible in loaded chunks
    let positions = []
    if (bot.findBlocks) {
      try {
        positions = bot.findBlocks({
          matching: debrisId,
          maxDistance: mineRadius,
          count: 16
        })
      } catch {}
    }

    // Filter out unsafe debris (adjacent to lava or in structure danger zones)
    positions = positions.filter(pos => {
      if (!isSafeFromLava(bot, pos) || lavaNear(bot, pos, 1)) {
        logger?.debug?.(`Melewati ancient debris di ${pos}: terdeteksi lava berdekatan`)
        return false
      }
      if (structureAvoidance?.isInsideDangerZone(pos)) {
        logger?.debug?.(`Melewati ancient debris di ${pos}: berada di dekat struktur berbahaya`)
        return false
      }
      return true
    })

    // If safe debris found, mine it!
    if (positions.length > 0) {
      positions.sort((a, b) => bot.entity.position.distanceTo(a) - bot.entity.position.distanceTo(b))
      const targetPos = positions[0]
      const targetBlock = bot.blockAt(targetPos)

      if (targetBlock && targetBlock.type === debrisId) {
        logger?.info(`Menemukan ancient debris aman di ${targetPos}! Menambang...`)
        try {
          pickaxe = findItemName(bot, mcData, 'diamond_pickaxe') || findItemName(bot, mcData, 'netherite_pickaxe')
          if (pickaxe) await bot.equip(pickaxe, 'hand')

          if (bot.collectBlock?.collect) {
            await withTimeout(
              bot.collectBlock.collect(targetBlock, { ignoreNoPath: true }),
              timeoutPerBlockMs,
              'Menambang ancient debris timeout'
            )
          } else {
            if (bot.entity.position.distanceTo(targetPos) > 4) {
              await bot.pathfinder?.goto(new goals.GoalNear(targetPos.x, targetPos.y, targetPos.z, 2))
            }
            await bot.dig(targetBlock)
          }
          mined++
          await sleep(500, cancellation)
          have = countItemName(bot, mcData, 'ancient_debris')
          logger?.info(`Progress ancient debris: ${have}/${count}`)
          continue
        } catch (err) {
          logger?.debug(`Gagal menambang debris di ${targetPos}: ${err.message}`)
        }
      }
    }

    // If no exposed ancient debris in loaded chunks, conduct safe strip mining at Y=14
    const currentY = bot.entity?.position?.y ? Math.floor(bot.entity.position.y) : targetDebrisY
    if (Math.abs(currentY - targetDebrisY) > 3) {
      logger?.info(`Menuju ke lapisan aman ancient debris (Y=${targetDebrisY}) dari Y=${currentY}...`)
      try {
        await withTimeout(
          bot.pathfinder.goto(new goals.GoalNear(bot.entity.position.x, targetDebrisY, bot.entity.position.z, 2)),
          15000,
          'Perjalanan ke lapisan target Y timeout'
        )
      } catch (err) {
        logger?.debug(`Pathfinding ke Y=${targetDebrisY}: ${err.message}`)
      }
    }

    // Dig forward in a safe direction
    let mineDir = new Vec3(0, 0, 1) // default South
    if (structureAvoidance?.isInsideDangerZone(bot.entity?.position)) {
      mineDir = structureAvoidance.getRetreatVector(bot)
    }

    if (Math.abs(mineDir.x) > Math.abs(mineDir.z)) {
      mineDir = new Vec3(Math.sign(mineDir.x) || 1, 0, 0)
    } else {
      mineDir = new Vec3(0, 0, Math.sign(mineDir.z) || 1)
    }

    const feetPos = bot.entity ? bot.entity.position.floored() : new Vec3(0, targetDebrisY, 0)
    const nextFeet = feetPos.plus(mineDir)
    const nextHead = nextFeet.offset(0, 1, 0)

    // Lava bisa mengalir dari sudut, jadi periksa kotak 2 blok di sekitar tujuan.
    if (lavaNear(bot, nextFeet, 2) || lavaNear(bot, nextHead, 2)) {
      lavaTurns++
      logger?.warn(`Terdeteksi lava di lorong tambang! Memutar arah lorong 90 derajat... (${lavaTurns}/${maxLavaTurns})`)
      if (isInLava(bot)) {
        const escape = await escapeLava(bot, { logger, radius: 8 })
        if (escape.moved) logger?.info('Bot keluar dari lava, lanjut mencari arah aman')
      }
      if (lavaTurns >= maxLavaTurns) {
        logger?.warn('Lava mengelilingi lorong tambang, berhenti menambang demi keselamatan')
        stopReason = 'lava-blocked'
        break
      }
      mineDir = new Vec3(-mineDir.z, 0, mineDir.x)
      await sleep(300, cancellation)
      continue
    }

    try {
      pickaxe = findItemName(bot, mcData, 'diamond_pickaxe') || findItemName(bot, mcData, 'netherite_pickaxe')
      if (pickaxe) await bot.equip(pickaxe, 'hand')

      const headBlock = bot.blockAt(nextHead)
      if (headBlock && headBlock.name !== 'air' && headBlock.diggable) {
        await bot.dig(headBlock)
      }
      const feetBlock = bot.blockAt(nextFeet)
      if (feetBlock && feetBlock.name !== 'air' && feetBlock.diggable) {
        await bot.dig(feetBlock)
      }

      if (bot.pathfinder?.goto) {
        await withTimeout(
          bot.pathfinder.goto(new goals.GoalBlock(nextFeet.x, nextFeet.y, nextFeet.z)),
          3000,
          'Maju ke lorong timeout'
        )
      }
    } catch (err) {
      logger?.debug(`Gagal menggali lorong: ${err.message}`)
    }

    // Jangan pernah tinggal di dalam lava: keluar dulu sebelum lanjut.
    if (isInLava(bot)) {
      const escape = await escapeLava(bot, { logger, radius: 8 })
      if (escape.moved) logger?.warn('Bot sempat masuk lava, sudah dipindahkan ke tempat aman')
    }
    lavaTurns = 0

    have = countItemName(bot, mcData, 'ancient_debris')
  }

  have = countItemName(bot, mcData, 'ancient_debris')
  const ok = have >= count
  const result = { ok, have, mined, missing: Math.max(0, count - have) }
  if (!ok && stopReason) result.reason = stopReason
  return result
}

module.exports = { mineAncientDebris }
