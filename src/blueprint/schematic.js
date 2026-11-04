'use strict'

const { Schematic } = require('prismarine-schematic')

const AIR = new Set(['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air'])

function normalizeName (name) {
  if (!name) return ''
  return name.startsWith('minecraft:') ? name : `minecraft:${name}`
}

async function parseSchematic (buffer, options = {}) {
  const schematic = await Schematic.read(buffer, options.version || null)
  const blocks = []

  await schematic.forEach((block, pos) => {
    if (!block) return
    const name = normalizeName(block.name)
    if (!name || AIR.has(name)) return
    let properties = {}
    if (typeof block.getProperties === 'function') {
      properties = block.getProperties() || {}
    }
    blocks.push({
      x: pos.x,
      y: pos.y,
      z: pos.z,
      name,
      properties
    })
  })

  return {
    format: schematic.constructor?.name === 'Schematic' ? 'schematic' : 'schematic',
    name: options.name || 'schematic',
    author: '',
    version: schematic.version,
    dataVersion: schematic.version?.dataVersion || 0,
    blocks
  }
}

module.exports = { parseSchematic, normalizeName }
