'use strict'

const { CancelledError } = require('./util/async')

function normalizeAnswer (text) {
  return String(text || '')
    .replace(/§./g, '')
    .trim()
    .toLowerCase()
}

function matchChoice (answer, choices) {
  const normalized = normalizeAnswer(answer)
  if (!normalized) return null
  for (const choice of choices || []) {
    const keys = [choice.key, ...(choice.aliases || [])]
      .filter(value => value !== undefined && value !== null)
      .map(value => normalizeAnswer(value))
    if (keys.includes(normalized)) return choice
  }
  return null
}

class OwnerDialog {
  constructor (bot, config, logger) {
    this.bot = bot
    this.config = config
    this.logger = logger
    this.username = config?.owner?.username || ''
    this.pending = null
    this.started = false

    this._onChat = (username, message) => this._handle(username, message)
    this._onWhisper = (username, message) => this._handle(username, message)
  }

  start () {
    if (this.started || !this.bot) return
    this.started = true
    this.bot.on('chat', this._onChat)
    this.bot.on('whisper', this._onWhisper)
  }

  stop () {
    if (!this.started) return
    this.started = false
    try { this.bot.removeListener('chat', this._onChat) } catch {}
    try { this.bot.removeListener('whisper', this._onWhisper) } catch {}
    this._reject(new CancelledError('Dialog owner ditutup'))
  }

  say (message) {
    const text = String(message || '')
    if (!text || !this.bot) return false
    try {
      if (this.username && typeof this.bot.whisper === 'function') {
        this.bot.whisper(this.username, text)
        return true
      }
    } catch (err) {
      this.logger?.debug(`Whisper owner gagal: ${err.message}`)
    }
    try {
      this.bot.chat(text)
      return true
    } catch (err) {
      this.logger?.debug(`Chat owner gagal: ${err.message}`)
      return false
    }
  }

  _handle (username, message) {
    if (!this.pending) return
    const target = String(this.username || '').toLowerCase()
    if (!target || String(username || '').toLowerCase() !== target) return
    this.pending.resolve(String(message || ''))
  }

  cancel (reason = 'Dialog owner dibatalkan') {
    this._reject(new CancelledError(reason))
  }

  _reject (err) {
    if (!this.pending) return
    const pending = this.pending
    this.pending = null
    clearInterval(pending.reminder)
    clearTimeout(pending.timeout)
    clearInterval(pending.cancelCheck)
    pending.reject(err)
  }

  async ask (question, options = {}) {
    if (!this.started) this.start()
    const {
      cancellation = null,
      timeoutMs = 0,
      reminderMs = 0,
      reminderText = null
    } = options

    cancellation?.throwIfCancelled()
    if (this.pending) this._reject(new CancelledError('Pertanyaan owner baru'))

    this.say(question)

    return new Promise((resolve, reject) => {
      const pending = { resolve, reject, reminder: null, timeout: null, cancelCheck: null }
      this.pending = pending

      const cleanup = () => {
        clearInterval(pending.reminder)
        clearTimeout(pending.timeout)
        clearInterval(pending.cancelCheck)
        if (this.pending === pending) this.pending = null
      }

      const wrappedResolve = value => {
        cleanup()
        resolve(value)
      }
      pending.resolve = wrappedResolve

      if (reminderMs > 0) {
        pending.reminder = setInterval(() => {
          if (this.pending !== pending) return
          this.say(reminderText || question)
        }, reminderMs)
        pending.reminder.unref?.()
      }

      if (timeoutMs > 0) {
        pending.timeout = setTimeout(() => {
          this._reject(new Error('Pertanyaan owner timeout'))
        }, timeoutMs)
        pending.timeout.unref?.()
      }

      if (cancellation) {
        pending.cancelCheck = setInterval(() => {
          if (cancellation.cancelled) {
            this._reject(new CancelledError(cancellation.reason || 'Job dibatalkan'))
          }
        }, 200)
        pending.cancelCheck.unref?.()
      }
    })
  }

  async choose (question, choices, options = {}) {
    const reminder = options.reminderText || question
    let prompt = question

    for (;;) {
      const answer = await this.ask(prompt, { ...options, reminderText: reminder })
      const choice = matchChoice(answer, choices)
      if (choice) return choice
      prompt = `Jawaban tidak dikenal. ${question}`
    }
  }
}

module.exports = { OwnerDialog, normalizeAnswer, matchChoice }
