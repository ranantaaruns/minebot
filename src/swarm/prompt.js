'use strict'

const readline = require('readline')

async function promptSwarmConfig (baseConfig) {
  const isInteractive = Boolean(process.stdin.isTTY) &&
    !process.argv.includes('--non-interactive') &&
    !process.argv.includes('-y') &&
    !process.env.CI

  const baseUsername = baseConfig.bot?.username || 'mcbot'
  const maxBots = Math.min(50, Math.max(1, Number(baseConfig.swarm?.maxBots) || 50))
  const requestedCount = Math.max(1, Number(baseConfig.bot?.count) || 1)
  const defaultCount = Math.min(requestedCount, maxBots)

  if (!isInteractive) {
    if (Array.isArray(baseConfig.bots) && baseConfig.bots.length > 0) {
      return baseConfig.bots.slice(0, maxBots).map((b, i) => ({
        username: b.username || (i === 0 ? baseUsername : `${baseUsername}_${i + 1}`)
      }))
    }
    return Array.from({ length: defaultCount }, (_, i) => ({
      username: i === 0 ? baseUsername : `${baseUsername}_${i + 1}`
    }))
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })
  const ask = query => new Promise(resolve => rl.question(query, resolve))

  try {
    const srvDesc = baseConfig.server.port
      ? `${baseConfig.server.host}:${baseConfig.server.port}`
      : baseConfig.server.host

    console.log('')
    console.log('====================================================')
    console.log('            MINECRAFT MULTI-BOT LAUNCHER            ')
    console.log('====================================================')
    console.log(`Server: ${srvDesc}`)
    console.log(`Owner : ${baseConfig.owner.username}`)
    console.log('----------------------------------------------------')

    const ansCount = await ask(`Jumlah bot yang ingin dimasukkan (1-${maxBots}) [default: ${defaultCount}]: `)
    let count = parseInt(ansCount.trim(), 10)
    if (!Number.isFinite(count) || count < 1) {
      count = defaultCount
    }
    count = Math.min(Math.max(1, count), maxBots)

    const botConfigs = []
    for (let i = 0; i < count; i++) {
      let defaultNick = (i === 0 && count === 1)
        ? baseUsername
        : (i === 0 ? baseUsername : `${baseUsername}_${i + 1}`)

      // If baseConfig.bots has predefined usernames
      if (Array.isArray(baseConfig.bots) && baseConfig.bots[i]?.username) {
        defaultNick = baseConfig.bots[i].username
      }

      const ansNick = await ask(`Nickname bot #${i + 1} [default: ${defaultNick}]: `)
      const nick = ansNick.trim() || defaultNick
      botConfigs.push({ username: nick })
    }

    console.log('----------------------------------------------------')
    console.log(`Memulai ${count} bot: ${botConfigs.map(b => b.username).join(', ')}`)
    console.log('====================================================\n')

    return botConfigs
  } finally {
    rl.close()
  }
}

module.exports = { promptSwarmConfig }
