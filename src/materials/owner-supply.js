'use strict'

const { goals } = require('mineflayer-pathfinder')
const { countItemName } = require('../util/inventory')
const { sleep } = require('../util/async')
const { withdrawFromChests } = require('./chests')

function ownerName (config) {
  return config?.owner?.username || config?.username || ''
}

function notifyOwner (bot, config, logger, message) {
  const name = ownerName(config)
  try {
    if (name && typeof bot.whisper === 'function') {
      bot.whisper(name, message)
      return
    }
  } catch (err) {
    logger?.debug(`Whisper owner gagal: ${err.message}`)
  }
  try { bot.chat(message) } catch (err) {
    logger?.debug(`Chat owner gagal: ${err.message}`)
  }
}

async function collectNearbyDrops (bot, radius) {
  if (!bot?.entity || !bot.entities || !bot.pathfinder) return 0
  const position = bot.entity.position
  const drops = Object.values(bot.entities)
    .filter(entity => entity && entity !== bot.entity && entity.name === 'item')
    .filter(entity => entity.position && entity.position.distanceTo(position) <= radius)
    .sort((a, b) => position.distanceTo(a.position) - position.distanceTo(b.position))

  let collected = 0
  for (const entity of drops.slice(0, 4)) {
    try {
      await bot.pathfinder.goto(new goals.GoalNear(
        entity.position.x,
        entity.position.y,
        entity.position.z,
        1
      ))
      await sleep(250)
      collected++
    } catch {}
  }
  return collected
}

async function waitForOwnerSupply (bot, mcData, itemName, count, options = {}) {
  const {
    config = {},
    logger,
    cancellation,
    reminderMs = 30000,
    timeoutMs = 0,
    pickupRadius = 8,
    chestRadius = 32,
    preferChests = true
  } = options

  if (!mcData.itemsByName[itemName]) {
    return { ok: false, have: 0, reason: 'unknown-item' }
  }

  const startedAt = Date.now()
  let lastReminder = 0
  let lastChest = 0
  let have = countItemName(bot, mcData, itemName)
  const targetOwner = ownerName(config).toLowerCase()

  const onOwnerMessage = (username, message) => {
    if (!targetOwner || String(username || '').toLowerCase() !== targetOwner) return
    const text = String(message || '').replace(/§./g, '').trim().toLowerCase()
    if (['stop', 'batal', 'cancel', '3'].includes(text)) {
      cancellation?.cancel('Dihentikan oleh owner saat menunggu material')
    }
  }

  const listening = targetOwner && typeof bot.on === 'function'
  if (listening) {
    bot.on('chat', onOwnerMessage)
    bot.on('whisper', onOwnerMessage)
  }

  try {
    while (have < count) {
      cancellation?.throwIfCancelled()
      if (timeoutMs > 0 && Date.now() - startedAt >= timeoutMs) {
        return { ok: false, have, reason: 'timeout' }
      }

      const now = Date.now()
      if (lastReminder === 0 || now - lastReminder >= reminderMs) {
        lastReminder = now
        const pos = bot.entity?.position
        const where = pos
          ? `${pos.x.toFixed(0)} ${pos.y.toFixed(0)} ${pos.z.toFixed(0)}`
          : 'posisi bot'
        notifyOwner(
          bot,
          config,
          logger,
          `Aku butuh ${itemName} x${count - have}. Drop di dekat aku (${where}) atau taruh di chest dekat. Ketik stop untuk membatalkan.`
        )
      }

      if (preferChests && now - lastChest >= 5000) {
        lastChest = now
        try {
          await withdrawFromChests(bot, mcData, mcData.itemsByName[itemName].id, count - have, {
            radius: chestRadius,
            logger,
            cancellation,
            clearObstructions: config.gather?.clearChestObstructions !== false,
            clearHeight: config.gather?.clearHeight ?? 3,
            origin: options.origin
          })
        } catch (err) {
          logger?.debug(`Chest supply ${itemName} gagal: ${err.message}`)
        }
      }

      await collectNearbyDrops(bot, pickupRadius)
      have = countItemName(bot, mcData, itemName)
      if (have >= count) break
      await sleep(1000, cancellation)
    }
  } finally {
    if (listening) {
      try { bot.removeListener('chat', onOwnerMessage) } catch {}
      try { bot.removeListener('whisper', onOwnerMessage) } catch {}
    }
  }

  logger?.info(`Owner supply terpenuhi: ${itemName} ${have}/${count}`)
  return { ok: true, have }
}

module.exports = { waitForOwnerSupply, collectNearbyDrops, notifyOwner, ownerName }
