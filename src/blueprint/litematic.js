'use strict'

const nbt = require('prismarine-nbt')

const AIR = new Set(['minecraft:air', 'minecraft:cave_air', 'minecraft:void_air'])

function tagValue (tag, fallback = undefined) {
  if (tag === undefined || tag === null) return fallback
  return tag.value === undefined ? fallback : tag.value
}

function readInt (tag, fallback = 0) {
  const value = tagValue(tag, fallback)
  return Number(value)
}

function readString (tag, fallback = '') {
  const value = tagValue(tag, fallback)
  return typeof value === 'string' ? value : fallback
}

function toBigInt (entry) {
  if (typeof entry === 'bigint') return BigInt.asUintN(64, entry)
  if (typeof entry === 'number') return BigInt.asUintN(64, BigInt(entry))
  if (Array.isArray(entry) && entry.length === 2) {
    const high = BigInt.asUintN(32, BigInt(entry[0]))
    const low = BigInt.asUintN(32, BigInt(entry[1]))
    return (high << 32n) | low
  }
  return 0n
}

function bitsForPalette (size) {
  if (size <= 1) return 2
  return Math.max(2, Math.ceil(Math.log2(size)))
}

function decodePackedLongs (longs, bits, count) {
  const bigints = longs.map(toBigInt)
  const mask = (1n << BigInt(bits)) - 1n
  const out = new Array(count)
  for (let i = 0; i < count; i++) {
    const bitIndex = i * bits
    const longIndex = Math.floor(bitIndex / 64)
    const offset = bitIndex % 64
    let value = ((bigints[longIndex] ?? 0n) >> BigInt(offset)) & mask
    if (offset + bits > 64 && longIndex + 1 < bigints.length) {
      value |= (bigints[longIndex + 1] << BigInt(64 - offset)) & mask
    }
    out[i] = Number(value)
  }
  return out
}

function readPalette (paletteTag) {
  const raw = tagValue(paletteTag, []) || []
  const entries = Array.isArray(raw) ? raw : (Array.isArray(raw.value) ? raw.value : [])
  return entries.map(entry => {
    const unwrapped = tagValue(entry, null)
    const comp = unwrapped && typeof unwrapped === 'object' && !Array.isArray(unwrapped)
      ? unwrapped
      : (entry || {})
    const name = readString(comp.Name, 'minecraft:air') || 'minecraft:air'
    const propsTag = tagValue(comp.Properties, {}) || {}
    const properties = {}
    for (const [key, value] of Object.entries(propsTag)) {
      const raw = tagValue(value, undefined)
      if (raw !== undefined) properties[key] = String(raw)
    }
    return { name, properties }
  })
}

async function parseLitematic (buffer, options = {}) {
  const { parsed } = await nbt.parse(buffer)
  const root = tagValue(parsed, {}) || {}

  const metadata = tagValue(root.Metadata, {}) || {}
  const name = readString(metadata.Name, options.name || 'litematic')
  const author = readString(metadata.Author, '')
  const version = readInt(root.Version, 0)
  const dataVersion = readInt(root.MinecraftDataVersion, 0)

  const regionsTag = tagValue(root.Regions, {}) || {}
  if (!regionsTag || typeof regionsTag !== 'object') {
    throw new Error('File .litematic tidak memiliki Regions')
  }

  const blocks = []
  let maxVolume = options.maxVolume || Infinity

  for (const [regionName, regionTag] of Object.entries(regionsTag)) {
    const region = tagValue(regionTag, {}) || {}
    const posTag = tagValue(region.Position, {}) || {}
    const sizeTag = tagValue(region.Size, {}) || {}

    const px = readInt(posTag.x, 0)
    const py = readInt(posTag.y, 0)
    const pz = readInt(posTag.z, 0)

    const sx = readInt(sizeTag.x, 0)
    const sy = readInt(sizeTag.y, 0)
    const sz = readInt(sizeTag.z, 0)

    const absW = Math.abs(sx)
    const absH = Math.abs(sy)
    const absL = Math.abs(sz)
    const volume = absW * absH * absL
    if (volume === 0) continue
    if (volume > maxVolume) {
      throw new Error(`Region ${regionName} terlalu besar (${volume} blok). Naikkan build.maxVolume jika yakin.`)
    }
    maxVolume -= volume

    const startX = px + (sx < 0 ? sx + 1 : 0)
    const startY = py + (sy < 0 ? sy + 1 : 0)
    const startZ = pz + (sz < 0 ? sz + 1 : 0)

    const palette = readPalette(region.BlockStatePalette)
    const longs = tagValue(region.BlockStates, []) || []
    if (palette.length === 0 || longs.length === 0) continue

    const bits = bitsForPalette(palette.length)
    const decoded = decodePackedLongs(longs, bits, volume)

    let index = 0
    for (let y = 0; y < absH; y++) {
      for (let z = 0; z < absL; z++) {
        for (let x = 0; x < absW; x++, index++) {
          const stateIndex = decoded[index]
          const state = palette[stateIndex]
          if (!state || AIR.has(state.name)) continue
          blocks.push({
            x: startX + x,
            y: startY + y,
            z: startZ + z,
            name: state.name,
            properties: state.properties
          })
        }
      }
    }
  }

  return {
    format: 'litematic',
    name,
    author,
    version,
    dataVersion,
    blocks
  }
}

module.exports = { parseLitematic, decodePackedLongs, bitsForPalette, toBigInt, AIR }
