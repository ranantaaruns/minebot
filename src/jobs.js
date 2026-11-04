'use strict'

const { Cancellation, CancelledError } = require('./util/async')

class JobManager {
  constructor (logger) {
    this.logger = logger
    this.current = null
  }

  get busy () {
    return this.current !== null
  }

  get name () {
    return this.current?.name || null
  }

  async run (name, fn) {
    if (this.current) {
      throw new Error(`Masih ada job berjalan: ${this.current.name}. Gunakan "stop" dulu.`)
    }

    const cancellation = new Cancellation()
    const job = {
      name,
      cancellation,
      startedAt: Date.now(),
      progress: null
    }
    this.current = job
    this.logger.info(`Job dimulai: ${name}`)

    try {
      const result = await fn(cancellation, job)
      return result
    } catch (err) {
      if (err instanceof CancelledError || err?.cancelled) {
        this.logger.warn(`Job dibatalkan: ${name}`)
        return { cancelled: true }
      }
      throw err
    } finally {
      this.current = null
      const elapsed = ((Date.now() - job.startedAt) / 1000).toFixed(1)
      this.logger.info(`Job selesai: ${name} (${elapsed}s)`)
    }
  }

  setProgress (progress) {
    if (this.current) this.current.progress = progress
  }

  stop (reason = 'Dihentikan oleh pengguna') {
    if (!this.current) return false
    this.current.cancellation.cancel(reason)
    return true
  }
}

module.exports = { JobManager }
