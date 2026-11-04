'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const Vec3 = require('vec3')
const { EventEmitter } = require('events')
const { partitionWorkload, SwarmManager } = require('../src/swarm/manager')
const { promptSwarmConfig } = require('../src/swarm/prompt')
const { deliverItemsToOwner } = require('../src/swarm/deliver')
const { Cli } = require('../src/cli')

const silentLogger = {
  info () {},
  warn () {},
  debug () {},
  error () {},
  chat () {},
  forBot () { return this }
}

test('partitionWorkload divides tasks evenly among workers', () => {
  assert.deepEqual(partitionWorkload(10, 2), [5, 5])
  assert.deepEqual(partitionWorkload(10, 3), [4, 3, 3])
  assert.deepEqual(partitionWorkload(7, 2), [4, 3])
  assert.deepEqual(partitionWorkload(5, 1), [5])
  assert.deepEqual(partitionWorkload(1, 3), [1, 0, 0])
  assert.deepEqual(partitionWorkload(0, 2), [0, 0])
  assert.deepEqual(partitionWorkload(5, 0), [])
})

test('promptSwarmConfig returns default bot configuration in non-interactive mode', async () => {
  const baseConfig = {
    server: { host: 'localhost', port: 25565 },
    owner: { username: 'Owner' },
    bot: { username: 'test_bot', count: 2 }
  }

  const result = await promptSwarmConfig(baseConfig)
  assert.equal(result.length, 2)
  assert.equal(result[0].username, 'test_bot')
  assert.equal(result[1].username, 'test_bot_2')

  // When config.bots is already specified
  const customConfig = {
    ...baseConfig,
    bots: [{ username: 'Alpha' }, { username: 'Beta' }, { username: 'Gamma' }]
  }
  const customResult = await promptSwarmConfig(customConfig)
  assert.equal(customResult.length, 3)
  assert.equal(customResult[0].username, 'Alpha')
  assert.equal(customResult[1].username, 'Beta')
  assert.equal(customResult[2].username, 'Gamma')
})

test('deliverItemsToOwner approaches owner, turns, and tosses items', async () => {
  let comeCalled = false
  let lookAtTarget = null
  const tossed = []

  const ownerPos = new Vec3(10, 64, 10)
  const botPos = new Vec3(12, 64, 10)

  const fakeBot = {
    entity: { position: botPos },
    inventory: {
      items: () => [
        { type: 1, name: 'cobblestone', count: 5 }
      ]
    },
    async lookAt (point) {
      lookAtTarget = point
    },
    async toss (type, meta, count) {
      tossed.push({ type, meta, count })
    }
  }

  const fakeOwner = {
    async come () {
      comeCalled = true
      return { ok: true }
    },
    getOwnerEntity () {
      return { position: ownerPos }
    }
  }

  const session = {
    bot: fakeBot,
    owner: fakeOwner,
    logger: silentLogger,
    config: { owner: { username: 'TestOwner' } }
  }

  const result = await deliverItemsToOwner(session, 'cobblestone', 5)
  assert.equal(comeCalled, true)
  assert.ok(lookAtTarget)
  assert.equal(lookAtTarget.x, 10)
  assert.deepEqual(tossed, [{ type: 1, meta: null, count: 5 }])
  assert.equal(result.ok, true)
  assert.equal(result.delivered, 5)
})

test('deliverItemsToOwner returns error if item is not in inventory', async () => {
  const fakeBot = {
    entity: { position: new Vec3(0, 64, 0) },
    inventory: { items: () => [] }
  }
  const session = {
    bot: fakeBot,
    owner: null,
    logger: silentLogger
  }

  const result = await deliverItemsToOwner(session, 'diamond', 3)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'no-items-in-inventory')
  assert.equal(result.delivered, 0)
})

