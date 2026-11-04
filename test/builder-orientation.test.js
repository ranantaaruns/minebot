'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const Vec3 = require('vec3')
const mcDataLoader = require('minecraft-data')
const {
  isInteractable,
  orderedReferences,
  isDoor,
  isStairs,
  isDirectionalOpposite,
  FACING_VECTORS,
  DIRECTIONAL_FACING_OPPOSITE
} = require('../src/build/placement')
const { resolveItemName } = require('../src/materials/requirements')
const { Builder } = require('../src/build/builder')

test('isInteractable correctly identifies all interactive blocks including 1.21 crafter', () => {
  assert.equal(isInteractable({ name: 'crafter' }), true)
  assert.equal(isInteractable({ name: 'minecraft:crafter' }), true)
  assert.equal(isInteractable({ name: 'minecraft:chest' }), true)
  assert.equal(isInteractable({ name: 'minecraft:trapped_chest' }), true)
  assert.equal(isInteractable({ name: 'minecraft:oak_trapdoor' }), true)
  assert.equal(isInteractable({ name: 'minecraft:comparator' }), true)
  assert.equal(isInteractable({ name: 'minecraft:repeater' }), true)
  assert.equal(isInteractable({ name: 'minecraft:dispenser' }), true)
  assert.equal(isInteractable({ name: 'minecraft:hopper' }), true)
  assert.equal(isInteractable({ name: 'minecraft:crafting_table' }), true)

  assert.equal(isInteractable({ name: 'stone' }), false)
  assert.equal(isInteractable({ name: 'minecraft:dirt' }), false)
  assert.equal(isInteractable({ name: 'minecraft:smooth_stone' }), false)
})

test('orderedReferences for hopper targets attachment block matching facing or defers', () => {
  const mcData = mcDataLoader('1.21.4')
  const target = new Vec3(2, 1, 7)

  // World where only block below exists (stone at 2, 0, 7)
  const botWithoutEast = {
    blockAt: pos => {
      if (pos.equals(new Vec3(2, 0, 7))) return { name: 'stone', boundingBox: 'block' }
      return { name: 'air' }
    }
  }

  // Hopper wants facing: 'east'. The block to east (3, 1, 7) does not exist yet.
  const actionEast = {
    pos: target,
    name: 'minecraft:hopper',
    properties: { facing: 'east' }
  }

  const refsMissing = orderedReferences(botWithoutEast, target, actionEast, mcData)
  // Must return [] to defer placement instead of wrongly attaching to the floor!
  assert.equal(refsMissing.length, 0)

  // World where dispenser is now placed at (3, 1, 7)
  const botWithEast = {
    blockAt: pos => {
      if (pos.equals(new Vec3(3, 1, 7))) return { name: 'dispenser', boundingBox: 'block' }
      if (pos.equals(new Vec3(2, 0, 7))) return { name: 'stone', boundingBox: 'block' }
      return { name: 'air' }
    }
  }

  const refsFound = orderedReferences(botWithEast, target, actionEast, mcData)
  assert.equal(refsFound.length, 1)
  assert.deepEqual(refsFound[0].offset, new Vec3(1, 0, 0)) // East offset
  assert.deepEqual(refsFound[0].face, new Vec3(-1, 0, 0)) // Click west face of east block
  assert.equal(refsFound[0].interactable, true) // Dispenser is interactable!
})

test('orderedReferences for hopper with facing down only attaches vertically', () => {
  const mcData = mcDataLoader('1.21.4')
  const target = new Vec3(0, 3, 5)

  // World with blocks to the north, south, and below
  const bot = {
    blockAt: pos => {
      if (pos.equals(new Vec3(0, 2, 5))) return { name: 'hopper', boundingBox: 'block' }
      if (pos.equals(new Vec3(0, 3, 6))) return { name: 'stone', boundingBox: 'block' }
      return { name: 'air' }
    }
  }

  const actionDown = {
    pos: target,
    name: 'minecraft:hopper',
    properties: { facing: 'down' }
  }

  const refs = orderedReferences(bot, target, actionDown, mcData)
  assert.equal(refs.length, 1)
  assert.deepEqual(refs[0].offset, new Vec3(0, -1, 0)) // Only block below
})

