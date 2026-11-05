'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { Cli } = require('../src/cli')

const silentLogger = { info () {}, warn () {}, error () {}, debug () {}, chat () {} }

function tracker () {
  const t = {
    stats: { samples: 4, tracked: 1, alerts: 0 },
    _enabled: true,
    list: () => [{ username: 'Steve', coords: '10.0 64.0 0.0', distance: 10, compass: 'timur', stale: false, ageMs: 400, dimension: 'minecraft:overworld', prediction: null }],
    where: name => (name === 'Steve'
      ? { username: 'Steve', coords: '10.0 64.0 0.0', distance: 10, compass: 'timur', stale: false, ageMs: 400, dimension: 'minecraft:overworld', samples: 3, prediction: { x: 20, y: 64, z: 0, uncertainty: 1.5, aheadMs: 5000 } }
      : null),
    exportTo: async file => `C:/tmp/${file}`,
    clear: () => {}
  }
  Object.defineProperty(t, 'enabled', {
    get () { return t._enabled },
    set (value) { t._enabled = value }
  })
  return t
}

function cliFor (t) {
  return new Cli({ bot: { username: 'BotA', playerTracker: t } }, {}, silentLogger)
}

test('track tanpa argumen menampilkan daftar', async () => {
  const lines = await cliFor(tracker()).handleTrack([])
  assert.equal(lines.length, 2)
  assert.match(lines[0], /BotA: aktif/)
  assert.match(lines[1], /Steve/)
  assert.match(lines[1], /10\.0 64\.0 0\.0/)
  assert.match(lines[1], /timur/)
})

test('track where menampilkan detail dan prediksi', async () => {
  const lines = await cliFor(tracker()).handleTrack(['where', 'Steve'])
  assert.match(lines[0], /Steve/)
  assert.match(lines[0], /segar/)
  assert.match(lines[1], /prediksi/)
})

test('track where pemain tak dikenal melempar error', async () => {
  await assert.rejects(() => cliFor(tracker()).handleTrack(['where', 'Herobrine']), /tidak ada/)
})

test('track where tanpa nama melempar error', async () => {
  await assert.rejects(() => cliFor(tracker()).handleTrack(['where']), /track where/)
})

test('track off mematikan tracker', async () => {
  const t = tracker()
  const lines = await cliFor(t).handleTrack(['off'])
  assert.equal(t.enabled, false)
  assert.match(lines[0], /nonaktif/)
})

test('track export mengembalikan path absolut', async () => {
  const lines = await cliFor(tracker()).handleTrack(['export', 'out.json'])
  assert.match(lines[0], /out\.json/)
})

test('track clear mengosongkan riwayat', async () => {
  const t = tracker()
  let cleared = 0
  t.clear = () => { cleared += 1 }
  const lines = await cliFor(t).handleTrack(['clear'])
  assert.equal(cleared, 1)
  assert.match(lines[0], /dihapus/)
})

test('track tanpa bot melempar error', async () => {
  const cli = new Cli({ bot: null }, {}, silentLogger)
  await assert.rejects(() => cli.handleTrack([]), /tidak tersedia/)
})
