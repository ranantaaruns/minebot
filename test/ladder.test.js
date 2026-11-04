'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('events')
const Vec3 = require('vec3')
const mcDataLoader = require('minecraft-data')
const Block = require('prismarine-block')('1.21.1')
const { Movements, goals } = require('mineflayer-pathfinder')
const AStar = require('mineflayer-pathfinder/lib/astar')
const Move = require('mineflayer-pathfinder/lib/move')

const {
  LadderNavigator,
  isClimbable,
  getWallVector,
  CLIMBABLE_NAMES
} = require('../src/navigation/ladder')
const { enhanceLadderMovements } = require('../src/movements')
const { OwnerTracker } = require('../src/owner')

const silentLogger = {
  info () {},
  warn () {},
  debug () {},
  error () {}
}

function fakeBot (options = {}) {
  const bot = new EventEmitter()
  bot.version = '1.21.1'
  bot.registry = mcDataLoader('1.21.1')
  bot.game = { minY: -64, dimension: 'overworld' }
  bot.entity = {
    position: options.position ? options.position.clone() : new Vec3(0, 64, 0),
    onGround: options.onGround ?? true,
    effects: {}
  }
  bot.controls = new Map()
  bot.setControlState = (name, val) => bot.controls.set(name, val)
  bot.clearControlStates = () => bot.controls.clear()
  bot.lookAt = async () => {}
  bot.activateBlock = options.activateBlock || (async () => {})
  bot.findBlocks = options.findBlocks || (() => [])
  bot.blockAt = options.blockAt || (() => {
    const air = Block.fromProperties('air', {}, 0)
    air.position = new Vec3(0, 0, 0)
    return air
  })
  bot.inventory = { items: () => [] }
  bot.pathfinder = {
    goal: null,
    setGoal (g) { this.goal = g },
    stop () {},
    bestHarvestTool: () => null
  }
  return bot
}

test('isClimbable recognizes ladder, vine, and scaffolding', () => {
  assert.equal(isClimbable({ name: 'ladder' }), true)
  assert.equal(isClimbable({ name: 'minecraft:ladder' }), true)
  assert.equal(isClimbable({ name: 'vine' }), true)
  assert.equal(isClimbable({ name: 'scaffolding' }), true)
  assert.equal(isClimbable({ name: 'twisting_vines' }), true)
  assert.equal(isClimbable({ name: 'cave_vines' }), true)
  assert.equal(isClimbable({ name: 'stone' }), false)
  assert.equal(isClimbable(null), false)
})

test('getWallVector resolves orientation facing', () => {
  assert.deepEqual(getWallVector({ properties: { facing: 'north' } }), new Vec3(0, 0, -1))
  assert.deepEqual(getWallVector({ properties: { facing: 'south' } }), new Vec3(0, 0, 1))
  assert.deepEqual(getWallVector({ properties: { facing: 'west' } }), new Vec3(-1, 0, 0))
  assert.deepEqual(getWallVector({ properties: { facing: 'east' } }), new Vec3(1, 0, 0))
  assert.deepEqual(getWallVector(null), new Vec3(0, 0, -1))
})

test('enhanceLadderMovements registers climbables and patches physical flag', () => {
  const bot = fakeBot()
  const movements = new Movements(bot)
  enhanceLadderMovements(movements, bot)

  const ladderId = bot.registry.blocksByName.ladder.id
  assert.equal(movements.climbables.has(ladderId), true)
  assert.equal(movements.canOpenDoors, true)

  const ladderBlock = Block.fromProperties('ladder', { facing: 'north' }, 0)
  ladderBlock.position = new Vec3(0, 60, 0)
  bot.blockAt = (p) => {
    if (p.x === 0 && p.y === 60 && p.z === 0) return ladderBlock
    const air = Block.fromProperties('air', {}, 0)
    air.position = p.clone()
    return air
  }

  const b = movements.getBlock(new Vec3(0, 60, 0), 0, 0, 0)
  assert.equal(b.climbable, true)
  assert.equal(b.physical, false, 'Climbable block should not be physical obstacle')
  assert.equal(b.safe, true, 'Climbable block should be marked safe')
})

test('AStar pathfinding traverses a 15-block ladder shaft down and up with zero scaffolding blocks', () => {
  const mcData = mcDataLoader('1.21.1')
  const world = new Map()

  function setBlock (x, y, z, name, props = {}) {
    const b = Block.fromProperties(name, props, 0)
    b.position = new Vec3(x, y, z)
    world.set(`${x},${y},${z}`, b)
  }

  // Surface at y=64
  setBlock(0, 63, 0, 'stone')
  setBlock(0, 64, 0, 'air')
  setBlock(0, 65, 0, 'air')

  // Ladder shaft at z=1 from y=50 to y=63
  for (let y = 50; y <= 64; y++) {
    setBlock(0, y, 2, 'stone')
    setBlock(0, y, 0, y <= 63 ? 'stone' : 'air')
    setBlock(-1, y, 1, 'stone')
    setBlock(1, y, 1, y === 50 ? 'air' : 'stone') // doorway at y=50
    if (y <= 63) {
      setBlock(0, y, 1, 'ladder', { facing: 'north' })
    } else {
      setBlock(0, y, 1, 'air')
    }
  }

  // Underground room at y=50
  setBlock(0, 49, 1, 'stone')
  setBlock(1, 49, 1, 'stone')
  setBlock(1, 50, 1, 'air')
  setBlock(1, 51, 1, 'air')
  setBlock(2, 49, 1, 'stone')
  setBlock(2, 50, 1, 'air')
  setBlock(2, 51, 1, 'air')

  const bot = fakeBot()
  bot.blockAt = (p) => {
    const key = `${p.x},${p.y},${p.z}`
    if (world.has(key)) return world.get(key)
    const air = Block.fromProperties('air', {}, 0)
    air.position = p.clone()
    return air
  }

  const movements = new Movements(bot)
  enhanceLadderMovements(movements, bot)

  // Test DOWN: from surface (0, 64, 0) down the shaft to room (2, 50, 1)
  const startDown = new Move(0, 64, 0, 0, 0)
  const goalDown = new goals.GoalBlock(2, 50, 1)
  const astarDown = new AStar(startDown, movements, goalDown, 5000, 40, -1)
  const resDown = astarDown.compute()
  assert.equal(resDown.status, 'success')
  assert.ok(resDown.path.length >= 15)
  for (const move of resDown.path) {
    assert.equal(move.toPlace.length, 0, 'Should not require any blocks placed when descending ladder shaft')
  }

  // Test UP: from room (2, 50, 1) up the shaft to surface (0, 64, 0)
  const startUp = new Move(2, 50, 1, 0, 0)
  const goalUp = new goals.GoalBlock(0, 64, 0)
  const astarUp = new AStar(startUp, movements, goalUp, 5000, 40, -1)
  const resUp = astarUp.compute()
  assert.equal(resUp.status, 'success')
  assert.ok(resUp.path.length >= 15)
  for (const move of resUp.path) {
    assert.equal(move.toPlace.length, 0, 'Should not require any blocks placed when ascending ladder shaft')
  }
})

