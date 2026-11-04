'use strict'

const { sleep } = require('../util/async')

async function deliverItemsToOwner (session, itemName, count) {
  const { bot, owner, logger } = session
  if (!bot || !bot.entity) {
    return { ok: false, delivered: 0, reason: 'bot-not-connected' }
  }

  const bare = String(itemName || '').replace(/^minecraft:/, '')
  const matchingItems = (bot.inventory?.items?.() || []).filter(item => {
    return item.name.replace(/^minecraft:/, '') === bare
  })

  const available = matchingItems.reduce((acc, it) => acc + (it.count || 0), 0)
  if (available <= 0) {
    logger?.warn(`Tidak ada ${bare} di inventory untuk diberikan ke owner`)
    return { ok: false, delivered: 0, reason: 'no-items-in-inventory' }
  }

  const targetDeliver = Math.min(count, available)
  logger?.info(`Mengantarkan ${targetDeliver} ${bare} ke owner...`)

  // 1. Move to owner
  if (owner) {
    try {
      const comeRes = await owner.come()
      if (!comeRes.ok) {
        logger?.warn(`Gagal mendekati owner: ${comeRes.reason || 'tidak dapat dijangkau'}`)
      }
    } catch (err) {
      logger?.warn(`Error saat mendekati owner: ${err.message}`)
    }
  }

  // 2. Face owner
  const ownerEntity = owner?.getOwnerEntity?.()
  if (ownerEntity) {
    try {
      await bot.lookAt(ownerEntity.position.offset(0, 1.4, 0), true)
      await sleep(250)
    } catch {}
  }

  // 3. Toss items
  let remaining = targetDeliver
  let delivered = 0

  for (const item of matchingItems) {
    if (remaining <= 0) break
    const toDrop = Math.min(item.count, remaining)
    try {
      if (typeof bot.toss === 'function') {
        await bot.toss(item.type, null, toDrop)
      } else if (typeof bot.tossStack === 'function') {
        await bot.tossStack(item)
      }
      remaining -= toDrop
      delivered += toDrop
      await sleep(200)
    } catch (err) {
      logger?.warn(`Gagal melempar ${bare}: ${err.message}`)
      break
    }
  }

  if (delivered > 0) {
    const ownerName = session.config?.owner?.username || 'owner'
    logger?.info(`Berhasil memberikan ${delivered} ${bare} ke ${ownerName}!`)
    return { ok: true, delivered, missing: targetDeliver - delivered }
  }

  return { ok: false, delivered: 0, reason: 'toss-failed' }
}

module.exports = { deliverItemsToOwner }
