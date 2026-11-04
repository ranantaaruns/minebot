'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const Vec3 = require('vec3')
const mcDataLoader = require('minecraft-data')
const { Builder } = require('../src/build/builder')

function createMockBot (mode = 'creative') {
  const version = '1.21.4'
  const mcData = mcDataLoader(version)
  const slots = {}
  const items = []

  const bot = {
    version,
    game: { gameMode: mode },
    health: 2,
    food: 2,
    entity: { position: new Vec3(0, 64, 0) },
    inventory: {
      slots,
      items: () => items,
      findInventoryItem: (id) => items.find(i => i.type === id) || null
    },
    creativeSlotsSet: [],
    creative: {
      async setInventorySlot (slot, item) {
        bot.creativeSlotsSet.push({ slot, item })
        slots[slot] = item
        items.push({
          type: item.type || item.id,
          name: mcData.items[item.type || item.id]?.name,
          count: item.count
        })
      }
    },
    blockAt: () => ({ name: 'air' }),
    digCalls: 0,
    async dig (block) {
      bot.digCalls++
    }
  }

  return { bot, mcData }
}

test('Builder isCreative is true when bot gamemode is creative', () => {
  const { bot } = createMockBot('creative')
  const blueprint = { name: 'test', size: new Vec3(1, 1, 1), blocks: [] }
  const builder = new Builder(bot, blueprint, {
    config: { build: { reach: 4.2 }, safety: { minHealth: 6 } }
  })

  assert.equal(builder.isCreative, true)
  // Should not throw even with health = 2
  assert.doesNotThrow(() => builder._assertSafe())
})

test('Builder _ensureCreativeItem spawns item into slot using bot.creative', async () => {
  const { bot, mcData } = createMockBot('creative')
  const blueprint = { name: 'test', size: new Vec3(1, 1, 1), blocks: [] }
  const builder = new Builder(bot, blueprint, {
    config: { build: { reach: 4.2 }, safety: { minHealth: 6 } }
  })

  const item = await builder._ensureCreativeItem('cobblestone')
  assert.ok(item)
  assert.equal(item.name, 'cobblestone')
  assert.equal(bot.creativeSlotsSet.length, 1)
  assert.equal(bot.creativeSlotsSet[0].slot, 36)
  assert.equal(bot.creativeSlotsSet[0].item.type, mcData.itemsByName.cobblestone.id)
})

test('Builder _clearTarget digs instantly without tool equipping in creative mode', async () => {
  const { bot } = createMockBot('creative')
  let blockState = { name: 'dirt', position: new Vec3(0, 64, 1), diggable: true }
  bot.blockAt = (pos) => {
    if (pos.equals(new Vec3(0, 64, 1))) return blockState
    return { name: 'air' }
  }
  bot.dig = async () => {
    bot.digCalls++
    blockState = { name: 'air' }
  }

  const blueprint = { name: 'test', size: new Vec3(1, 1, 1), blocks: [] }
  const builder = new Builder(bot, blueprint, {
    config: { build: { reach: 4.2 }, safety: { minHealth: 6 } }
  })

  const cleared = await builder._clearTarget({
    pos: new Vec3(0, 64, 1),
    name: 'stone',
    itemName: 'stone'
  })

  assert.equal(cleared, true)
  assert.equal(bot.digCalls, 1)
})
