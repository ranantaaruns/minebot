'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const Vec3 = require('vec3')
const mcData = require('minecraft-data')('1.21.4')
const { applyMovements } = require('../src/movements')
const { preferredRank, isUnderBot } = require('../src/materials/gather')
const { TowerSupply, towerBlockCount, towerRequirement } = require('../src/navigation/tower-supply')

const silentLogger = {
  info () {},
  warn () {},
  debug () {},
  error () {}
}

function item (name, count) {
  return { type: mcData.itemsByName[name].id, count }
}

function fakeBot (items = [], position = new Vec3(0, 64, 0)) {
  const inventory = items.map(([name, count]) => item(name, count))
  return {
    version: '1.21.4',
    registry: mcData,
    entity: { position, isInWater: false },
    inventory: {
      items: () => inventory,
      emptySlotCount: () => 10
    },
    findBlocks: () => [],
    pushItem (name, count) {
      inventory.push(item(name, count))
    },
    pathfinder: {
      setMovements (movements) { this.movements = movements }
    }
  }
}

function supplyConfig (overrides = {}) {
  return {
    owner: {
      allowTower: true,
      towerBlocks: ['dirt', 'grass_block', 'cobblestone'],
      towerGather: {
        enabled: true,
        item: 'dirt',
        preferredBlocks: ['grass_block', 'dirt'],
        radius: 32,
        protectRadius: 6,
        reserve: 8,
        minGap: 2,
        maxPerAttempt: 32,
        maxAttempts: 3,
        cooldownMs: 30000,
        timeoutMs: 120000,
        allowHandMining: true,
        ...overrides
      }
    }
  }
}

test('travel movements enable tower blocks in priority order', () => {
  const bot = fakeBot()
  const movements = applyMovements(bot, 'travel', {
    allowTower: true,
    towerBlocks: ['dirt', 'grass_block', 'cobblestone'],
    towerPlaceCost: 40
  })

  assert.equal(movements.allow1by1towers, true)
  assert.equal(movements.placeCost, 40)
  assert.deepEqual(
    movements.scafoldingBlocks.map(id => mcData.items[id].name),
    ['dirt', 'grass_block', 'cobblestone']
  )
})

test('build movements keep tower placement disabled', () => {
  const bot = fakeBot()
  const movements = applyMovements(bot, 'build', {
    allowTower: true,
    towerBlocks: ['dirt']
  })

  assert.equal(movements.allow1by1towers, false)
  assert.deepEqual(movements.scafoldingBlocks, [])
})

test('towerRequirement targets the height gap plus reserve', () => {
  assert.deepEqual(towerRequirement(64, 72, 2, {
    reserve: 8,
    minGap: 2,
    maxPerAttempt: 32,
    maxAttempts: 3
  }), { gap: 8, desired: 16, missing: 14 })

  assert.deepEqual(towerRequirement(64, 64.5, 2, {
    reserve: 8,
    minGap: 2,
    maxPerAttempt: 32,
    maxAttempts: 3
  }), { gap: 0.5, desired: 2, missing: 0 })
})

test('towerBlockCount counts only configured tower items', () => {
  const bot = fakeBot([['dirt', 3], ['cobblestone', 2], ['oak_planks', 5]])
  assert.equal(towerBlockCount(bot, mcData, ['dirt', 'cobblestone']), 5)
})

test('tower supply gathers the deficit and passes safe mining options', async () => {
  const bot = fakeBot([['dirt', 2]])
  const calls = []
  const materials = {
    minedCount: 0,
    async ensureItem (name, count, cancellation, options) {
      calls.push({ name, count, options })
      bot.pushItem('dirt', count - 2)
      return { ok: true, have: count }
    }
  }
  const supply = new TowerSupply(bot, supplyConfig(), silentLogger, materials)
  const target = new Vec3(10, 72, 0)

  const result = await supply.ensure(target)

  assert.equal(result.ok, true)
  assert.equal(result.have, 16)
  assert.equal(result.gathered, 14)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, 'dirt')
  assert.equal(calls[0].count, 16)
  assert.equal(calls[0].options.protectOrigin, target)
  assert.equal(calls[0].options.protectRadius, 6)
  assert.equal(calls[0].options.maxMinePerJob, 14)
  assert.deepEqual(calls[0].options.preferredBlocks, ['grass_block', 'dirt'])
  assert.equal(calls[0].options.allowHandMining, true)
  assert.equal(calls[0].options.avoidUnderBot, true)
})

