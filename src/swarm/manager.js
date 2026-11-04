'use strict'

const { BotSession } = require('./session')
const { deliverItemsToOwner } = require('./deliver')
const { MaterialManager } = require('../materials/resolve')
const { applyMovements } = require('../movements')
const { sleep } = require('../util/async')

function partitionWorkload (total, numWorkers) {
  if (numWorkers <= 0) return []
  if (total <= 0) return Array(numWorkers).fill(0)
  const base = Math.floor(total / numWorkers)
  const remainder = total % numWorkers
  return Array.from({ length: numWorkers }, (_, i) => base + (i < remainder ? 1 : 0))
}

class SwarmManager {
  constructor (botConfigs, baseConfig, baseLogger) {
    this.botConfigs = botConfigs || []
    this.baseConfig = baseConfig
    this.logger = baseLogger
    this.isSwarm = true

    this.sessions = this.botConfigs.map((cfg, idx) => {
      return new BotSession(idx + 1, cfg.username, baseConfig, baseLogger)
    })
  }

  getPrimary () {
    const spawned = this.sessions.find(s => s.spawned)
    if (spawned) return spawned
    const connected = this.sessions.find(s => s.connected)
    if (connected) return connected
    return this.sessions[0] || null
  }

  getConnectedBots () {
    return this.sessions.filter(s => s.bot && s.spawned)
  }

  getAllSessions () {
    return this.sessions
  }

  async start () {
    const staggerMs = Number(this.baseConfig.swarm?.staggerDelayMs ?? 1500)
    for (let i = 0; i < this.sessions.length; i++) {
      const session = this.sessions[i]
      session.connect().catch(err => {
        session.logger.error(`Koneksi error: ${err.message}`)
      })
      if (i < this.sessions.length - 1 && staggerMs > 0) {
        await sleep(staggerMs)
      }
    }
  }

  async gather (item, count, cancellation) {
    const bare = String(item || '').replace(/^minecraft:/, '')
    const activeBots = this.getConnectedBots().filter(s => !s.jobs.busy)

    if (activeBots.length === 0) {
      throw new Error('Tidak ada bot yang online dan idle untuk melakukan gather')
    }

    const quotas = partitionWorkload(count, activeBots.length)
    const tasks = activeBots.map((session, idx) => ({
      session,
      quota: quotas[idx]
    })).filter(t => t.quota > 0)

    this.logger.info(`[Swarm] Memulai kolaborasi gather ${count} ${bare} dengan ${tasks.length} bot:`)
    for (const t of tasks) {
      this.logger.info(`  - ${t.session.username}: kuota ${t.quota} ${bare}`)
    }

    const deliver = this.baseConfig.swarm?.deliverOnGather !== false

    const results = await Promise.allSettled(tasks.map(async task => {
      const { session, quota } = task
      return session.jobs.run('gather', async jobCancel => {
        session.owner?.pause()
        session.bot.storageManager?.clearKeep()
        session.bot.storageManager?.addKeep([bare])

        try {
          const materials = new MaterialManager(session.bot, session.config, session.logger, {
            origin: session.bot.entity.position.floored()
          })

          const res = await materials.ensureItem(bare, quota, jobCancel)
          const gathered = res.ok ? quota : (res.have || 0)

          let delivered = 0
          if (deliver && gathered > 0) {
            const delRes = await deliverItemsToOwner(session, bare, gathered)
            delivered = delRes.delivered
          }

          return {
            bot: session.username,
            ok: res.ok,
            quota,
            gathered,
            delivered,
            reason: res.reason
          }
        } finally {
          session.bot.storageManager?.clearKeep()
          try {
            applyMovements(session.bot, 'travel', session.config.owner)
          } catch {}
          session.owner?.resume()
        }
      })
    }))

    let totalGathered = 0
    let totalDelivered = 0
    const summary = []

    for (let i = 0; i < results.length; i++) {
      const res = results[i]
      const botName = tasks[i].session.username
      if (res.status === 'fulfilled' && res.value && !res.value.cancelled) {
        totalGathered += (res.value.gathered || 0)
        totalDelivered += (res.value.delivered || 0)
        summary.push(`${botName}: ${res.value.gathered}/${tasks[i].quota}`)
      } else {
        const errReason = res.reason?.message || 'gagal'
        summary.push(`${botName}: 0/${tasks[i].quota} (${errReason})`)
      }
    }

    if (totalDelivered >= count) {
      this.logger.info(`[Swarm] Selesai! Total ${totalDelivered}/${count} ${bare} berhasil dikumpulkan dan diberikan ke owner (${summary.join(', ')})`)
    } else {
      this.logger.warn(`[Swarm] Selesai sebagian: ${totalDelivered}/${count} ${bare} diserahkan ke owner (${summary.join(', ')})`)
    }

    return {
      ok: totalDelivered >= count,
      count,
      gathered: totalGathered,
      delivered: totalDelivered,
      details: summary
    }
  }

