'use strict'

const { sleep } = require('./util/async')

const GAMEMODE_MAP = {
  0: 'survival',
  s: 'survival',
  survival: 'survival',
  1: 'creative',
  c: 'creative',
  creative: 'creative',
  2: 'adventure',
  a: 'adventure',
  adventure: 'adventure',
  3: 'spectator',
  sp: 'spectator',
  spectator: 'spectator'
}

function normalizeGamemode (input) {
  if (input === undefined || input === null) return null
  const key = String(input).trim().toLowerCase()
  return GAMEMODE_MAP[key] || null
}

function fillGamemodeCommand (template, mode, username) {
  return String(template || '/gamemode {mode}')
    .replace(/\{mode\}/g, mode)
    .replace(/\{username\}/g, username || '')
    .trim()
}

class GamemodeManager {
  constructor (bot, config, logger) {
    this.bot = bot
    this.config = config?.gamemode || config || {}
    this.logger = logger
    this.previousMode = null
  }

  get currentMode () {
    return this.bot?.game?.gameMode || 'survival'
  }

  isCreative () {
    return this.currentMode === 'creative'
  }

  async setGamemode (targetMode, options = {}) {
    const mode = normalizeGamemode(targetMode)
    if (!mode) {
      return { ok: false, error: `Gamemode tidak valid: ${targetMode}` }
    }

    if (this.currentMode === mode) {
      return { ok: true, mode, already: true, previousMode: this.previousMode }
    }

    const prev = this.currentMode
    const timeoutMs = options.timeoutMs ?? this.config.switchTimeoutMs ?? 3000
    const template = options.command ?? this.config.command ?? '/gamemode {mode}'
    const command = fillGamemodeCommand(template, mode, this.bot?.username)

    this.logger?.debug?.(`Mengirim perintah gamemode: ${command}`)

    return new Promise(resolve => {
      let resolved = false
      let timer = null

      const cleanup = () => {
        if (timer) clearTimeout(timer)
        if (this.bot) this.bot.removeListener('game', onGame)
      }

      const onGame = () => {
        if (this.currentMode === mode && !resolved) {
          resolved = true
          cleanup()
          if (!options.isRestore) {
            this.previousMode = prev
          } else {
            this.previousMode = null
          }
          this.logger?.debug?.(`Gamemode terkonfirmasi: ${mode}`)
          resolve({ ok: true, mode, previousMode: options.isRestore ? null : prev })
        }
      }

      if (this.bot) {
        this.bot.on('game', onGame)
      }

      timer = setTimeout(() => {
        if (!resolved) {
          resolved = true
          cleanup()
          if (this.currentMode === mode) {
            if (!options.isRestore) {
              this.previousMode = prev
            } else {
              this.previousMode = null
            }
            resolve({ ok: true, mode, previousMode: options.isRestore ? null : prev })
          } else {
            resolve({
              ok: false,
              mode: this.currentMode,
              error: `Timeout (${timeoutMs}ms) menunggu konfirmasi server untuk mode ${mode}`
            })
          }
        }
      }, timeoutMs)

      try {
        if (typeof this.bot?.chat === 'function') {
          this.bot.chat(command)
        } else {
          resolved = true
          cleanup()
          resolve({ ok: false, error: 'Bot chat tidak tersedia' })
        }
      } catch (err) {
        resolved = true
        cleanup()
        resolve({ ok: false, error: err.message })
      }
    })
  }

  async ensureGamemode (mode, options = {}) {
    const target = normalizeGamemode(mode)
    if (this.currentMode === target) {
      return { ok: true, mode: target, already: true }
    }
    return this.setGamemode(target, options)
  }

  async restoreGamemode (options = {}) {
    if (!this.previousMode) {
      return { ok: true, restored: false, mode: this.currentMode }
    }
    const target = this.previousMode
    this.previousMode = null
    this.logger?.info?.(`Mengembalikan gamemode ke ${target}...`)
    return this.setGamemode(target, { ...options, isRestore: true })
  }
}

module.exports = {
  GamemodeManager,
  normalizeGamemode,
  fillGamemodeCommand,
  GAMEMODE_MAP
}