test('Builder _tryPlaceAt sneaks on interactables and aims opposite for observer', async () => {
  const version = '1.21.4'
  const mcData = mcDataLoader(version)

  let lookedAt = null
  let sneakStates = []
  let placeOptions = null
  let placeCalled = false

  const bot = {
    version,
    game: { gameMode: 'survival' },
    entity: {
      position: new Vec3(7.0, -59.0, 42.0), // Standing north of target (7, -59, 44)
      eyeHeight: 1.62
    },
    physics: { playerHalfWidth: 0.3, playerHeight: 1.8 },
    inventory: {
      items: () => [{ type: mcData.itemsByName.observer.id, name: 'observer', count: 64 }]
    },
    blockAt: pos => {
      // Below (7, -59, 44) is crafter at (7, -60, 44)
      if (pos.equals(new Vec3(7, -60, 44))) return { name: 'crafter', boundingBox: 'block' }
      if (pos.equals(new Vec3(7, -59, 44))) {
        return placeCalled ? { name: 'observer', getProperties: () => ({ facing: 'north' }) } : { name: 'air' }
      }
      return { name: 'air' }
    },
    equip: async () => {},
    setControlState: (control, val) => {
      if (control === 'sneak') sneakStates.push(val)
    },
    getControlState: control => control === 'sneak' && sneakStates[sneakStates.length - 1],
    lookAt: async (pt, force) => {
      lookedAt = pt
    },
    _placeBlockWithOptions: async (block, face, options) => {
      placeCalled = true
      placeOptions = options
    }
  }

  const blueprint = { name: 'farm', size: new Vec3(1, 1, 1), blocks: [] }
  const builder = new Builder(bot, blueprint, {
    config: { build: { reach: 4.2 } }
  })

  const action = {
    pos: new Vec3(7, -59, 44),
    name: 'minecraft:observer',
    itemName: 'observer',
    properties: { facing: 'north' }
  }

  const success = await builder._tryPlaceAt(action)
  assert.equal(success, true)
  assert.equal(placeCalled, true)

  // Bot should have sneaked because reference block is crafter!
  assert.ok(sneakStates.includes(true), 'Bot must sneak when placing on crafter')

  // Bot should look SOUTH (opposite to facing north) so observer faces north!
  assert.ok(lookedAt !== null)
  const eye = bot.entity.position.offset(0, 1.62, 0)
  assert.ok(lookedAt.z > eye.z, 'Bot must look toward +Z (South) for observer facing north')

  // forceLook must be ignore so genericPlace does not overwrite our look direction!
  assert.equal(placeOptions.forceLook, 'ignore')
})

test('orderedReferences for doors attaches strictly to block below with UP face', () => {
  const mcData = mcDataLoader('1.21.4')
  const target = new Vec3(10, 64, 10)

  // World with blocks above, north, and below
  const bot = {
    blockAt: pos => {
      if (pos.equals(new Vec3(10, 63, 10))) return { name: 'stone', boundingBox: 'block' }
      if (pos.equals(new Vec3(10, 64, 9))) return { name: 'stone', boundingBox: 'block' }
      return { name: 'air' }
    }
  }

  const doorAction = {
    pos: target,
    name: 'minecraft:iron_door',
    properties: { facing: 'south', half: 'lower', hinge: 'right' }
  }

  const refs = orderedReferences(bot, target, doorAction, mcData)
  assert.equal(refs.length, 1)
  assert.deepEqual(refs[0].offset, new Vec3(0, -1, 0))
  assert.deepEqual(refs[0].face, new Vec3(0, 1, 0))
})

