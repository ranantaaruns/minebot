'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { TrackerStore } = require('../src/intel/store')

function tmpDir () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-tracker-'))
}

test('load mengembalikan struktur kosong bila file belum ada', async () => {
  const store = new TrackerStore(tmpDir())
  assert.deepEqual(await store.load(), { version: 1, players: {} })
})

test('flush menulis JSON atomik lalu load membacanya', async () => {
  const dir = tmpDir()
  const store = new TrackerStore(dir, { debounceMs: 10 })
  const data = { version: 1, players: { Steve: { uuid: 'u1', samples: [{ t: 1, x: 1, y: 64, z: 2 }] } } }
  store.schedule(data)
  assert.equal(await store.flush(), true)
  assert.deepEqual(await store.load(), data)
  assert.equal(fs.existsSync(`${store.file}.tmp`), false)
})

test('load mengabaikan file rusak', async () => {
  const dir = tmpDir()
  const store = new TrackerStore(dir)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(store.file, '{rusak', 'utf8')
  assert.deepEqual(await store.load(), { version: 1, players: {} })
})

test('flush tanpa data tertunda mengembalikan false', async () => {
  const store = new TrackerStore(tmpDir())
  assert.equal(await store.flush(), false)
})

test('file default bernama players.json di dalam dir', () => {
  const store = new TrackerStore('data/tracker')
  assert.match(store.file, /players\.json$/)
})
