'use strict'

class CancelledError extends Error {
  constructor (reason = 'Job dibatalkan') {
    super(reason)
    this.name = 'CancelledError'
    this.cancelled = true
  }
}

class Cancellation {
  constructor () {
    this.cancelled = false
    this.reason = null
  }

  cancel (reason = 'Job dibatalkan') {
    if (this.cancelled) return
    this.cancelled = true
    this.reason = reason
  }

  throwIfCancelled () {
    if (this.cancelled) throw new CancelledError(this.reason || 'Job dibatalkan')
  }
}

function sleep (ms, cancellation) {
  if (cancellation?.cancelled) return Promise.reject(new CancelledError(cancellation.reason))
  return new Promise((resolve, reject) => {
    let interval = null
    const timer = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)

    function cleanup () {
      clearTimeout(timer)
      if (interval) clearInterval(interval)
    }

    if (cancellation) {
      interval = setInterval(() => {
        if (cancellation.cancelled) {
          cleanup()
          reject(new CancelledError(cancellation.reason))
        }
      }, 100)
      interval.unref?.()
    }
  })
}

function withTimeout (promise, ms, message = 'Operasi timeout') {
  let timer
  const timeout = new Promise((resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

async function retry (fn, attempts = 3, delayMs = 500, cancellation) {
  let lastError
  for (let i = 0; i < attempts; i++) {
    cancellation?.throwIfCancelled()
    try {
      return await fn(i)
    } catch (err) {
      if (err instanceof CancelledError) throw err
      lastError = err
      if (i < attempts - 1) await sleep(delayMs, cancellation)
    }
  }
  throw lastError
}

function clamp (value, min, max) {
  return Math.max(min, Math.min(max, value))
}

module.exports = { sleep, withTimeout, retry, clamp, Cancellation, CancelledError }
