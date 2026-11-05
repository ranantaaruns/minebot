'use strict'

const dns = require('dns').promises
const net = require('net')
const mineflayer = require('mineflayer')
const pathfinder = require('mineflayer-pathfinder').pathfinder
const toolPlugin = require('mineflayer-tool').plugin
const collectBlockPlugin = require('mineflayer-collectblock').plugin
const craftingUtilModule = require('mineflayer-crafting-util')
const { applyMovements } = require('./movements')
const { applyPaperCollisionFix } = require('./physics')
const { FoodManager, pickFood } = require('./safety/food')
const { CombatManager } = require('./safety/combat')
const { StorageManager } = require('./storage/manager')
const { isNether, StructureAvoidance, ensureGoldArmor } = require('./safety/nether')
const { LavaGuard } = require('./safety/lava')
const { ArrowDodger } = require('./safety/dodge')
const { ShieldBreakStrategy } = require('./safety/shieldbreak')
const { CombatEngine } = require('./combat/engine')
const { PlayerTracker } = require('./intel/tracker')
const { sleep } = require('./util/async')

function craftingPlugin () {
  const factory = craftingUtilModule.plugin || craftingUtilModule.default
  return typeof factory === 'function' ? factory() : factory
}

function startAntiAfk (bot, config, logger, isBusy) {
  if (!config.safety.antiAfk) return null
  const interval = setInterval(async () => {
    if (!bot.entity || isBusy?.()) return
    if (bot.pathfinder?.goal) return
    try {
      const yaw = bot.entity.yaw + (Math.random() - 0.5) * 1.2
      await bot.look(yaw, bot.entity.pitch, false)
      await sleep(200)
    } catch (err) {
      logger.debug(`Anti-afk: ${err.message}`)
    }
  }, config.safety.antiAfkIntervalMs)
  interval.unref?.()
  return interval
}

async function resolveServer (host, port = null) {
  let cleanHost = (host || '127.0.0.1').trim()
  let cleanPort = port

  if (cleanHost.includes(':') && !cleanHost.startsWith('[')) {
    const [h, p] = cleanHost.split(':')
    cleanHost = h.trim()
    if (!cleanPort && p) cleanPort = Number(p.trim())
  }

  if (cleanPort !== null && cleanPort !== undefined && Number(cleanPort) > 0) {
    return {
      host: cleanHost,
      port: Number(cleanPort),
      srv: false
    }
  }

  // If no port is specified and host is a domain, perform SRV lookup
  if (net.isIP(cleanHost) === 0 && cleanHost !== 'localhost') {
    try {
      const records = await dns.resolveSrv('_minecraft._tcp.' + cleanHost)
      if (records && records.length > 0) {
        records.sort((a, b) => a.priority - b.priority || b.weight - a.weight)
        return {
          host: records[0].name || cleanHost,
          port: records[0].port,
          srv: true,
          originalHost: cleanHost
        }
      }
    } catch {
      // SRV lookup not found, will fallback to 25565
    }
  }

  return {
    host: cleanHost,
    port: 25565,
    srv: false
  }
}

async function createBot (config, logger) {
  const resolved = await resolveServer(config.server.host, config.server.port)
  const options = {
    host: resolved.host,
    port: resolved.port,
    username: config.bot.username,
    auth: config.bot.auth || 'offline',
    brand: config.server.brand || 'vanilla',
    hideErrors: false,
    logErrors: true,
    checkTimeoutInterval: 60000,
    respawn: true
  }

  if (config.server.version) options.version = config.server.version

  if (resolved.srv) {
    logger.info(`Menghubungkan ke ${resolved.originalHost || config.server.host} (SRV resolved: ${resolved.host}:${resolved.port}) sebagai ${options.username}`)
  } else {
    logger.info(`Menghubungkan ke ${options.host}:${options.port} sebagai ${options.username}`)
  }
  const bot = mineflayer.createBot(options)
  applyPaperCollisionFix(bot, config)

  bot.loadPlugin(pathfinder)
  bot.loadPlugin(toolPlugin)
  bot.loadPlugin(collectBlockPlugin)
  bot.loadPlugin(craftingPlugin())

  bot.structureAvoidance = new StructureAvoidance(bot, config.nether || {}, logger)

  bot.once('login', () => logger.info('Login protocol berhasil, menunggu spawn...'))
  bot.on('spawn', () => {
    applyPaperCollisionFix(bot, config)
    applyMovements(bot, 'travel', config.owner)
    if (!bot.storageManager) bot.storageManager = new StorageManager(bot, config, logger)
    const dim = bot.game?.dimension ? ` [dimensi: ${bot.game.dimension}]` : ''
    logger.info(`Spawn di ${bot.entity.position.x.toFixed(0)} ${bot.entity.position.y.toFixed(0)} ${bot.entity.position.z.toFixed(0)}${dim} (${bot.version})`)
    if (config.physics?.paperCollisionFix && bot.physics) {
      logger.debug(`Physics: collision fix aktif (halfWidth=${bot.physics.playerHalfWidth}, height=${bot.physics.playerHeight})`)
    }
    if (isNether(bot)) {
      if (config.nether?.wearGoldInNether !== false) ensureGoldArmor(bot)
      bot.structureAvoidance.scan()
    }
  })

  bot.on('respawn', () => {
    logger.info(`Dimensi berubah ke: ${bot.game?.dimension || 'unknown'}`)
    applyMovements(bot, 'travel', config.owner)
    if (isNether(bot)) {
      if (config.nether?.wearGoldInNether !== false) ensureGoldArmor(bot)
      bot.structureAvoidance.scan()
    }
  })

  bot.on('chat', (username, message) => {
    if (username === bot.username) return
    logger.chat(username, message)
  })

  bot.on('messagestr', (message, position) => {
    if (position === 'game_info') logger.debug(`Server: ${message}`)
  })

  bot.on('death', () => {
    logger.warn('Bot mati, menunggu respawn...')
    try { bot.pathfinder.stop() } catch {}
  })

  bot.on('kicked', reason => {
    logger.warn(`Bot di-kick: ${reason}`)
  })

  bot.on('error', err => {
    logger.error(`Bot error: ${err.message}`)
  })

  bot.foodManager = new FoodManager(bot, config, logger)
  bot.foodManager.start()

  bot.combatManager = new CombatManager(bot, config, logger)
  bot.combatManager.start()

  bot.lavaGuard = new LavaGuard(bot, config, logger)
  bot.lavaGuard.start()

  bot.arrowDodger = new ArrowDodger(bot, config, logger)
  bot.arrowDodger.start()

  bot.combatEngine = new CombatEngine(bot, config, logger, {
    shieldBreak: new ShieldBreakStrategy({
      enabled: config.combat?.hunt?.shieldBreakEnabled !== false,
      punishMs: config.combat?.hunt?.shieldBreakPunishMs,
      windowMs: config.combat?.hunt?.shieldBreakWindowMs
    })
  })
  bot.combatEngine.start()

  bot.playerTracker = new PlayerTracker(bot, config, logger)
  bot.playerTracker.start().catch(() => {})
  bot.on('end', () => bot.playerTracker?.stop())

  return bot
}

module.exports = { createBot, resolveServer, startAntiAfk, pickFood }
