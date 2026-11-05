'use strict'

const { createBot, startAntiAfk } = require('../bot')
const { AuthManager } = require('../auth')
const { OwnerTracker } = require('../owner')
const { GamemodeManager } = require('../gamemode')
const { WaterNavigator } = require('../navigation/water')
const { LadderNavigator } = require('../navigation/ladder')
const { OwnerDialog } = require('../owner-dialog')
const { MaterialManager } = require('../materials/resolve')
const { TowerSupply } = require('../navigation/tower-supply')
const { JobManager } = require('../jobs')

class BotSession {
  constructor (id, username, baseConfig, baseLogger, options = {}) {
    this.id = id
    this.username = username
    this.config = JSON.parse(JSON.stringify(baseConfig))
    this.config.bot.username = username
    this.logger = baseLogger.forBot ? baseLogger.forBot(username) : baseLogger
    this.jobs = new JobManager(this.logger)
    this.options = options

    this.bot = null
    this.botCreatedAt = 0
    this.auth = null
    this.gamemode = null
    this.owner = null
    this.water = null
    this.ladder = null
    this.builder = null
    this.materials = null
    this.dialog = null
    this.navMaterials = null
    this.towerSupply = null

    this.quitting = false
    this.attempts = 0
    this.reconnectTimer = null
    this.antiAfk = null
    this.connected = false
    this.spawned = false
  }

  scheduleReconnect () {
    if (this.quitting || !this.config.connection.reconnect) return
    if (this.reconnectTimer) return

    this.attempts += 1
    const base = Math.max(500, Number(this.config.connection.reconnectDelayMs) || 5000)
    const max = Math.max(base, Number(this.config.connection.maxReconnectDelayMs) || 60000)
    const delay = Math.min(base * Math.pow(2, Math.min(this.attempts - 1, 5)), max)

    this.logger.info(`Reconnect dalam ${(delay / 1000).toFixed(1)} detik (percobaan ${this.attempts})`)
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      this.connect().catch(err => {
        this.logger.error(`Reconnect error: ${err.message}`)
      })
    }, delay)
  }

  async connect () {
    if (this.quitting) return

    let bot
    try {
      bot = await createBot(this.config, this.logger)
    } catch (err) {
      this.logger.error(`Gagal membuat bot: ${err.message}`)
      this.scheduleReconnect()
      return
    }

    this.bot = bot
    this.botCreatedAt = Date.now()
    this.connected = true
    this.spawned = false

    this.auth = new AuthManager(bot, this.config.auth, this.logger)
    this.gamemode = new GamemodeManager(bot, this.config, this.logger)
    this.owner = new OwnerTracker(bot, this.config.owner, this.logger, {
      structureAvoidance: bot.structureAvoidance
    })
    this.owner.pause()
    this.owner.start()

    this.water = new WaterNavigator(bot, this.config, this.logger, {
      getTarget: () => {
        if (!this.owner || this.owner.paused) return null
        return this.owner._currentPoint?.() || null
      },
      getJobPaused: () => Boolean(this.owner?.paused),
      onEnterWater: () => this.owner?.onWaterEnter?.(),
      onExitWater: () => this.owner?.onWaterExit?.()
    })
    this.owner.waterNavigator = this.water

    this.ladder = new LadderNavigator(bot, this.config, this.logger, {
      getTarget: () => {
        if (!this.owner || this.owner.paused) return null
        return this.owner._currentPoint?.() || null
      }
    })
    this.owner.ladderNavigator = this.ladder

    bot.foodManager?.attach(this.owner, this.water)
    if (bot.foodManager) {
      bot.foodManager.onStarving = () => {
        this.builder?.pause()
        this.jobs.stop('Makanan habis')
      }
    }

    this.antiAfk = startAntiAfk(bot, this.config, this.logger, () => this.jobs.busy)

    bot.once('spawn', async () => {
      this.attempts = 0
      this.spawned = true
      this.dialog?.stop()
      this.dialog = new OwnerDialog(bot, this.config, this.logger)
      this.dialog.start()

      const targetDesc = this.config.server.port
        ? `${this.config.server.host}:${this.config.server.port}`
        : this.config.server.host
      this.logger.info(`Spawn sebagai ${bot.username} di ${targetDesc} (${bot.version})`)

      this.navMaterials = new MaterialManager(bot, this.config, this.logger)
      this.towerSupply = new TowerSupply(bot, this.config, this.logger, this.navMaterials)
      this.owner.towerSupply = this.towerSupply

      if (this.config.auth.enabled) {
        const ok = await this.auth.waitForAuth(10000)
        if (ok) this.logger.info('Login terkonfirmasi')
        else this.logger.warn('Belum ada konfirmasi login setelah 10 detik. Cek auth di config atau ketik "auth" untuk mencoba ulang.')
      }

      this.owner.resume()
      if (this.config.owner.autoFollow && this.config.owner.username) {
        this.logger.info(`Auto-follow aktif untuk ${this.config.owner.username}`)
      }
    })

    bot.on('end', reason => {
      if (this.antiAfk) clearInterval(this.antiAfk)
      this.antiAfk = null
      if (this.bot !== bot) return

      this.connected = false
      this.spawned = false
      bot.combatManager?.stop()
      bot.arrowDodger?.stop()
      this.bot = null
      this.auth?.stop()
      this.gamemode = null
      this.owner?.stop()
      this.dialog?.stop()
      this.dialog = null
      this.water?.destroy()
      this.water = null
      this.ladder?.destroy()
      this.ladder = null
      this.navMaterials = null
      this.towerSupply = null
      this.jobs.stop('Koneksi terputus')

      if (!this.quitting) {
        this.logger.warn(`Koneksi berakhir: ${reason || 'unknown'}`)
        this.scheduleReconnect()
      }
    })

    bot.on('error', err => {
      this.logger.error(`Bot error: ${err.message}`)
    })
  }

  async quit () {
    if (this.quitting) return
    this.quitting = true
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.reconnectTimer = null
    if (this.antiAfk) clearInterval(this.antiAfk)
    this.antiAfk = null

    this.logger.info('Keluar...')
    this.jobs.stop('Bot keluar')
    this.auth?.stop()
    this.owner?.stop()
    this.dialog?.stop()
    this.water?.destroy()
    this.ladder?.destroy()

    const bot = this.bot
    try {
      bot?.quit?.('Bot keluar')
    } catch {
      try { bot?.end?.() } catch {}
    }
  }

  getStatus () {
    const p = this.bot?.entity?.position
    return {
      id: this.id,
      username: this.username,
      connected: this.connected,
      spawned: this.spawned,
      health: this.bot?.health ?? null,
      food: this.bot?.food ?? null,
      position: p ? { x: p.x, y: p.y, z: p.z } : null,
      dimension: this.bot?.game?.dimension || 'unknown',
      busy: this.jobs.busy,
      jobName: this.jobs.name,
      authenticated: this.auth?.authenticated ?? false
    }
  }
}

module.exports = { BotSession }
