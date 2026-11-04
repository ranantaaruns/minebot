'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const mcData = require('minecraft-data')('1.21.4')
const {
  detectBiomeConflicts,
  applySubstitutions,
  substituteBlockState,
  customAlternative,
  suggestedWoodFamily,
  parseWoodName,
  formatConflict
} = require('../src/materials/biomes')

function requirements (items) {
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

test('detectBiomeConflicts groups a wood family and suggests the local family', () => {
  const req = requirements({ cherry_stairs: 4, cherry_planks: 8, oak_stairs: 2 })
  const groups = detectBiomeConflicts(req, 'savanna', mcData)

  assert.equal(groups.length, 1)
  assert.equal(groups[0].key, 'wood:cherry')
  assert.equal(groups[0].kind, 'wood')
  assert.equal(formatConflict(groups[0]), 'cherry_stairs x4, cherry_planks x8')
  assert.equal(groups[0].alternative.family, 'acacia')
  assert.equal(groups[0].alternative.items.get('cherry_stairs'), 'acacia_stairs')
  assert.equal(groups[0].alternative.items.get('cherry_planks'), 'acacia_planks')
})

test('detectBiomeConflicts leaves matching biome materials alone', () => {
  const req = requirements({ cherry_stairs: 4, cherry_planks: 8 })
  assert.deepEqual(detectBiomeConflicts(req, 'cherry_grove', mcData), [])
  assert.equal(suggestedWoodFamily('cherry_grove'), 'cherry')
  assert.equal(suggestedWoodFamily('unknown_biome'), 'oak')
})

test('detectBiomeConflicts offers a special block alternative', () => {
  const req = requirements({ red_sand: 12, terracotta: 5 })
  const groups = detectBiomeConflicts(req, 'desert', mcData)

  assert.equal(groups.length, 2)
  const group = groups.find(entry => entry.family === 'red_sand')
  assert.equal(group.alternative.family, 'sand')
  assert.equal(group.alternative.items.get('red_sand'), 'sand')
})

test('customAlternative validates flexible wood and special selections', () => {
  const req = requirements({ cherry_stairs: 4 })
  const [group] = detectBiomeConflicts(req, 'savanna', mcData)

  const wood = customAlternative('birch', group, mcData)
  assert.equal(wood.family, 'birch')
  assert.equal(wood.items.get('cherry_stairs'), 'birch_stairs')

  const specialGroup = detectBiomeConflicts(requirements({ red_sand: 1 }), 'desert', mcData)[0]
  const special = customAlternative('gravel', specialGroup, mcData)
  assert.equal(special.family, 'gravel')
  assert.equal(special.items.get('red_sand'), 'gravel')
  assert.equal(customAlternative('not_a_block', specialGroup, mcData), null)
})

test('applySubstitutions merges counts and keeps requirement metadata', () => {
  const req = requirements({ cherry_planks: 6, oak_planks: 2 })
  const effective = applySubstitutions(req, new Map([['cherry_planks', 'acacia_planks']]), mcData)

  assert.equal(effective.items.get('acacia_planks').count, 6)
  assert.equal(effective.items.get('oak_planks').count, 2)
  assert.equal(effective.itemCount, 2)
  assert.equal(effective.skipped, req.skipped)
})

test('parseWoodName and substituteBlockState handle namespaced states', () => {
  assert.deepEqual(parseWoodName('minecraft:stripped_cherry_log'), {
    family: 'cherry',
    suffix: 'log',
    stripped: true
  })

  const state = substituteBlockState(
    'minecraft:cherry_stairs',
    { facing: 'east', half: 'bottom' },
    new Map([['cherry_stairs', 'acacia_stairs']]),
    mcData
  )
  assert.equal(state.name, 'minecraft:acacia_stairs')
  assert.deepEqual(state.properties, { facing: 'east', half: 'bottom' })
  assert.equal(
    substituteBlockState('minecraft:cherry_stairs', {}, new Map([['cherry_stairs', 'missing_block']]), mcData),
    null
  )
})
