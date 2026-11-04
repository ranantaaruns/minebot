'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const Vec3 = require('vec3')
const mcData = require('minecraft-data')('1.21.4')
const { MaterialManager } = require('../src/materials/resolve')

const silentLogger = {
  info () {},
  warn () {},
  debug () {},
  error () {}
}

function requirementMap (items) {
  const map = new Map()
  for (const [name, count] of Object.entries(items)) {
    map.set(name, {
      name,
      itemId: mcData.itemsByName[name]?.id,
      count,
      states: new Set()
    })
  }
  return {
    items: map,
    itemCount: map.size,
    totalBlocks: [...map.values()].reduce((sum, item) => sum + item.count, 0),
    skipped: new Map(),
    unsupported: new Map()
  }
}

function fakeBot (biome, items = []) {
  return {
    version: '1.21.4',
    entity: { position: new Vec3(0, 64, 0) },
    inventory: {
      items: () => items.map(([name, count]) => ({
        type: mcData.itemsByName[name].id,
        count
      }))
    },
    blockAt () {
      return { biome: { name: biome } }
    },
    findBlocks: () => []
  }
}

function biomeConfig (overrides = {}) {
  return {
    gather: { preferChests: false, enabled: false },
    safety: { minHealth: 6 },
    build: {
      biomeMaterials: {
        enabled: true,
        askOwner: true,
        allowCustomAlternative: true,
        reminderMs: 0,
        pickupRadius: 8,
        ownerSupplyTimeoutMs: 0,
        ...overrides
      }
    }
  }
}

test('resolveBiomeMaterials substitutes a whole wood family from an owner choice', async () => {
  const bot = fakeBot('savanna')
  const materials = new MaterialManager(bot, biomeConfig(), silentLogger, {
    origin: new Vec3(0, 64, 0)
  })
  const requirements = requirementMap({ cherry_stairs: 4, cherry_planks: 8 })
  const dialog = { ask: async () => '1' }

  const result = await materials.resolveBiomeMaterials(requirements, {
    origin: new Vec3(0, 64, 0),
    dialog
  })

  assert.equal(result.biome, 'savanna')
  assert.equal(result.substitutions.get('cherry_stairs'), 'acacia_stairs')
  assert.equal(result.substitutions.get('cherry_planks'), 'acacia_planks')
  assert.equal(result.requirements.items.has('acacia_stairs'), true)
  assert.equal(result.requirements.items.has('acacia_planks'), true)
  assert.equal(result.requirements.items.has('cherry_stairs'), false)
})

test('resolveBiomeMaterials accepts a custom item alternative', async () => {
  const bot = fakeBot('savanna')
  const materials = new MaterialManager(bot, biomeConfig(), silentLogger, {
    origin: new Vec3(0, 64, 0)
  })
  const requirements = requirementMap({ cherry_stairs: 4 })
  const dialog = { ask: async () => 'birch' }

  const result = await materials.resolveBiomeMaterials(requirements, {
    origin: new Vec3(0, 64, 0),
    dialog
  })

  assert.equal(result.substitutions.get('cherry_stairs'), 'birch_stairs')
  assert.equal(result.requirements.items.has('birch_stairs'), true)
})

test('resolveBiomeMaterials does not prompt when materials match the biome', async () => {
  const bot = fakeBot('cherry_grove')
  const materials = new MaterialManager(bot, biomeConfig(), silentLogger, {
    origin: new Vec3(0, 64, 0)
  })
  const requirements = requirementMap({ cherry_stairs: 4 })
  let asked = 0
  const dialog = { ask: async () => { asked++; return '1' } }

  const result = await materials.resolveBiomeMaterials(requirements, {
    origin: new Vec3(0, 64, 0),
    dialog
  })

  assert.equal(asked, 0)
  assert.equal(result.requirements, requirements)
  assert.equal(result.substitutions.size, 0)
})

test('resolveBiomeMaterials skips the prompt when materials are already in stock', async () => {
  const bot = fakeBot('savanna', [['cherry_stairs', 4]])
  const materials = new MaterialManager(bot, biomeConfig(), silentLogger, {
    origin: new Vec3(0, 64, 0)
  })
  const requirements = requirementMap({ cherry_stairs: 4 })
  let asked = 0
  const dialog = { ask: async () => { asked++; return '1' } }

  const result = await materials.resolveBiomeMaterials(requirements, {
    origin: new Vec3(0, 64, 0),
    dialog
  })

  assert.equal(asked, 0)
  assert.equal(result.substitutions.size, 0)
})
