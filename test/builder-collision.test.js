'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const Vec3 = require('vec3')
const mcDataLoader = require('minecraft-data')
const {
  collidesWithBlock,
  hasCollisionBox,
  candidateStandingSpots
} = require('../src/build/placement')
const { Builder } = require('../src/build/builder')

test('collidesWithBlock detects when bot body intersects target block', () => {
  const bot = {
    entity: { position: new Vec3(25.0, 71.0, 17.0) },
    physics: { playerHalfWidth: 0.3, playerHeight: 1.8 }
  }

  // Inside the block
  assert.equal(collidesWithBlock(bot, new Vec3(25, 71, 17)), true)

  // Stepped 1 block away (x = 24.0)
  bot.entity.position = new Vec3(24.0, 71.0, 17.0)
  assert.equal(collidesWithBlock(bot, new Vec3(25, 71, 17)), false)

  // Stepped 1 block away (z = 18.5)
  bot.entity.position = new Vec3(25.0, 71.0, 18.5)
  assert.equal(collidesWithBlock(bot, new Vec3(25, 71, 17)), false)

  // 2 blocks above (y = 73.0)
  bot.entity.position = new Vec3(25.0, 73.0, 17.0)
  assert.equal(collidesWithBlock(bot, new Vec3(25, 71, 17)), false)
})

test('hasCollisionBox returns true for solid blocks and false for pass-through blocks', () => {
  const mcData = mcDataLoader('1.21.4')
  assert.equal(hasCollisionBox(mcData, 'spruce_planks'), true)
  assert.equal(hasCollisionBox(mcData, 'stone'), true)
  assert.equal(hasCollisionBox(mcData, 'torch'), false)
  assert.equal(hasCollisionBox(mcData, 'redstone_wire'), false)
})

test('candidateStandingSpots filters out spots that collide with target block', () => {
  const target = new Vec3(25, 71, 17)
  const bot = {
    entity: { position: new Vec3(24.5, 71.0, 17.5) },
    blockAt: pos => {
      // Ground at y=70 is solid, air at y=71 and y=72
      if (pos.y < 71) return { name: 'stone', boundingBox: 'block' }
      return { name: 'air', boundingBox: 'empty' }
    }
  }

  const spots = candidateStandingSpots(bot, target, { radius: 2 })
  assert.ok(spots.length > 0)

  for (const spot of spots) {
    const center = spot.feet.offset(0.5, 0, 0.5)
    assert.equal(
      collidesWithBlock({ entity: { position: center } }, target),
      false,
      `Spot ${spot.feet} should not collide with target`
    )
  }
})

test('Builder _tryPlaceAt refuses to place if bot collides with target', async () => {
  const version = '1.21.4'
  const mcData = mcDataLoader(version)
  let placeCalls = 0

  const bot = {
    version,
    game: { gameMode: 'survival' },
    entity: { position: new Vec3(25.0, 71.0, 17.0) }, // Standing right in target!
    physics: { playerHalfWidth: 0.3, playerHeight: 1.8 },
    inventory: {
      items: () => [{ type: mcData.itemsByName.spruce_planks.id, name: 'spruce_planks', count: 64 }]
    },
    blockAt: pos => {
      if (pos.equals(new Vec3(25, 70, 17))) return { name: 'stone', boundingBox: 'block' }
      return { name: 'air' }
    },
    equip: async () => {},
    setControlState: () => {},
    placeBlock: async () => {
      placeCalls++
    }
  }

  const blueprint = { name: 'test', size: new Vec3(1, 1, 1), blocks: [] }
  const builder = new Builder(bot, blueprint, {
    config: { build: { reach: 4.2 } }
  })

  const action = {
    pos: new Vec3(25, 71, 17),
    name: 'minecraft:spruce_planks',
    itemName: 'spruce_planks'
  }

  // Should immediately return false without calling bot.placeBlock!
  const res = await builder._tryPlaceAt(action)
  assert.equal(res, false)
  assert.equal(placeCalls, 0)
})

test('Builder _placeAction steps away when standing in target before placing', async () => {
  const version = '1.21.4'
  const mcData = mcDataLoader(version)
  const pathsTaken = []
  let placeCalls = 0

  const bot = {
    version,
    game: { gameMode: 'survival' },
    entity: { position: new Vec3(25.0, 71.0, 17.0) }, // Starts inside (25, 71, 17)
    physics: { playerHalfWidth: 0.3, playerHeight: 1.8 },
    inventory: {
      items: () => [{ type: mcData.itemsByName.spruce_planks.id, name: 'spruce_planks', count: 64 }]
    },
    blockAt: pos => {
      if (pos.y < 71) return { name: 'stone', boundingBox: 'block' }
      return { name: 'air' }
    },
    pathfinder: {
      async goto (goal) {
        pathsTaken.push(goal)
        // Simulate bot moving to the destination block
        bot.entity.position = new Vec3(goal.x + 0.5, goal.y, goal.z + 0.5)
      },
      stop: () => {}
    },
    equip: async () => {},
    setControlState: () => {},
    placeBlock: async () => {
      placeCalls++
      // Simulate successful block placement
      bot.blockAt = pos => {
        if (pos.equals(new Vec3(25, 71, 17))) return { name: 'spruce_planks' }
        if (pos.y < 71) return { name: 'stone', boundingBox: 'block' }
        return { name: 'air' }
      }
    }
  }

  const blueprint = { name: 'test', size: new Vec3(1, 1, 1), blocks: [] }
  const builder = new Builder(bot, blueprint, {
    config: { build: { reach: 4.2 }, safety: { minHealth: 6 } }
  })

  const action = {
    pos: new Vec3(25, 71, 17),
    name: 'minecraft:spruce_planks',
    itemName: 'spruce_planks'
  }

  const result = await builder._placeAction(action)
  assert.equal(result, 'done')
  assert.ok(pathsTaken.length >= 1, 'Should have pathfinded away from target')
  assert.equal(placeCalls, 1, 'Should have placed block successfully once stepped away')
  assert.equal(collidesWithBlock(bot, action.pos), false, 'Bot should no longer collide with placed block')
})
