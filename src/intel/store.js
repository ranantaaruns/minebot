'use strict'

const fs = require('fs')
const path = require('path')

// Simpan ke satu file per bot. Tulis ke .tmp lalu rename supaya file tidak
// pernah setengah jadi saat bot di-kill; debounce mencegah I/O tiap tick.
class TrackerStore {
  constructor (dir, options = {}) {
    this.dir = dir
    this.file = path.join(dir, options.file || 'players.json')
    this.debounceMs = Number(options.debounceMs) || 2000
    this.timer = null
    this.pending = null
    this.writing = false
  }

  async load () {
    try {
      const parsed = JSON.parse(await fs.promises.readFile(this.file, 'utf8'))
      if (parsed && typeof parsed.players === 'object' && parsed.players !== null) {
        return { version: 1, players: parsed.players }
      }
    } catch {}
    return { version: 1, players: {} }
  }

  schedule (data) {
    this.pending = data
    if (this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.flush().catch(() => {})
    }, this.debounceMs)
    this.timer.unref?.()
  }

  async flush () {
    if (this.writing || !this.pending) return false
    const data = this.pending
    this.pending = null
    this.writing = true
    try {
      await fs.promises.mkdir(this.dir, { recursive: true })
      const tmp = `${this.file}.tmp`
      await fs.promises.writeFile(tmp, JSON.stringify(data), 'utf8')
      await fs.promises.rename(tmp, this.file)
      return true
    } finally {
      this.writing = false
    }
  }

  cancel () {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
  }
}

module.exports = { TrackerStore }