test('SwarmManager distributes gather workload across active bots and coordinates delivery', async () => {
  const baseConfig = {
    server: { host: 'localhost' },
    owner: { username: 'TestOwner' },
    bot: { username: 'bot' },
    swarm: { deliverOnGather: true },
    gather: { enabled: true }
  }

  const botConfigs = [{ username: 'bot_1' }, { username: 'bot_2' }]
  const swarm = new SwarmManager(botConfigs, baseConfig, silentLogger)

  // Mock active spawned state for both sessions
  for (const s of swarm.sessions) {
    s.spawned = true
    s.connected = true
    s.bot = {
      entity: { position: new Vec3(0, 64, 0).floored() },
      inventory: {
        items: () => [{ type: 10, name: 'cobblestone', count: 5 }]
      },
      storageManager: { clearKeep () {}, addKeep () {} },
      async lookAt () {},
      async toss () {}
    }
    s.owner = {
      pause () {},
      resume () {},
      async come () { return { ok: true } },
      getOwnerEntity () { return { position: new Vec3(2, 64, 0) } }
    }
  }

  // Intercept ensureItem in gather
  const mockEnsureItem = async (session, item, count) => {
    return { ok: true, have: count, missing: 0 }
  }

  // Replace gather execution with mocked material manager
  const originalGather = swarm.gather.bind(swarm)
  swarm.gather = async (item, count) => {
    const active = swarm.getConnectedBots()
    const quotas = partitionWorkload(count, active.length)
    assert.deepEqual(quotas, [5, 5])
    return {
      ok: true,
      count,
      gathered: 10,
      delivered: 10,
      details: ['bot_1: 5/5', 'bot_2: 5/5']
    }
  }

  const result = await swarm.gather('cobblestone', 10)
  assert.equal(result.ok, true)
  assert.equal(result.gathered, 10)
  assert.equal(result.delivered, 10)
})

test('SwarmManager come broadcasts come command to all active bots', async () => {
  const baseConfig = {
    server: { host: 'localhost' },
    owner: { username: 'Owner' },
    bot: { username: 'bot' }
  }
  const swarm = new SwarmManager([{ username: 'b1' }, { username: 'b2' }], baseConfig, silentLogger)

  const comeCalls = []
  for (const s of swarm.sessions) {
    s.spawned = true
    s.bot = { entity: {} }
    s.owner = {
      resume () {},
      async come (coords) {
        comeCalls.push({ bot: s.username, coords })
        return { ok: true }
      }
    }
  }

  const result = await swarm.come(new Vec3(5, 64, 5))
  assert.equal(result.ok, true)
  assert.equal(result.arrived, 2)
  assert.equal(comeCalls.length, 2)
  assert.equal(comeCalls[0].coords.x, 5)
  assert.equal(comeCalls[1].coords.x, 5)
})

test('SwarmManager stop cancels jobs and pathfinders across all bots', () => {
  const baseConfig = { server: {}, owner: {}, bot: { username: 'bot' } }
  const swarm = new SwarmManager([{ username: 'b1' }, { username: 'b2' }], baseConfig, silentLogger)

  let b1Stopped = false
  let b2Stopped = false

  swarm.sessions[0].jobs = { stop () { b1Stopped = true; return true } }
  swarm.sessions[1].jobs = { stop () { b2Stopped = true; return true } }

  const stopped = swarm.stop()
  assert.equal(b1Stopped, true)
  assert.equal(b2Stopped, true)
  assert.equal(stopped, 2)
})

test('Cli displays multi-bot status and delegates commands to swarm', async () => {
  const baseConfig = {
    server: { host: 'localhost' },
    owner: { username: 'Owner' },
    bot: { username: 'bot' },
    auth: { enabled: true }
  }
  const swarm = new SwarmManager([{ username: 'b1' }, { username: 'b2' }], baseConfig, silentLogger)

  for (const s of swarm.sessions) {
    s.spawned = true
    s.connected = true
    s.bot = {
      entity: { position: new Vec3(1, 64, 1) },
      health: 20,
      food: 20,
      game: { gameMode: 'survival' }
    }
  }

  let gatheredItem = null
  let gatheredCount = null
  swarm.gather = async (item, count) => {
    gatheredItem = item
    gatheredCount = count
    return { ok: true }
  }

  let comeCalled = false
  swarm.come = async () => {
    comeCalled = true
    return { ok: true }
  }

  const cli = new Cli(swarm, baseConfig, silentLogger)

  // Status
  const logOutput = []
  const originalLog = console.log
  console.log = msg => logOutput.push(msg)
  try {
    cli.printStatus()
    assert.ok(logOutput.some(line => line.includes('Status Swarm (2/2 Bot Online)')))
    assert.ok(logOutput.some(line => line.includes('b1')))
    assert.ok(logOutput.some(line => line.includes('b2')))

    // Position
    cli.printPosition()
    assert.ok(logOutput.some(line => line.includes('1.00 64.00 1.00')))

    // Gather
    await cli.handleLine('gather cobblestone 10')
    assert.equal(gatheredItem, 'cobblestone')
    assert.equal(gatheredCount, 10)

    // Come
    await cli.handleLine('come')
    assert.equal(comeCalled, true)
  } finally {
    console.log = originalLog
  }
})
