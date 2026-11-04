'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const os = require('os')
const path = require('path')
const nbt = require('prismarine-nbt')
const { Schematic } = require('prismarine-schematic')
const mcDataLoader = require('minecraft-data')

const { parseLitematic, decodePackedLongs, bitsForPalette } = require('../src/blueprint/litematic')
const { parseSchematic } = require('../src/blueprint/schematic')
const { parseStructure } = require('../src/blueprint/structure')
const { loadBlueprint, normalizeBlueprint, stateKey } = require('../src/blueprint')
const { computeRequirements, resolveItemName } = require('../src/materials/requirements')

function packValues (values, bits) {
  const longs = []
  let current = 0n
  let used = 0
  for (const value of values) {
    current |= BigInt(value) << BigInt(used)
    used += bits
    while (used >= 64) {
      longs.push(BigInt.asUintN(64, current))
      current >>= 64n
      used -= 64
    }
  }
  if (used > 0) longs.push(BigInt.asUintN(64, current))
  return longs
}

function litematicBuffer ({ palette, values, size, position = { x: 0, y: 0, z: 0 }, name = 'test' }) {
  const bits = bitsForPalette(palette.length)
  const longs = packValues(values, bits)
  const data = nbt.comp({
    Version: nbt.int(6),
    MinecraftDataVersion: nbt.int(3953),
    Metadata: nbt.comp({
      Name: nbt.string(name),
      Author: nbt.string('tester')
    }),
    Regions: nbt.comp({
      Main: nbt.comp({
        Position: nbt.comp({
          x: nbt.int(position.x),
          y: nbt.int(position.y),
          z: nbt.int(position.z)
        }),
        Size: nbt.comp({
          x: nbt.int(size.x),
          y: nbt.int(size.y),
          z: nbt.int(size.z)
        }),
        BlockStatePalette: nbt.list(nbt.comp(palette)),
        BlockStates: nbt.longArray(longs)
      })
    })
  })
  return nbt.writeUncompressed(data, 'big')
}

test('decodePackedLongs handles values crossing 64-bit boundaries', () => {
  const bits = 5
  const values = Array.from({ length: 40 }, (_, i) => (i * 7) % 32)
  const longs = packValues(values, bits)
  assert.deepEqual(decodePackedLongs(longs, bits, values.length), values)
})

test('parseLitematic reads palette, properties and skips air', async () => {
  const palette = [
    { Name: nbt.string('minecraft:air') },
    { Name: nbt.string('minecraft:stone') },
    {
      Name: nbt.string('minecraft:oak_stairs'),
      Properties: nbt.comp({ facing: nbt.string('east') })
    },
    { Name: nbt.string('minecraft:water') }
  ]
  const buffer = litematicBuffer({
    palette,
    values: [1, 2, 3],
    size: { x: 3, y: 1, z: 1 },
    position: { x: -5, y: 10, z: 2 },
    name: 'rumah'
  })

  const parsed = await parseLitematic(buffer, { maxVolume: 100 })
  assert.equal(parsed.name, 'rumah')
  assert.equal(parsed.author, 'tester')
  assert.equal(parsed.blocks.length, 3)
  assert.deepEqual(parsed.blocks[0], {
    x: -5,
    y: 10,
    z: 2,
    name: 'minecraft:stone',
    properties: {}
  })
  assert.equal(parsed.blocks[1].name, 'minecraft:oak_stairs')
  assert.equal(parsed.blocks[1].properties.facing, 'east')
  assert.equal(parsed.blocks[2].name, 'minecraft:water')
})

test('parseLitematic handles negative region sizes', async () => {
  const buffer = litematicBuffer({
    palette: [{ Name: nbt.string('minecraft:air') }, { Name: nbt.string('minecraft:stone') }],
    values: [1, 1],
    size: { x: -2, y: 1, z: 1 },
    position: { x: 10, y: 0, z: 0 }
  })

  const parsed = await parseLitematic(buffer, { maxVolume: 100 })
  assert.equal(parsed.blocks.length, 2)
  assert.equal(parsed.blocks[0].x, 9)
  assert.equal(parsed.blocks[1].x, 10)
})

