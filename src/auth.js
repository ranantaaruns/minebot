'use strict'

const { EventEmitter } = require('events')
const { sleep } = require('./util/async')

function cleanText (text) {
  return String(text || '')
    .replace(/§./g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

function matchesAny (text, patterns) {
  return (patterns || []).some(pattern => {
    if (pattern instanceof RegExp) return pattern.test(text)
    const needle = String(pattern).toLowerCase()
    return needle.length > 0 && text.includes(needle)
  })
}

function classifyAuthMessage (text, config) {
  const lower = cleanText(text)
  if (!lower) return null

  if (matchesAny(lower, config.loggedInPatterns)) return 'logged-in'
  if (matchesAny(lower, config.alreadyRegisteredPatterns)) return 'already-registered'

  const wantsRegister = matchesAny(lower, config.registerPatterns)
  const wantsLogin = matchesAny(lower, config.loginPatterns)

  if (wantsRegister) return 'register'
  if (wantsLogin) return 'login'
  return null
}

function fillCommand (template, password) {
  return String(template).replaceAll('{password}', password)
}

class AuthManager extends EventEmitter {
  constructor (bot, config, logger) {
    super()
    this.bot = bot
    this.config = config
    this.logger = logger
    this.state = 'waiting'
    this.attempts = 0
    this.registerAttempts = 0
    this.lastAttemptAt = 0
    this.timers = new Set()
    this.stopped = false

    this._onMessage = this._onMessage.bind(this)
    this._onSpawn = this._onSpawn.bind(this)

    bot.on('messagestr', this._onMessage)
    bot.once('spawn', this._onSpawn)
  }

  get authenticated () {
    return this.state === 'authenticated'
  }

  _later (fn, ms) {
    if (this.stopped) return
    const timer = setTimeout(() => {
      this.timers.delete(timer)
      if (!this.stopped) fn()
    }, ms)
    timer.unref?.()
    this.timers.add(timer)
  }

  _onSpawn () {
    if (!this.config.enabled) {
      this._markAuthenticated('auth dimatikan di config')
      return
    }
    if (this.config.proactiveLogin) {
      this._later(() => {
        if (!this.authenticated) this._sendLogin('proactive')
      }, this.config.proactiveLoginDelayMs)
    }
  }

  _onMessage (raw, position) {
    if (this.stopped || !this.config.enabled) return
    if (position === 'chat') return
    const text = typeof raw === 'object' ? raw?.toString?.() : raw
    const kind = classifyAuthMessage(text, this.config)

    if (kind === 'logged-in') {
      this._markAuthenticated(text)
      return
    }

    if (kind === 'already-registered') {
      this.logger.info('Auth: akun sudah terdaftar, mencoba login')
      this._sendLogin('already-registered')
      return
    }

    if (kind === 'register') {
      this._sendRegister(text)
      return
    }

    if (kind === 'login') {
      this._sendLogin(text)
    }
  }

  _canAttempt () {
    const now = Date.now()
    if (now - this.lastAttemptAt < this.config.attemptDelayMs) return false
    if (this.attempts >= this.config.maxAttempts) {
      this.logger.warn('Auth: batas percobaan tercapai. Cek password/command di config.')
      this.emit('auth-failed', new Error('Batas percobaan auth tercapai'))
      return false
    }
    return true
  }

  _sendRegister (reason, options = {}) {
    const { force = false, retry = true } = options
    if (this.state === 'registering') return false
    if (this.authenticated && !force) return false
    if (!this._canAttempt()) return false
    this.state = 'registering'
    this.attempts++
    this.registerAttempts++
    this.lastAttemptAt = Date.now()

    const command = fillCommand(this.config.registerCommand, this.config.password)
    this.logger.info(`Auth: mengirim register (percobaan ${this.attempts})`)
    this.bot.chat(command)

    if (retry) {
      this._later(() => {
        if (!this.authenticated) {
          if (this.registerAttempts >= 2) {
            this._sendLogin('setelah register')
          } else {
            this.state = 'waiting'
            this._sendRegister('percobaan register ulang')
          }
        }
      }, Math.max(this.config.attemptDelayMs, 3000))
    }

    this.logger.debug(`Auth: pemicu register: ${reason}`)
    return true
  }

  forceRegister () {
    if (!this.config.enabled || this.state === 'registering') return false
    this.attempts = 0
    this.registerAttempts = 0
    this.lastAttemptAt = 0
    this.state = 'waiting'
    const sent = this._sendRegister('perintah manual', { force: true, retry: false })
    if (sent) this.state = 'waiting'
    return sent
  }

  _sendLogin (reason) {
    if (this.authenticated) return
    if (!this._canAttempt()) return
    this.state = 'logging-in'
    this.attempts++
    this.lastAttemptAt = Date.now()

    const command = fillCommand(this.config.loginCommand, this.config.password)
    this.logger.info(`Auth: mengirim login (percobaan ${this.attempts})`)
    this.bot.chat(command)

    this._later(() => {
      if (!this.authenticated) {
        this.state = 'waiting'
        if (this.attempts < this.config.maxAttempts) {
          this.logger.warn('Auth: belum ada konfirmasi login')
        }
      }
    }, Math.max(this.config.attemptDelayMs, 3000))

    this.logger.debug(`Auth: pemicu login: ${reason}`)
  }

  _markAuthenticated (reason) {
    if (this.authenticated) return
    this.state = 'authenticated'
    this.logger.info('Auth: berhasil login')
    this.logger.debug(`Auth: konfirmasi: ${reason}`)
    this.emit('authenticated')
  }

  async waitForAuth (timeoutMs = 20000) {
    if (!this.config.enabled || this.authenticated) return true
    return new Promise(resolve => {
      let done = false
      const finish = value => {
        if (done) return
        done = true
        clearTimeout(timer)
        this.off('authenticated', onAuth)
        resolve(value)
      }
      const onAuth = () => finish(true)
      const timer = setTimeout(() => finish(this.authenticated), timeoutMs)
      this.once('authenticated', onAuth)
      if (this.authenticated) finish(true)
    })
  }

  async retry () {
    if (!this.config.enabled || this.authenticated) return
    this.attempts = 0
    this._sendLogin('manual retry')
  }

  stop () {
    this.stopped = true
    for (const timer of this.timers) clearTimeout(timer)
    this.timers.clear()
    this.bot.removeListener('messagestr', this._onMessage)
    this.bot.removeListener('spawn', this._onSpawn)
  }
}

module.exports = { AuthManager, classifyAuthMessage, fillCommand, cleanText }
