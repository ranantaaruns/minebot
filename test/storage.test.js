'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const Vec3 = require('vec3')
const mcData = require('minecraft-data')('1.21.4')
const { StorageManager } = require('../src/storage/manager')

const silentLogger = {
  info () {},
  warn () {},
  debug () {},
  error () {}
}

function item (name, count = 1) {
  return { name, type: mcData.itemsByName[name].id, count }
}

function fakeBot (items, freeSlots = 10) {
  return {
    version: '1.21.4',
    entity: { position: new Vec3(0, 64, 0) },
    inventory: {
      items: () => items,
      emptySlotCount: () => freeSlots
    },
    findBlocks: () => []
  }
}

function storageConfig (overrides = {}) {
  return {
    enabled: true,
    radius: 32,
    minFreeSlots: 2,
    containers: ['chest', 'barrel', 'shulker_box'],
    ...overrides
  }
}

test('StorageManager keeps gear, armor, food, fuel and job items', () => {
  const bot = fakeBot([
    item('diamond_pickaxe'),
    item('diamond_helmet'),
    item('apple'),
    item('coal'),
    item('oak_log'),
    item('oak_planks'),
    item('cherry_stairs'),
    item('cobblestone', 4)
  ])
  const storage = new StorageManager(bot, storageConfig(), silentLogger, {
    keep: ['cherry_stairs']
  })

  assert.equal(storage.isKeepItem('diamond_pickaxe'), true)
  assert.equal(storage.isKeepItem('diamond_helmet'), true)
  assert.equal(storage.isKeepItem('apple'), true)
  assert.equal(storage.isKeepItem('coal'), true)
  assert.equal(storage.isKeepItem('oak_log'), true)
  assert.equal(storage.isKeepItem('oak_planks'), true)
  assert.equal(storage.isKeepItem('cherry_stairs'), true)
  assert.equal(storage.isKeepItem('cobblestone'), false)
  assert.deepEqual(storage.depositableItems().map(entry => entry.name), ['cobblestone'])
})

test('StorageManager setKeep and clearKeep update the job whitelist', () => {
  const bot = fakeBot([item('cherry_stairs'), item('cobblestone')])
  const storage = new StorageManager(bot, storageConfig(), silentLogger)

  storage.setKeep(['cherry_stairs'])
  assert.equal(storage.isKeepItem('cherry_stairs'), true)
  assert.equal(storage.isKeepItem('cobblestone'), false)

  storage.clearKeep()
  assert.equal(storage.isKeepItem('cherry_stairs'), false)
  storage.addKeep(['cobblestone'])
  assert.equal(storage.isKeepItem('minecraft:cobblestone'), true)
})

test('StorageManager only deposits when free slots reach the threshold', async () => {
  const bot = fakeBot([item('cobblestone', 64)], 3)
  const storage = new StorageManager(bot, storageConfig(), silentLogger)

  assert.equal(storage.shouldDeposit(), false)
  assert.deepEqual(await storage.depositIfNeeded(null), { ok: true, deposited: 0, reason: null })
})

test('StorageManager reports missing storage when the inventory is full', async () => {
  const bot = fakeBot([item('cobblestone', 64)], 0)
  const storage = new StorageManager(bot, storageConfig(), silentLogger)

  const result = await storage.depositIfNeeded(null)
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'no-storage')
  assert.equal(result.deposited, 0)
})