test('LadderNavigator controls: sets jump:true when climbing up and jump:false when climbing down', () => {
  const ladderBlock = Block.fromProperties('ladder', { facing: 'north' }, 0)
  ladderBlock.position = new Vec3(0, 55, 0)

  const bot = fakeBot({
    position: new Vec3(0.5, 55, 0.5),
    onGround: false,
    blockAt: (p) => {
      if (p.x === 0 && p.y === 55 && p.z === 0) return ladderBlock
      const air = Block.fromProperties('air', {}, 0)
      air.position = p.clone()
      return air
    }
  })

  let targetPoint = new Vec3(0.5, 64, 0.5)
  const navigator = new LadderNavigator(bot, {}, silentLogger, {
    getTarget: () => targetPoint
  })

  assert.equal(navigator.isOnLadder(), true)

  // Tick when target is ABOVE (diffY = 9 > 0.3)
  bot.emit('physicsTick')
  assert.equal(navigator.climbing, true)
  assert.equal(navigator.busy, true)
  assert.equal(bot.controls.get('jump'), true)
  assert.equal(bot.controls.get('forward'), true)

  // Tick when target is BELOW (diffY = -15 < -0.5)
  targetPoint = new Vec3(0.5, 40, 0.5)
  bot.emit('physicsTick')
  assert.equal(navigator.climbing, true)
  assert.equal(bot.controls.get('jump'), false)
  assert.equal(bot.controls.get('forward'), false)

  navigator.destroy()
})

test('LadderNavigator auto-opens closed trapdoors directly above ladder', async () => {
  let activated = false
  const ladderBlock = Block.fromProperties('ladder', { facing: 'north' }, 0)
  ladderBlock.position = new Vec3(0, 60, 0)

  const trapdoorBlock = Block.fromProperties('oak_trapdoor', { facing: 'north', open: false, half: 'bottom' }, 0)
  trapdoorBlock.position = new Vec3(0, 61, 0)

  const bot = fakeBot({
    position: new Vec3(0.5, 60, 0.5),
    onGround: false,
    activateBlock: async (b) => {
      if (b.position.y === 61) activated = true
    },
    blockAt: (p) => {
      if (p.x === 0 && p.y === 60 && p.z === 0) return ladderBlock
      if (p.x === 0 && p.y === 61 && p.z === 0) return trapdoorBlock
      const air = Block.fromProperties('air', {}, 0)
      air.position = p.clone()
      return air
    }
  })

  const navigator = new LadderNavigator(bot, {}, silentLogger, {
    getTarget: () => new Vec3(0.5, 64, 0.5)
  })

  bot.emit('physicsTick')
  // Allow async activateBlock to resolve
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.equal(activated, true, 'Should have activated closed trapdoor above ladder')

  navigator.destroy()
})

test('OwnerTracker aborts tower supply when ladder is nearby or bot is on ladder', async () => {
  const bot = fakeBot({
    position: new Vec3(0, 50, 0)
  })

  let towerCalled = false
  const fakeTowerSupply = {
    ensure: async () => {
      towerCalled = true
      return { ok: true, gathered: 5 }
    }
  }

  const ladderBlock = Block.fromProperties('ladder', { facing: 'north' }, 0)
  ladderBlock.position = new Vec3(0, 50, 1)

  const fakeLadder = {
    busy: false,
    climbing: false,
    isOnLadder: () => true,
    isLadderNearby: () => true
  }

  const tracker = new OwnerTracker(bot, {
    username: 'Owner',
    allowTower: true,
    towerGather: { enabled: true, minGap: 2 }
  }, silentLogger, {
    towerSupply: fakeTowerSupply,
    ladderNavigator: fakeLadder
  })

  // Set target higher (gap = 14 > 2)
  tracker.setTarget(new Vec3(0, 64, 0))

  await tracker._handleNoPath()
  assert.equal(towerCalled, false, 'Tower supply should not be called when on ladder')

  // Test when ladder is nearby but not directly standing on it
  fakeLadder.isOnLadder = () => false
  fakeLadder.isLadderNearby = () => true

  await tracker._handleNoPath()
  assert.equal(towerCalled, false, 'Tower supply should not be called when ladder is nearby')

  tracker.stop()
})
