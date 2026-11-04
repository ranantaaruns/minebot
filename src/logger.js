'use strict'

const SECRET_KEYS = /password|passwd|token|secret/i

function redact (value) {
  if (value === null || value === undefined) return value
  if (typeof value === 'string') {
    return value.length > 200 ? `${value.slice(0, 200)}...` : value
  }
  if (Array.isArray(value)) return value.map(redact)
  if (typeof value === 'object') {
    const out = {}
    for (const [key, val] of Object.entries(value)) {
      out[key] = SECRET_KEYS.test(key) ? '***' : redact(val)
    }
    return out
  }
  return value
}

class Logger {
  constructor (options = {}, prefix = '') {
    this.debugEnabled = Boolean(options.debug)
    this.chatEnabled = options.chat !== false
    this.options = options
    this.prefix = prefix
  }

  forBot (botUsername) {
    const p = botUsername ? `[${botUsername}] ` : ''
    return new Logger(this.options, p)
  }

  _stamp () {
    const now = new Date()
    return now.toISOString().slice(11, 19)
  }

  _write (level, args) {
    const text = args.map(arg => {
      if (typeof arg === 'string') return arg
      try {
        return JSON.stringify(redact(arg))
      } catch {
        return String(arg)
      }
    }).join(' ')
    console.log(`[${this._stamp()}] ${level} ${this.prefix}${text}`)
  }

  info (...args) { this._write('INFO ', args) }
  warn (...args) { this._write('WARN ', args) }
  error (...args) { this._write('ERROR', args) }
  debug (...args) { if (this.debugEnabled) this._write('DEBUG', args) }
  chat (username, message) {
    if (!this.chatEnabled) return
    console.log(`[${this._stamp()}] CHAT  <${username}> ${message}`)
  }
}

module.exports = { Logger, redact }