test('parseSchematic reads a written .schem buffer', async () => {
  const schematic = Schematic.fromJSON(JSON.stringify({
    version: '1.21.4',
    size: { x: 2, y: 1, z: 1 },
    offset: { x: 0, y: 0, z: 0 },
    palette: [0, 1],
    blocks: [0, 1]
  }))
  const buffer = await schematic.write()
  const parsed = await parseSchematic(buffer, { version: '1.21.4' })

  assert.equal(parsed.blocks.length, 1)
  assert.equal(parsed.blocks[0].name, 'minecraft:stone')
  assert.equal(parsed.blocks[0].x, 1)
})

test('loadBlueprint normalizes coordinates and computes volume', async () => {
  const palette = [{ Name: nbt.string('minecraft:air') }, { Name: nbt.string('minecraft:stone') }]
  const values = new Array(8).fill(1)
  const buffer = litematicBuffer({
    palette,
    values,
    size: { x: 2, y: 2, z: 2 },
    position: { x: 100, y: 64, z: -50 },
    name: 'kubus'
  })

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-'))
  const file = path.join(dir, 'kubus.litematic')
  fs.writeFileSync(file, buffer)

  const blueprint = await loadBlueprint(file, { maxVolume: 100 })
  assert.equal(blueprint.name, 'kubus')
  assert.equal(blueprint.format, 'litematic')
  assert.deepEqual(blueprint.size, { x: 2, y: 2, z: 2 })
  assert.equal(blueprint.volume, 8)
  assert.equal(blueprint.blocks.length, 8)
  assert.equal(Math.min(...blueprint.blocks.map(block => block.x)), 0)
  assert.equal(Math.min(...blueprint.blocks.map(block => block.z)), 0)

  fs.rmSync(dir, { recursive: true, force: true })
})

test('loadBlueprint menerapkan rotate dan mirror pada blok', async () => {
  const palette = [{ Name: nbt.string('minecraft:air') }, { Name: nbt.string('minecraft:stone') }]
  const buffer = litematicBuffer({
    palette,
    values: [1, 1],
    size: { x: 2, y: 1, z: 1 },
    position: { x: 0, y: 0, z: 0 }
  })

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-'))
  const file = path.join(dir, 'baris.litematic')
  fs.writeFileSync(file, buffer)

  const plain = await loadBlueprint(file, { maxVolume: 100 })
  assert.deepEqual(plain.size, { x: 2, y: 1, z: 1 })
  assert.equal(plain.transform, undefined)

  const rotated = await loadBlueprint(file, { maxVolume: 100, rotate: 90 })
  assert.deepEqual(rotated.size, { x: 1, y: 1, z: 2 })
  assert.equal(rotated.blocks.length, 2)
  assert.deepEqual(rotated.transform, { rotate: 90, mirror: null })

  const mirrored = await loadBlueprint(file, { maxVolume: 100, mirror: 'x' })
  assert.deepEqual(mirrored.size, { x: 2, y: 1, z: 1 })
  assert.deepEqual(mirrored.transform, { rotate: 0, mirror: 'x' })

  fs.rmSync(dir, { recursive: true, force: true })
})

function structureBuffer ({ palette, blocks, size = { x: 2, y: 1, z: 1 }, dataVersion = 3953 }) {
  const data = nbt.comp({
    DataVersion: nbt.int(dataVersion),
    size: nbt.list(nbt.int([size.x, size.y, size.z])),
    palette: nbt.list(nbt.comp(palette.map(entry => ({ ...entry })))),
    blocks: nbt.list(nbt.comp(blocks.map(block => ({
      pos: nbt.list(nbt.int([...block.pos])),
      state: nbt.int(block.state)
    }))))
  })
  return nbt.writeUncompressed(data, 'big')
}