  async come (coords = null) {
    const active = this.getConnectedBots()
    if (active.length === 0) {
      throw new Error('Tidak ada bot yang online')
    }

    this.logger.info(`[Swarm] Memerintahkan ${active.length} bot mendatangi owner...`)
    const results = await Promise.allSettled(active.map(s => {
      s.owner?.resume()
      return s.owner?.come(coords)
    }))

    const arrived = results.filter(r => r.status === 'fulfilled' && r.value?.ok).length
    this.logger.info(`[Swarm] ${arrived}/${active.length} bot sampai di dekat owner`)
    return { ok: arrived > 0, arrived, total: active.length }
  }

  follow () {
    const active = this.getConnectedBots()
    for (const s of active) {
      s.owner?.resume()
    }
    this.logger.info(`[Swarm] Auto-follow aktif untuk ${active.length} bot`)
  }

  stop (reason = 'Dihentikan oleh pengguna') {
    let stoppedCount = 0
    for (const s of this.sessions) {
      s.dialog?.cancel(reason)
      if (s.jobs.stop(reason)) stoppedCount++
      try { s.bot?.pathfinder?.stop() } catch {}
      if (s.builder) s.builder.paused = false
    }
    this.logger.info(`[Swarm] ${stoppedCount} job bot dihentikan`)
    return stoppedCount
  }

  async gamemode (targetMode) {
    const active = this.getConnectedBots()
    if (active.length === 0) throw new Error('Tidak ada bot yang online')

    if (!targetMode) {
      const modes = active.map(s => `${s.username}: ${s.bot.game?.gameMode || 'unknown'}`)
      this.logger.info(`Gamemode bot:\n  ${modes.join('\n  ')}`)
      return { ok: true, modes }
    }

    const results = await Promise.allSettled(active.map(async s => {
      if (!s.gamemode) return { ok: false, error: 'no-gm' }
      return s.gamemode.setGamemode(targetMode)
    }))

    const okCount = results.filter(r => r.status === 'fulfilled' && r.value?.ok).length
    this.logger.info(`[Swarm] Gamemode ${targetMode} diterapkan pada ${okCount}/${active.length} bot`)
    return { ok: okCount > 0, okCount, total: active.length }
  }

  say (text, botUsername = null) {
    if (!text) throw new Error('Gunakan: say <teks>')
    if (botUsername) {
      const s = this.sessions.find(b => b.username.toLowerCase() === botUsername.toLowerCase())
      if (!s || !s.bot) throw new Error(`Bot ${botUsername} tidak ditemukan atau offline`)
      s.bot.chat(text)
      return
    }

    const primary = this.getPrimary()
    if (!primary || !primary.bot) throw new Error('Tidak ada bot yang terhubung untuk mengirim chat')
    primary.bot.chat(text)
  }

  forceRegister () {
    let sent = 0
    for (const s of this.getConnectedBots()) {
      if (s.auth && s.auth.forceRegister()) sent++
    }
    this.logger.info(`[Swarm] Command register dikirim untuk ${sent} bot`)
    return sent
  }

  async quit () {
    this.logger.info('[Swarm] Menutup seluruh koneksi bot...')
    await Promise.allSettled(this.sessions.map(s => s.quit()))
  }
}

module.exports = { SwarmManager, partitionWorkload }
