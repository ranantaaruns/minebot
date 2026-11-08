'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const Vec3 = require('vec3')
const mcData = require('minecraft-data')('1.21.4')
const {
  expandContainerNames,
  containerBlockIds,
  isContainerBlock,
  findContainerPositions,
  clearAbove,
  openContainerAt
} = require('../src/containers')

const silentLogger = {
  info () {},
  warn () {},
  debug () {},
  error () {}
}

function key (pos) {
  return `${pos.x},${pos.y},${pos.z}`
}

function fakeWorld (blocks, entityPosition = new Vec3(0, 64, 0)) {
  const world = new Map(blocks.map(block => [key(block.position), block]))
  return {
    version: '1.21.4',
    entity: { position: entityPosition },
    blockAt (pos) {
      return world.get(key(pos)) || { name: 'air', boundingBox: 'empty', position: pos.clone() }
    },
    async dig (block) {
      world.delete(key(block.position))
    },
    findBlocks () {
      return []
    },
    async openContainer (block) {
      return { block }
    }
  }
}

test('container helpers include every shulker variant', () => {
  const names = expandContainerNames(mcData, ['shulker_box'])
  assert.ok(names.includes('shulker_box'))
  assert.ok(names.length > 1)
  assert.ok(names.every(name => !name.startsWith('minecraft:')))
  assert.ok(containerBlockIds(mcData, ['chest']).length > 0)
  assert.equal(isContainerBlock({ name: 'light_blue_shulker_box' }, ['shulker_box']), true)
  assert.equal(isContainerBlock({ name: 'stone' }, ['shulker_box']), false)
})

test('findContainerPositions sorts by distance and protects the build origin', () => {
  const bot = fakeWorld([], new Vec3(0, 64, 0))
  bot.findBlocks = () => [new Vec3(10, 64, 0), new Vec3(1, 64, 0), new Vec3(2, 64, 0)]

  const found = findContainerPositions(bot, mcData, 32, {
    origin: new Vec3(1, 64, 0),
    protectRadius: 1
  })

  assert.deepEqual(found.map(row => [row.pos.x, row.pos.z]), [[10, 0]])
})

test('clearAbove digs all diggable blocks directly above a container', async () => {
  const chest = { name: 'chest', position: new Vec3(1, 64, 0), diggable: true }
  const dirt = { name: 'dirt', position: new Vec3(1, 65, 0), diggable: true }
  const stone = { name: 'stone', position: new Vec3(1, 66, 0), diggable: true }
  const bot = fakeWorld([chest, dirt, stone])

  const cleared = await clearAbove(bot, chest.position, {
    maxHeight: 3,
    logger: silentLogger
  })

  assert.equal(cleared, 2)
  assert.equal(bot.blockAt(dirt.position).name, 'air')
  assert.equal(bot.blockAt(stone.position).name, 'air')
})

test('openContainerAt clears the obstruction before opening', async () => {
  const chest = { name: 'chest', position: new Vec3(1, 64, 0), diggable: true }
  const dirt = { name: 'dirt', position: new Vec3(1, 65, 0), diggable: true }
  const bot = fakeWorld([chest, dirt])

  const window = await openContainerAt(bot, chest.position, {
    clearObstructions: true,
    clearHeight: 1,
    logger: silentLogger
  })

  assert.equal(window.block, chest)
  assert.equal(bot.blockAt(dirt.position).name, 'air')
})

test('clearAbove tidak pernah menggali chest lain di atas chest', async () => {
  const lower = { name: 'chest', position: new Vec3(1, 64, 0), diggable: true }
  const upper = { name: 'chest', position: new Vec3(1, 65, 0), diggable: true }
  const barrel = { name: 'barrel', position: new Vec3(1, 66, 0), diggable: true }
  const bot = fakeWorld([lower, upper, barrel])
  let digs = 0
  const original = bot.dig
  bot.dig = async block => { digs++; await original(block) }

  const cleared = await clearAbove(bot, lower.position, { maxHeight: 3, logger: silentLogger })

  assert.equal(cleared, 0, 'kontainer bukan penghalang yang boleh dihancurkan')
  assert.equal(digs, 0)
  assert.equal(bot.blockAt(upper.position).name, 'chest')
  assert.equal(bot.blockAt(barrel.position).name, 'barrel')
})

test('clearAbove tidak menggali blok bernilai seperti crafting table atau bed', async () => {
  const chest = { name: 'chest', position: new Vec3(1, 64, 0), diggable: true }
  const table = { name: 'crafting_table', position: new Vec3(1, 65, 0), diggable: true }
  const bot = fakeWorld([chest, table])
  const cleared = await clearAbove(bot, chest.position, { maxHeight: 2, logger: silentLogger })
  assert.equal(cleared, 0)
  assert.equal(bot.blockAt(table.position).name, 'crafting_table')
})
