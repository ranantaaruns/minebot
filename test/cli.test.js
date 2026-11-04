'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const Vec3 = require('vec3')
const { Schematic } = require('prismarine-schematic')
const { Cli, resolveBlueprintPath } = require('../src/cli')

const silentLogger = {
  info () {},
  warn () {},
  error () {},
  debug () {},
  chat () {}
}

test('Cli.materials works without a connected bot', async () => {
  const schematic = Schematic.fromJSON(JSON.stringify({
    version: '1.21.4',
    size: { x: 2, y: 2, z: 2 },
    offset: { x: 0, y: 0, z: 0 },
    palette: [0, 1],
    blocks: [1, 1, 1, 1, 1, 1, 1, 1]
  }))
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-cli-'))
  const file = path.join(dir, 'dinding.schem')
  fs.writeFileSync(file, await schematic.write())

  const config = { server: {}, build: { maxVolume: 1000 } }
  const session = { bot: null, jobs: { busy: false } }
  const cli = new Cli(session, config, silentLogger)

  const originalLog = console.log
  console.log = () => {}
  try {
    await cli.handleMaterials([file])
  } finally {
    console.log = originalLog
  }

  fs.rmSync(dir, { recursive: true, force: true })
})

test('resolveBlueprintPath finds files in the project blueprints folder', () => {
  const file = path.resolve(__dirname, '..', 'blueprints', '__lookup_test__.litematic')
  fs.writeFileSync(file, '')
  try {
    assert.equal(resolveBlueprintPath('__lookup_test__.litematic'), file)
  } finally {
    fs.rmSync(file, { force: true })
  }
})

test('Cli.register asks AuthManager to send /register again', async () => {
  let calls = 0
  const session = {
    bot: { entity: {} },
    auth: {
      forceRegister () {
        calls++
        return true
      }
    },
    jobs: { busy: false }
  }
  const cli = new Cli(session, { server: {}, build: {}, auth: { enabled: true } }, silentLogger)

  await cli.handleLine('register')
  assert.equal(calls, 1)
})

test('Cli.handleGamemode delegates to GamemodeManager', async () => {
  let targetMode = null
  const session = {
    bot: { entity: {}, game: { gameMode: 'survival' } },
    gamemode: {
      async setGamemode (mode) {
        targetMode = mode
        return { ok: true, mode }
      }
    },
    jobs: { busy: false }
  }
  const cli = new Cli(session, { server: {}, build: {} }, silentLogger)

  await cli.handleLine('gamemode creative')
  assert.equal(targetMode, 'creative')

  const current = await cli.handleGamemode([])
  assert.equal(current, 'survival')
})

test('Cli._parseBuildOptions recognizes --creative and --survival flags', () => {
  const cli = new Cli({}, { server: {}, build: {} }, silentLogger)
  const optsCreative = cli._parseBuildOptions(['house.schem', '--creative'])
  assert.equal(optsCreative.creative, true)
  assert.equal(optsCreative.survival, false)

  const optsSurvival = cli._parseBuildOptions(['house.schem', '--survival'])
  assert.equal(optsSurvival.creative, false)
  assert.equal(optsSurvival.survival, true)
})

function fakeSession (id, username, overrides = {}) {
  return {
    id,
    username,
    bot: { entity: {}, version: '1.21.4' },
    jobs: { busy: false, name: null },
    auth: { authenticated: true },
    owner: null,
    gamemode: null,
    builder: null,
    dialog: null,
    spawned: true,
    ...overrides
  }
}

function fakeSwarm (sessions) {
  return {
    isSwarm: true,
    sessions,
    getPrimary () {
      return sessions.find(s => s.spawned) || sessions[0] || null
    },
    getAllSessions () {
      return sessions
    },
    getConnectedBots () {
      return sessions.filter(s => s.bot && s.spawned)
    }
  }
}

test('Cli memakai session primary terbaru, bukan snapshot saat konstruksi', () => {
  // Saat CLI dibuat belum ada bot yang spawn, jadi getPrimary() mengembalikan session pertama.
  const first = fakeSession(1, 'BotA', { bot: null, spawned: false })
  const second = fakeSession(2, 'BotB', { spawned: false })
  const swarm = fakeSwarm([first, second])
  const cli = new Cli(swarm, { server: {}, build: {} }, silentLogger)

  assert.equal(cli.session, first)

  // BotB berhasil connect belakangan: snapshot di cli.session sudah basi.
  second.spawned = true
  assert.equal(cli.getSession(), second)
  assert.equal(cli.getBot(), second.bot)
})

test('Cli.getSession mendukung pemilihan --bot lewat id atau username', () => {
  const first = fakeSession(1, 'BotA')
  const second = fakeSession(2, 'BotB', { bot: null })
  const cli = new Cli(fakeSwarm([first, second]), { server: {}, build: {} }, silentLogger)

  assert.equal(cli.getSession('2'), second)
  assert.equal(cli.getSession('botb'), second)
  assert.throws(() => cli.getSession('tidak-ada'), /tidak ditemukan/)
})

test('Cli._originFor membaca owner dari session yang dipilih', () => {
  const first = fakeSession(1, 'BotA')
  const second = fakeSession(2, 'BotB', {
    owner: { getOwnerEntity: () => ({ position: { floored: () => new Vec3(1, 2, 3) } }) }
  })
  const cli = new Cli(fakeSwarm([first, second]), { server: {}, build: { anchor: 'player' } }, silentLogger)

  const origin = cli._originFor({}, second.bot, second)
  assert.deepEqual(origin, new Vec3(1, 2, 3))
})

test('Cli._parseBuildOptions membaca --rotate, --mirror, dan --bot', () => {
  const cli = new Cli({}, { server: {}, build: {} }, silentLogger)
  const opts = cli._parseBuildOptions(['rumah.schem', '--rotate', '90', '--mirror', 'x', '--bot', '2'])

  assert.equal(opts.file, 'rumah.schem')
  assert.equal(opts.rotate, 90)
  assert.equal(opts.mirror, 'x')
  assert.equal(opts.bot, '2')
  assert.throws(() => cli._parseBuildOptions(['rumah.schem', '--rotate', '45']), /kelipatan 90/)
  assert.throws(() => cli._parseBuildOptions(['rumah.schem', '--mirror', 'y']), /x atau z/)
})