test('Builder _tryPlaceAt aims in same direction for doors and sets hinge delta', async () => {
  const version = '1.21.4'
  const mcData = mcDataLoader(version)

  let lookedAt = null
  let placeOptions = null
  let placeCalled = false

  const bot = {
    version,
    game: { gameMode: 'survival' },
    entity: {
      position: new Vec3(10.0, 64.0, 8.0),
      eyeHeight: 1.62
    },
    physics: { playerHalfWidth: 0.3, playerHeight: 1.8 },
    inventory: {
      items: () => [{ type: mcData.itemsByName.iron_door.id, name: 'iron_door', count: 1 }]
    },
    blockAt: pos => {
      if (pos.equals(new Vec3(10, 63, 10))) return { name: 'stone', boundingBox: 'block' }
      if (pos.equals(new Vec3(10, 64, 10))) {
        return placeCalled ? { name: 'iron_door', getProperties: () => ({ facing: 'south', hinge: 'right' }) } : { name: 'air' }
      }
      return { name: 'air' }
    },
    equip: async () => {},
    setControlState: () => {},
    getControlState: () => false,
    lookAt: async (pt) => { lookedAt = pt },
    _placeBlockWithOptions: async (block, face, options) => {
      placeCalled = true
      placeOptions = options
    }
  }

  const builder = new Builder(bot, { name: 'door-test', size: new Vec3(1, 1, 1), blocks: [] }, {
    config: { build: { reach: 4.2 } }
  })

  const action = {
    pos: new Vec3(10, 64, 10),
    name: 'minecraft:iron_door',
    itemName: 'iron_door',
    properties: { facing: 'south', half: 'lower', hinge: 'right' }
  }

  const success = await builder._tryPlaceAt(action)
  assert.equal(success, true)
  assert.equal(placeCalled, true)

  // Door facing south: bot must look SOUTH (+Z), same direction as facing!
  const eye = bot.entity.position.offset(0, 1.62, 0)
  assert.ok(lookedAt.z > eye.z, 'Bot must look toward +Z (South) for door facing south')
  assert.equal(placeOptions.forceLook, 'ignore')

  // Hinge right facing south: sideVec is right (-X), delta.x should be < 0.5
  assert.ok(placeOptions.delta)
  assert.ok(placeOptions.delta.x < 0.5, 'Right hinge facing south has delta.x < 0.5')
})

test('Builder _tryPlaceAt aims opposite for stairs and handles top/bottom half', async () => {
  const version = '1.21.4'
  const mcData = mcDataLoader(version)

  let lookedAt = null
  let placeOptions = null
  let placeCalled = false

  const bot = {
    version,
    game: { gameMode: 'survival' },
    entity: {
      position: new Vec3(5.0, 64.0, 3.0),
      eyeHeight: 1.62
    },
    physics: { playerHalfWidth: 0.3, playerHeight: 1.8 },
    inventory: {
      items: () => [{ type: mcData.itemsByName.quartz_stairs.id, name: 'quartz_stairs', count: 16 }]
    },
    blockAt: pos => {
      if (pos.equals(new Vec3(5, 63, 5))) return { name: 'stone', boundingBox: 'block' }
      if (pos.equals(new Vec3(5, 64, 5))) {
        return placeCalled ? { name: 'quartz_stairs', getProperties: () => ({ facing: 'north', half: 'bottom' }) } : { name: 'air' }
      }
      return { name: 'air' }
    },
    equip: async () => {},
    setControlState: () => {},
    getControlState: () => false,
    lookAt: async (pt) => { lookedAt = pt },
    _placeBlockWithOptions: async (block, face, options) => {
      placeCalled = true
      placeOptions = options
    }
  }

  const builder = new Builder(bot, { name: 'stair-test', size: new Vec3(1, 1, 1), blocks: [] }, {
    config: { build: { reach: 4.2 } }
  })

  const action = {
    pos: new Vec3(5, 64, 5),
    name: 'minecraft:quartz_stairs',
    itemName: 'quartz_stairs',
    properties: { facing: 'north', half: 'bottom' }
  }

  const success = await builder._tryPlaceAt(action)
  assert.equal(success, true)
  assert.equal(placeCalled, true)

  // Stairs facing north: bot must look SOUTH (+Z), opposite to facing!
  const eye = bot.entity.position.offset(0, 1.62, 0)
  assert.ok(lookedAt.z > eye.z, 'Bot must look toward +Z (South) for stairs facing north')
  assert.equal(placeOptions.forceLook, 'ignore')
  assert.equal(placeOptions.half, 'bottom')
})

