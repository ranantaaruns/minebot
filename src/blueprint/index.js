'use strict'

const fs = require('fs')
const path = require('path')
const { parseLitematic } = require('./litematic')
const { parseSchematic } = require('./schematic')
const { transformBlocks } = require('./transform')

const EXTENSIONS = new Set(['.schem', '.schematic', '.litematic', '.nbt'])

function posKey (x, y, z) {
  return `${x},${y},${z}`
}

function stateKey (name, properties = {}) {
  const keys = Object.keys(properties).sort()
  if (keys.length === 0) return name
  return `${name}[${keys.map(key => `${key}=${properties[key]}`).join(',')}]`
}

function normalizeBlueprint (parsed, filePath) {
  const unique = new Map()

  for (const block of parsed.blocks) {
    if (!block || !block.name) continue
    unique.set(posKey(block.x, block.y, block.z), block)
  }

  if (unique.size === 0) {
    throw new Error('Bangunan tidak memiliki blok (semua udara?)')
  }

  let minX = Infinity
  let minY = Infinity
  let minZ = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let maxZ = -Infinity

  for (const block of unique.values()) {
    minX = Math.min(minX, block.x)
    minY = Math.min(minY, block.y)
    minZ = Math.min(minZ, block.z)
    maxX = Math.max(maxX, block.x)
    maxY = Math.max(maxY, block.y)
    maxZ = Math.max(maxZ, block.z)
  }

  const size = { x: maxX - minX + 1, y: maxY - minY + 1, z: maxZ - minZ + 1 }

  const blocks = []
  const countsByState = new Map()

  for (const block of unique.values()) {
    const relative = {
      x: block.x - minX,
      y: block.y - minY,
      z: block.z - minZ,
      name: block.name,
      properties: block.properties || {}
    }
    blocks.push(relative)

    const key = stateKey(relative.name, relative.properties)
    const current = countsByState.get(key)
    if (current) {
      current.count++
    } else {
      countsByState.set(key, {
        name: relative.name,
        properties: relative.properties,
        count: 1
      })
    }
  }

  return {
    filePath,
    name: parsed.name || path.basename(filePath),
    format: parsed.format,
    author: parsed.author || '',
    sourceVersion: parsed.dataVersion || parsed.version || null,
    size,
    volume: size.x * size.y * size.z,
    blocks,
    countsByState,
    states: [...countsByState.values()]
  }
}

async function loadBlueprint (filePath, options = {}) {
  const resolved = path.resolve(filePath)
  const ext = path.extname(resolved).toLowerCase()

  if (ext && !EXTENSIONS.has(ext)) {
    throw new Error(`Format tidak dikenal: ${ext}. Gunakan .schem, .schematic, atau .litematic`)
  }
  if (!fs.existsSync(resolved)) {
    throw new Error(`File blueprint tidak ditemukan: ${resolved}`)
  }

  const buffer = await fs.promises.readFile(resolved)
  const maxVolume = options.maxVolume || 200000

  let parsed = null
  let lastError = null

  const order = ext === '.litematic'
    ? [parseLitematic, parseSchematic]
    : [parseSchematic, parseLitematic]

  for (const parser of order) {
    try {
      parsed = await parser(buffer, { ...options, maxVolume, name: path.basename(resolved) })
      if (parsed && parsed.blocks && parsed.blocks.length > 0) break
    } catch (err) {
      if (err.message.includes('terlalu besar')) throw err
      lastError = err
      parsed = null
    }
  }

  if (!parsed) {
    throw new Error(`Gagal membaca blueprint: ${lastError ? lastError.message : 'format tidak didukung'}`)
  }

  const rotate = Number(options.rotate || 0)
  const mirror = options.mirror || null
  if (rotate || mirror) {
    parsed = { ...parsed, blocks: transformBlocks(parsed.blocks, { rotate, mirror }) }
  }

  const blueprint = normalizeBlueprint(parsed, resolved)
  if (rotate || mirror) {
    blueprint.transform = { rotate: ((rotate % 360) + 360) % 360, mirror }
  }
  if (blueprint.volume > maxVolume) {
    throw new Error(
      `Bangunan terlalu besar: ${blueprint.volume.toLocaleString('id-ID')} blok volume ` +
      `(batas ${maxVolume.toLocaleString('id-ID')}). Naikkan build.maxVolume jika yakin.`
    )
  }

  return blueprint
}

module.exports = { loadBlueprint, normalizeBlueprint, stateKey, posKey }