test('parseStructure reads palette, properties and skips air', async () => {
  const buffer = structureBuffer({
    palette: [
      { Name: nbt.string('minecraft:air') },
      { Name: nbt.string('minecraft:stone') },
      {
        Name: nbt.string('minecraft:oak_stairs'),
        Properties: nbt.comp({ facing: nbt.string('east') })
      }
    ],
    blocks: [
      { pos: [0, 0, 0], state: 1 },
      { pos: [1, 0, 1], state: 2 },
      { pos: [1, 0, 0], state: 0 }
    ],
    size: { x: 2, y: 1, z: 2 }
  })

  const parsed = await parseStructure(buffer, { maxVolume: 100, name: 'gudang.nbt' })
  assert.equal(parsed.format, 'structure')
  assert.equal(parsed.blocks.length, 2)
  assert.equal(parsed.blocks[0].name, 'minecraft:stone')
  assert.equal(parsed.blocks[0].x, 0)
  assert.equal(parsed.blocks[1].name, 'minecraft:oak_stairs')
  assert.equal(parsed.blocks[1].properties.facing, 'east')
  assert.equal(parsed.blocks[1].z, 1)
})

test('parseStructure rejects files without palette or blocks', async () => {
  const empty = nbt.writeUncompressed(nbt.comp({ DataVersion: nbt.int(3953) }), 'big')
  await assert.rejects(() => parseStructure(empty), /bukan struktur/)
})

test('loadBlueprint membaca file .nbt berformat structure block', async () => {
  const buffer = structureBuffer({
    palette: [{ Name: nbt.string('minecraft:stone') }],
    blocks: [
      { pos: [0, 0, 0], state: 0 },
      { pos: [1, 0, 0], state: 0 }
    ]
  })

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-'))
  const file = path.join(dir, 'gudang.nbt')
  fs.writeFileSync(file, buffer)

  const blueprint = await loadBlueprint(file, { maxVolume: 100, rotate: 90 })
  assert.equal(blueprint.format, 'structure')
  assert.equal(blueprint.blocks.length, 2)
  assert.deepEqual(blueprint.size, { x: 1, y: 1, z: 2 })

  fs.rmSync(dir, { recursive: true, force: true })
})

test('normalizeBlueprint rejects empty structures and strips duplicates', () => {
  assert.throws(() => normalizeBlueprint({ blocks: [], name: 'x' }, 'x.litematic'), /tidak memiliki blok/)

  const blueprint = normalizeBlueprint({
    name: 'x',
    format: 'test',
    blocks: [
      { x: 1, y: 1, z: 1, name: 'minecraft:stone', properties: {} },
      { x: 1, y: 1, z: 1, name: 'minecraft:dirt', properties: {} }
    ]
  }, 'x.litematic')

  assert.equal(blueprint.blocks.length, 1)
  assert.equal(blueprint.blocks[0].name, 'minecraft:dirt')
})

test('computeRequirements separates items, unsupported and auto-skipped states', () => {
  const blueprints = {
    blocks: [],
    states: [
      { name: 'minecraft:stone', properties: {}, count: 2 },
      { name: 'minecraft:water', properties: {}, count: 1 },
      { name: 'minecraft:oak_door', properties: { half: 'lower' }, count: 1 },
      { name: 'minecraft:oak_door', properties: { half: 'upper' }, count: 1 },
      { name: 'minecraft:wall_torch', properties: { facing: 'north' }, count: 1 },
      { name: 'minecraft:redstone_wire', properties: {}, count: 1 }
    ]
  }
  const mcData = mcDataLoader('1.21.4')
  const requirements = computeRequirements(blueprints, mcData)

  assert.equal(requirements.items.get('stone').count, 2)
  assert.equal(requirements.items.get('oak_door').count, 1)
  assert.equal(requirements.items.get('torch').count, 1)
  assert.equal(requirements.items.get('redstone').count, 1)
  assert.equal(requirements.unsupported.get('minecraft:water').count, 1)
  assert.equal(requirements.skipped.get(stateKey('minecraft:oak_door', { half: 'upper' })).count, 1)
  assert.equal(requirements.totalBlocks, 5)
})

test('resolveItemName maps special block states to obtainable items', () => {
  const mcData = mcDataLoader('1.21.4')
  assert.equal(resolveItemName({ name: 'minecraft:farmland', properties: {} }, mcData).itemName, null)
  assert.equal(resolveItemName({ name: 'minecraft:redstone_wire', properties: {} }, mcData).itemName, 'redstone')
  assert.equal(resolveItemName({ name: 'minecraft:oak_wall_sign', properties: {} }, mcData).itemName, 'oak_sign')
  assert.equal(resolveItemName({ name: 'minecraft:bedrock', properties: {} }, mcData).itemName, null)
})