test('fallback block resolution maps wool stairs to wool and fulfills Builder action', async () => {
  const version = '1.21.4'
  const mcData = mcDataLoader(version)

  // 1. resolveItemName fallback mapping
  const woolStairsState = { name: 'minecraft:black_wool_stairs', properties: { facing: 'east', half: 'top' } }
  const resolved = resolveItemName(woolStairsState, mcData)
  assert.equal(resolved.itemName, 'black_wool')
  assert.equal(resolved.fallbackName, 'black_wool')

  // 2. Builder action generation
  const blueprint = {
    name: 'wool-stairs-blueprint',
    size: new Vec3(1, 1, 1),
    blocks: [{ x: 0, y: 0, z: 0, name: 'minecraft:black_wool_stairs', properties: { facing: 'east', half: 'top' } }]
  }

  let placedBlock = null
  const bot = {
    version,
    game: { gameMode: 'survival' },
    entity: {
      position: new Vec3(0, 64, -2),
      floored: () => new Vec3(0, 64, -2),
      clone: () => new Vec3(0, 64, -2),
      eyeHeight: 1.62
    },
    physics: { playerHalfWidth: 0.3, playerHeight: 1.8 },
    inventory: {
      items: () => [{ type: mcData.itemsByName.black_wool.id, name: 'black_wool', count: 1 }]
    },
    blockAt: pos => {
      if (pos.equals(new Vec3(0, 65, 0))) return { name: 'stone', boundingBox: 'block' }
      if (pos.equals(new Vec3(0, 64, 0))) return placedBlock || { name: 'air' }
      return { name: 'air' }
    },
    equip: async () => {},
    setControlState: () => {},
    getControlState: () => false,
    lookAt: async () => {},
    _placeBlockWithOptions: async () => {
      placedBlock = { name: 'black_wool', getProperties: () => ({}) }
    }
  }

  const builder = new Builder(bot, blueprint, {
    origin: new Vec3(0, 64, 0),
    config: { build: { reach: 4.2 } }
  })

  assert.equal(builder.actions.length, 1)
  assert.equal(builder.actions[0].fallbackName, 'black_wool')
  assert.equal(builder.actions[0].itemName, 'black_wool')

  // 3. Try place and check done
  const ok = await builder._tryPlaceAt(builder.actions[0])
  assert.equal(ok, true)
  assert.equal(builder._isDone(builder.actions[0]), true)
})

test('Builder _tryWithScaffold skips scaffolding when in creative mode', async () => {
  const version = '1.21.4'
  let pillared = false

  const bot = {
    version,
    game: { gameMode: 'creative' },
    entity: {
      position: new Vec3(0, 64, 0),
      eyeHeight: 1.62
    },
    blockAt: () => ({ name: 'air' })
  }

  const builder = new Builder(bot, { name: 'test', size: new Vec3(1, 1, 1), blocks: [] }, {
    config: {
      build: {
        scaffold: { enabled: true, blocks: ['dirt'] }
      }
    }
  })

  const action = { pos: new Vec3(0, 75, 0), name: 'minecraft:stone', itemName: 'stone' }
  const result = await builder._tryWithScaffold(action)
  assert.equal(result, false, 'Creative mode must not place scaffold dirt pillars')
  assert.equal(builder.scaffolds.length, 0)
})