test('tower supply skips mining when inventory already has enough blocks', async () => {
  const bot = fakeBot([['dirt', 20]])
  const materials = {
    minedCount: 0,
    async ensureItem () {
      throw new Error('should not mine')
    }
  }
  const supply = new TowerSupply(bot, supplyConfig(), silentLogger, materials)

  const result = await supply.ensure(new Vec3(0, 70, 0))

  assert.equal(result.ok, true)
  assert.equal(result.gathered, 0)
})

test('tower supply refuses to gather while in water', async () => {
  const bot = fakeBot([], new Vec3(0, 64, 0))
  bot.entity.isInWater = true
  const supply = new TowerSupply(bot, supplyConfig(), silentLogger, {
    minedCount: 0,
    async ensureItem () {
      throw new Error('should not mine')
    }
  })

  const result = await supply.ensure(new Vec3(0, 80, 0))

  assert.equal(result.ok, false)
  assert.equal(result.reason, 'in-water')
})

test('tower supply stops retrying after a fruitless attempt', async () => {
  const bot = fakeBot([], new Vec3(0, 64, 0))
  let attempts = 0
  const materials = {
    minedCount: 0,
    async ensureItem () {
      attempts++
      return { ok: false, have: 0, reason: 'not-found' }
    }
  }
  const supply = new TowerSupply(bot, supplyConfig(), silentLogger, materials)
  const target = new Vec3(0, 72, 0)

  const first = await supply.ensure(target)
  const second = await supply.ensure(target)

  assert.equal(first.ok, false)
  assert.equal(second.ok, false)
  assert.equal(second.reason, 'unavailable')
  assert.equal(attempts, 1, 'pencarian blok tower tidak diulang terus-menerus')
})

test('gather helpers prefer grass and avoid digging under the bot', () => {
  assert.equal(preferredRank('grass_block', ['grass_block', 'dirt']), 0)
  assert.equal(preferredRank('dirt', ['grass_block', 'dirt']), 1)
  assert.equal(preferredRank('cobblestone', ['grass_block', 'dirt']), 2)
  assert.equal(isUnderBot(new Vec3(0, 63, 0), new Vec3(0.5, 64.5, 0.5)), true)
  assert.equal(isUnderBot(new Vec3(2, 63, 0), new Vec3(0.5, 64.5, 0.5)), false)
})

test('gather movements allow 1x1 towers with common mining blocks', () => {
  const bot = fakeBot()
  const movements = applyMovements(bot, 'gather', {
    allowTower: true,
    towerBlocks: ['dirt']
  })

  assert.equal(movements.allow1by1towers, true)
  const names = movements.scafoldingBlocks.map(id => mcData.items[id].name)
  assert.ok(names.includes('dirt'))
  assert.ok(names.includes('cobblestone'), 'blok tambang umum harus bisa dipakai menumpuk')
  assert.ok(names.includes('deepslate'))
})

test('gather movements still refuse towers when the owner disabled them', () => {
  const bot = fakeBot()
  const movements = applyMovements(bot, 'gather', { allowTower: false, towerBlocks: ['dirt'] })

  assert.equal(movements.allow1by1towers, false)
  assert.deepEqual(movements.scafoldingBlocks, [])
})

test('travel movements use the configured swim liquid cost', () => {
  const bot = fakeBot()
  const movements = applyMovements(bot, 'travel', {
    swim: { liquidCost: 12 },
    allowTower: false
  })

  assert.equal(movements.liquidCost, 12)
})
