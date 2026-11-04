#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const mcDataLoader = require('minecraft-data')
const { loadBlueprint } = require('../src/blueprint')
const { computeRequirements } = require('../src/materials/requirements')

function usage () {
  console.log('Gunakan: node scripts/plan.js <file.schem|file.litematic> [--version 1.21.4] [--json]')
}

function parseArgs (argv) {
  const options = { file: null, version: null, json: false }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--version') options.version = argv[++i] || null
    else if (arg === '--json') options.json = true
    else if (!options.file) options.file = arg
  }
  return options
}

function readConfigMaxVolume () {
  const configPath = path.resolve(__dirname, '..', 'config.json')
  if (!fs.existsSync(configPath)) return 200000
  try {
    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'))
    return Number(config.build?.maxVolume) || 200000
  } catch {
    return 200000
  }
}

function resolveFile (file) {
  const candidates = [
    path.resolve(process.cwd(), file),
    path.resolve(__dirname, '..', 'blueprints', file)
  ]
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return candidates[0]
}

async function main () {
  const options = parseArgs(process.argv.slice(2))
  if (!options.file) {
    usage()
    process.exit(1)
  }

  const file = resolveFile(options.file)
  if (!fs.existsSync(file)) {
    console.error(`File tidak ditemukan: ${file}`)
    process.exit(1)
  }

  let mcData
  try {
    mcData = mcDataLoader(options.version || '1.21.4')
  } catch {
    console.error(`Versi tidak dikenal: ${options.version}`)
    process.exit(1)
  }

  const blueprint = await loadBlueprint(file, {
    maxVolume: readConfigMaxVolume(),
    version: options.version || null
  })
  const requirements = computeRequirements(blueprint, mcData)

  if (options.json) {
    const output = {
      file,
      name: blueprint.name,
      format: blueprint.format,
      size: blueprint.size,
      volume: blueprint.volume,
      blockCount: blueprint.blocks.length,
      totalBlocks: requirements.totalBlocks,
      items: [...requirements.items.values()]
        .sort((a, b) => b.count - a.count)
        .map(item => ({ name: item.name, count: item.count })),
      unsupported: [...requirements.unsupported.values()]
        .sort((a, b) => b.count - a.count)
        .map(item => ({ name: item.name, count: item.count, reason: item.reason })),
      skipped: [...requirements.skipped.values()]
        .sort((a, b) => b.count - a.count)
        .map(item => ({ name: item.name, count: item.count, reason: item.reason }))
    }
    console.log(JSON.stringify(output, null, 2))
    return
  }

  console.log(`File     : ${file}`)
  console.log(`Nama     : ${blueprint.name}`)
  console.log(`Format   : ${blueprint.format}`)
  console.log(`Ukuran   : ${blueprint.size.x} x ${blueprint.size.y} x ${blueprint.size.z}`)
  console.log(`Volume   : ${blueprint.volume}`)
  console.log(`Blok     : ${blueprint.blocks.length} jenis, ${requirements.totalBlocks} total item`)
  console.log('')

  console.log('Material:')
  for (const item of [...requirements.items.values()].sort((a, b) => b.count - a.count)) {
    console.log(`  ${item.name.padEnd(32)} ${String(item.count).padStart(7)}`)
  }

  if (requirements.unsupported.size > 0) {
    console.log('\nTidak didukung:')
    for (const item of [...requirements.unsupported.values()].sort((a, b) => b.count - a.count)) {
      console.log(`  ${item.name.padEnd(32)} x${item.count} - ${item.reason}`)
    }
  }

  if (requirements.skipped.size > 0) {
    console.log('\nDilewati otomatis:')
    for (const item of [...requirements.skipped.values()].sort((a, b) => b.count - a.count)) {
      console.log(`  ${item.name.padEnd(32)} x${item.count} - ${item.reason}`)
    }
  }
}

main().catch(err => {
  console.error(err.stack || err.message)
  process.exit(1)
})
