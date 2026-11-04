'use strict'

const nbt = require('prismarine-nbt')
const { AIR } = require('./litematic')

function unwrap (tag) {
  if (tag === undefined || tag === null) return tag
  if (typeof tag === 'object' && 'value' in tag) return tag.value
  return tag
}

// Menormalkan list NBT: prismarine-nbt membungkusnya sebagai
// { type, value: { type, value: [...] } }, sedangkan penulis file bisa langsung array.
function readArray (tag) {
  let current = unwrap(tag)
  if (current && typeof current === 'object' && !Array.isArray(current)) {
    current = unwrap(current)
  }
  return Array.isArray(current) ? current : []
}

function readNumber (value, fallback = 0) {
  const number = Number(unwrap(value))
  return Number.isFinite(number) ? number : fallback
}

function readTriple (tag) {
  const values = readArray(tag)
  return [
    readNumber(values[0], 0),
    readNumber(values[1], 0),
    readNumber(values[2], 0)
  ]
}

function readPalette (paletteTag) {
  return readArray(paletteTag).map(entry => {
    const comp = unwrap(entry) || {}
    const name = String(unwrap(comp.Name) ?? 'minecraft:air')
    const properties = {}
    const propsTag = unwrap(comp.Properties) || {}
    for (const [key, value] of Object.entries(propsTag)) {
      const raw = unwrap(value)
      if (raw !== undefined) properties[key] = String(raw)
    }
    return { name, properties }
  })
}

// File .nbt hasil "Save Structure" structure block Minecraft:
// { size: [x,y,z], palette: [{Name, Properties}], blocks: [{pos:[x,y,z], state}] }
async function parseStructure (buffer, options = {}) {
  const { parsed } = await nbt.parse(buffer)
  const root = unwrap(parsed) || {}
  const data = unwrap(root.structure) || root

  const palette = readPalette(data.palette)
  const rawBlocks = readArray(data.blocks)

  if (palette.length === 0 || rawBlocks.length === 0) {
    throw new Error('Berkas NBT ini bukan struktur structure block (tidak ada palette/blocks)')
  }

  const [sizeX, sizeY, sizeZ] = readTriple(data.size)
  const volume = Math.abs(sizeX * sizeY * sizeZ)
  const maxVolume = options.maxVolume || Infinity
  if (volume > maxVolume) {
    throw new Error(`Bangunan terlalu besar (${volume} blok). Naikkan build.maxVolume jika yakin.`)
  }

  const blocks = []
  for (const entry of rawBlocks) {
    const block = unwrap(entry) || {}
    const stateIndex = readNumber(block.state, 0)
    const state = palette[stateIndex]
    if (!state || AIR.has(state.name)) continue

    const [x, y, z] = readTriple(block.pos)
    blocks.push({ x, y, z, name: state.name, properties: state.properties })
  }

  if (blocks.length === 0) {
    throw new Error('Struktur NBT tidak memiliki blok solid')
  }

  return {
    format: 'structure',
    name: String(unwrap(data.name) ?? options.name ?? 'structure'),
    author: '',
    version: 0,
    dataVersion: readNumber(root.DataVersion, 0),
    blocks
  }
}

module.exports = { parseStructure }
