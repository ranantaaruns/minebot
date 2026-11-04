#!/usr/bin/env node
'use strict'

const fs = require('fs')
const path = require('path')
const { loadConfig } = require('./config')
const { Logger } = require('./logger')
const { Cli } = require('./cli')
const { promptSwarmConfig } = require('./swarm/prompt')
const { SwarmManager } = require('./swarm/manager')

const ROOT = path.resolve(__dirname, '..')

function loadOrCreateConfig () {
  try {
    return loadConfig(process.argv[2])
  } catch (err) {
    if (err.code === 'CONFIG_MISSING') {
      const example = path.join(ROOT, 'config.example.json')
      const target = path.join(ROOT, 'config.json')
      if (fs.existsSync(example) && !fs.existsSync(target)) {
        fs.copyFileSync(example, target)
        console.error(`config.json dibuat dari config.example.json.`)
        console.error(`Edit dulu: ${target}`)
        console.error('Isi server.host, server.port, owner.username, bot.username, dan auth.password.')
        process.exit(1)
      }
    }
    console.error(err.message)
    process.exit(1)
  }
}

async function main () {
  const config = loadOrCreateConfig()
  const logger = new Logger(config.logging)

  const botConfigs = await promptSwarmConfig(config)
  const swarm = new SwarmManager(botConfigs, config, logger)
  const cli = new Cli(swarm, config, logger)

  let quitting = false
  const quit = async () => {
    if (quitting) return
    quitting = true
    cli.stop()
    await swarm.quit()
    setTimeout(() => process.exit(0), 500)
  }

  process.on('SIGINT', quit)
  process.on('SIGTERM', quit)
  process.on('unhandledRejection', err => {
    logger.error(`Unhandled rejection: ${err?.message || err}`)
  })

  cli.start()
  const targetDesc = config.server.port
    ? `${config.server.host}:${config.server.port}`
    : config.server.host
  logger.info(`Menghubungkan ke ${targetDesc}...`)
  await swarm.start()
}

main().catch(err => {
  console.error(`Fatal error: ${err.message}`)
  process.exit(1)
})
