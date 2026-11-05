'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const Vec3 = require('vec3')

const silentLogger = { info () {}, debug () {}, warn () {}, error () {} }

// MaterialManager & deliver di-patch sebelum manager di-require supaya gather
// bisa diuji tanpa server Minecraft.
const resolveMod = require('../src/materials/resolve')
const deliverMod = require('../src/swarm/deliver')

const ensureCalls = []
const deliveredCalls = []
let stuckMode = false

class FakeMaterials {
  constructor (bot) {
    this.bot = bot
  }

  async ensureItem (name, count) {
    ensureCalls.push({ name, count })
    if (stuckMode) return { ok: false, have: 1, missing: Math.max(0, count - 1) }
    // Putaran pertama tiap bot hanya dapat 3 log, putaran berikutnya penuh.
    const have = count >= 5 ? 3 : count
    return { ok: have >= count, have, missing: Math.max(0, count - have) }
  }
}

resolveMod.MaterialManager = FakeMaterials
deliverMod.deliverItemsToOwner = async (session, name, amount) => {
  deliveredCalls.push({ bot: session.username, name, amount })
  return { delivered: amount, total: amount }
}

const { SwarmManager } = require('../src/swarm/manager')

function makeSwarm (usernames) {
  const baseConfig = {
    server: { host: 'localhost' },
    owner: { username: 'Owner' },
    bot: { username: 'bot' },
    swarm: { deliverOnGather: true, gatherRounds: 2 },
    gather: { enabled: true }
  }
  const swarm = new SwarmManager(usernames.map(username => ({ username })), baseConfig, silentLogger)
  for (const session of swarm.sessions) {
    session.spawned = true
    session.connected = true
    session.bot = {
      username: session.username,
      entity: { position: new Vec3(0, 64, 0) },
      inventory: { items: () => [], emptySlotCount: () => 20 },
      storageManager: { clearKeep () {}, addKeep () {} }
    }
    session.owner = { pause () {}, resume () {} }
    session.jobs = {
      busy: false,
      async run (jobName, fn) {
        return fn(async () => {})
      }
    }
  }
  return swarm
}

test('gather mengulang putaran kedua untuk menutup kekurangan kuota', async () => {
  ensureCalls.length = 0
  deliveredCalls.length = 0
  const swarm = makeSwarm(['bot_1', 'bot_2'])

  const result = await swarm.gather('dark_oak_log', 10)

  assert.equal(result.ok, true, 'kuota akhirnya terpenuhi lewat putaran kedua')
  assert.equal(result.delivered, 10)
  assert.deepEqual(ensureCalls.map(call => call.count), [5, 5, 2, 2], 'sisa 4 log dibagi ke dua bot')
  assert.equal(deliveredCalls.length, 4)
  assert.equal(result.details.filter(detail => detail.includes('putaran 2')).length, 2)
})

test('gather berhenti kalau putaran tambahan tidak menambah hasil', async () => {
  ensureCalls.length = 0
  deliveredCalls.length = 0
  stuckMode = true

  try {
    const swarm = makeSwarm(['bot_1'])
    const result = await swarm.gather('dark_oak_log', 32)

    assert.equal(result.ok, false)
    assert.equal(result.delivered, 2)
    assert.equal(ensureCalls.length, 2, 'jumlah putaran dibatasi gatherRounds, tidak berulang tanpa henti')
  } finally {
    stuckMode = false
  }
})

test('gather melempar error kalau tidak ada bot idle di putaran pertama', async () => {
  const swarm = makeSwarm(['bot_1'])
  swarm.sessions[0].jobs.busy = true
  await assert.rejects(() => swarm.gather('dark_oak_log', 4), /Tidak ada bot/)
})
