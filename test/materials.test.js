'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const mcData = require('minecraft-data')('1.21.4')
const Recipe = require('prismarine-recipe')(mcData).Recipe
const { buildStatic } = require('mineflayer-crafting-util')
const { MaterialManager } = require('../src/materials/resolve')

const silentLogger = {
  info () {},
  warn () {},
  debug () {},
  error () {}
}

function mockBot (items) {
  return {
    version: '1.21.4',
    inventory: {
      items: () => items.map(([name, count]) => ({
        type: mcData.itemsByName[name].id,
        count
      }))
    },
    findBlocks: () => []
  }
}

test('craft planning uses the available wood type and additive base items', async () => {
  const planCraft = await buildStatic(Recipe)
  const bot = mockBot([['oak_log', 3]])
  bot.planCraft = planCraft

  const materials = new MaterialManager(bot, {
    gather: { mineRadius: 64 },
    safety: { minHealth: 6 }
  }, silentLogger)

  const { plan, baseItems, additive } = materials._planCraftFor('wooden_pickaxe', 1)
  assert.equal(plan.status, 'complete')
  assert.equal(additive, true)
  assert.equal(baseItems.length, 0)
  assert.ok(plan.recipesToDo.some(step => mcData.items[step.recipe.result.id]?.name === 'wooden_pickaxe'))
  assert.ok(plan.recipesToDo.every(step => mcData.items[step.recipe.result.id]?.name !== 'pale_oak_planks'))
})

test('craft planning requests synthetic wood when inventory has none', async () => {
  const planCraft = await buildStatic(Recipe)
  const bot = mockBot([])
  bot.planCraft = planCraft

  const materials = new MaterialManager(bot, {
    gather: { mineRadius: 64 },
    safety: { minHealth: 6 }
  }, silentLogger)

  const { plan, baseItems, additive } = materials._planCraftFor('stick', 4)
  assert.equal(plan.status, 'complete')
  assert.equal(additive, true)
  assert.ok(baseItems.some(item => mcData.items[item.id]?.name === 'oak_log'))
  assert.ok(plan.recipesToDo.some(step => mcData.items[step.recipe.result.id]?.name === 'stick'))
})
