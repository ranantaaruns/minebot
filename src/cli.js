'use strict'

const fs = require('fs')
const path = require('path')
const readline = require('readline')
const Vec3 = require('vec3')
const mcDataLoader = require('minecraft-data')
const { loadBlueprint } = require('./blueprint')
const { computeRequirements } = require('./materials/requirements')
const { MaterialManager } = require('./materials/resolve')
const { Builder } = require('./build/builder')
const { aggregateInventory, countItemName } = require('./util/inventory')
const { applyMovements } = require('./movements')
const { OwnerDialog } = require('./owner-dialog')
const { findPlayer, startHuntJob } = require('./safety/hunt')

const HELP = `
Perintah yang tersedia:
  help                          Tampilkan bantuan ini
  status                        Status bot, auth, job, dan posisi
  pos                           Koordinat bot saat ini
  inv [filter]                  Isi inventory (opsional filter nama)
  materials <file> [opsi]       Hitung kebutuhan material dari blueprint
  build <file> [opsi]           Bangun struktur
      --at <x> <y> <z>          Titik awal build (default: posisi bot)
      --creative                Gunakan creative mode (lewati pencarian material)
      --survival                Paksa mode survival
      --dry-run                 Hanya tampilkan rencana material
      --no-gather               Jangan menambang/crafting, pakai inventory/chest
      --force                   Tetap build walau material kurang
      --rotate <90|180|270>     Putar blueprint searah jarum jam
      --mirror <x|z>            Cerminkan blueprint pada sumbu x atau z
      --bot <id|nama>           Pilih bot tertentu (mode multi-bot)
  gamemode [mode]               Lihat atau ubah gamemode bot (survival/creative/dll)
  gather <item> [count]         Kumpulkan material (contoh: gather ancient_debris 4)
  attack <nama player>          Cari dan bunuh player (bow dipakai untuk jarak jauh)
  combat [on|off]               Lihat/aktifkan mesin PvP udara (mace + elytra charge)
  track [on|off|where <p>|export [file]|clear]  Lacak koordinat player dari paket entity
  come [x y z]                  Datang ke owner (atau koordinat tertentu)
  follow                        Aktifkan auto-follow owner
  say <teks>                    Kirim pesan ke chat server
  register                      Kirim ulang /register ke server
  auth                          Coba login ulang
  pause / resume                Jeda/lanjutkan build
  stop                          Hentikan job yang berjalan
  quit                          Keluar dan putuskan bot
`

function parseCommandLine (line) {
  const tokens = []
  let current = ''
  let quote = null

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quote) {
      if (ch === quote) quote = null
      else current += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      continue
    }
    if (/\s/.test(ch)) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }
    current += ch
  }
  if (current) tokens.push(current)

  return { cmd: (tokens.shift() || '').toLowerCase(), args: tokens, raw: line.trim() }
}

function resolveBlueprintPath (file) {
  const root = path.resolve(__dirname, '..')
  const candidates = []
  const base = path.resolve(process.cwd(), file)
  candidates.push(base)
  candidates.push(path.resolve(process.cwd(), 'blueprints', file))
  candidates.push(path.resolve(root, 'blueprints', file))

  if (!path.extname(file)) {
    for (const ext of ['.schem', '.schematic', '.litematic']) {
      candidates.push(base + ext)
      candidates.push(path.resolve(process.cwd(), 'blueprints', file + ext))
      candidates.push(path.resolve(root, 'blueprints', file + ext))
    }
  }

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return candidate
  }
  return base
}

function formatItem (row) {
  return `${row.name.padEnd(32)} butuh ${String(row.count ?? row.needed).padStart(6)}`
}

class Cli {
  constructor (target, config, logger) {
    if (target?.isSwarm) {
      this.swarm = target
      this.session = target.getPrimary()
    } else {
      this.session = target || {}
      this.swarm = target?.swarm || null
    }
    this.config = config
    this.logger = logger
    this.rl = null
    this.running = false
  }

  start () {
    this.rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
      prompt: 'mcbot> '
    })
    this.running = true

    this.rl.on('line', line => {
      this.handleLine(line).catch(err => {
        this.logger.error(err.message)
      }).finally(() => {
        if (this.running) this.rl.prompt()
      })
    })

    this.rl.on('close', () => {
      this.running = false
      if (this.swarm) {
        this.swarm.quit().catch(() => {})
      } else {
        this.session.quit?.()
      }
    })

    this.rl.prompt()
  }

  stop () {
    this.running = false
    try { this.rl?.close() } catch {}
  }

  async handleLine (line) {
    const text = line.trim()
    if (!text) return

    const { cmd, args, raw } = parseCommandLine(text)

    switch (cmd) {
      case 'help':
        console.log(HELP)
        return
      case 'quit':
      case 'exit':
        if (this.swarm) {
          await this.swarm.quit()
        } else {
          await this.session.quit?.()
        }
        return
      case 'status':
        return this.printStatus()
      case 'pos':
      case 'where':
        return this.printPosition()
      case 'inv':
        return this.printInventory(args[0])
      case 'materials':
        return this.handleMaterials(args)
      case 'build':
        return this.handleBuild(args)
      case 'gamemode':
      case 'gm':
        return this.handleGamemode(args)
      case 'gather':
        return this.handleGather(args)
      case 'attack':
        return this.handleAttack(args)
      case 'combat':
      case 'pvp':
        return this.handleCombat(args)
      case 'come':
        return this.handleCome(args)
      case 'follow':
        if (this.swarm) {
          this.config.owner.autoFollow = true
          this.swarm.follow()
          return
        }
        if (this.session.owner) {
          this.config.owner.autoFollow = true
          this.session.owner.resume()
          const foodResumed = this.session.bot?.foodManager?.manualResume?.()
          if (foodResumed === false) this.logger.warn('Masih menunggu makanan; follow tetap dijeda')
        }
        this.logger.info('Auto-follow diaktifkan')
        return
      case 'say':
        return this.handleSay(raw.replace(/^say\s*/i, ''))
      case 'register':
        return this.handleRegister()
      case 'auth':
        if (this.swarm) {
          for (const s of this.swarm.getConnectedBots()) {
            s.auth?.retry?.()
          }
          return
        }
        if (!this.session.auth) throw new Error('Bot belum terhubung')
        await this.session.auth.retry()
        return
      case 'pause': {
        const sessions = this.swarm ? this.swarm.getConnectedBots() : [this.session]
        const running = sessions.filter(s => s.builder)
        if (running.length === 0) {
          this.logger.warn('Tidak ada build yang berjalan')
          return
        }
        for (const s of running) s.builder.pause()
        this.logger.info(`Build dijeda (${running.length} bot)`)
        return
      }
      case 'resume': {
        const sessions = this.swarm ? this.swarm.getConnectedBots() : [this.session]
        const running = sessions.filter(s => s.builder)
        if (running.length === 0) {
          this.logger.warn('Tidak ada build yang berjalan')
          return
        }
        for (const s of running) {
          s.builder.resume()
          const foodResumed = s.bot?.foodManager?.manualResume?.()
          if (foodResumed === false) this.logger.warn(`Masih menunggu makanan di ${s.username || s.id}`)
        }
        this.logger.info(`Build dilanjutkan (${running.length} bot)`)
        return
      }
      case 'stop':
        return this.handleStop()
      default:
        this.logger.warn(`Perintah tidak dikenal: ${cmd}. Ketik "help".`)
    }
  }

  getSession (selector = null) {
    if (!this.swarm) {
      if (selector) throw new Error('--bot hanya berlaku saat menjalankan lebih dari satu bot')
      return this.session
    }
    if (!selector) return this.swarm.getPrimary() || this.session

    const sessions = this.swarm.getAllSessions()
    const wanted = String(selector).toLowerCase()
    const found = sessions.find(s => String(s.id) === String(selector)) ||
      sessions.find(s => String(s.username || '').toLowerCase() === wanted)
    if (!found) {
      const list = sessions.map(s => `${s.id}=${s.username}`).join(', ')
      throw new Error(`Bot "${selector}" tidak ditemukan. Pilihan: ${list}`)
    }
    return found
  }

  getBotFor (session, requireSpawn = true) {
    const bot = session?.bot
    if (!bot) throw new Error('Bot belum terhubung ke server')
    if (requireSpawn && !bot.entity) throw new Error('Bot belum spawn / belum login')
    return bot
  }

  getBot (requireSpawn = true) {
    return this.getBotFor(this.getSession(), requireSpawn)
  }

  getMcData (bot) {
    if (bot?.version) return mcDataLoader(bot.version)
    if (this.config.server.version) return mcDataLoader(this.config.server.version)
    this.logger.warn('Versi server belum diketahui, memakai data 1.21.4 untuk perhitungan material')
    return mcDataLoader('1.21.4')
  }

  printStatus () {
    if (this.swarm) {
      const all = this.swarm.getAllSessions()
      const connected = this.swarm.getConnectedBots()
      console.log(`=== Status Swarm (${connected.length}/${all.length} Bot Online) ===`)
      for (const s of all) {
        const bot = s.bot
        const p = bot?.entity?.position
        const posStr = p ? `(${p.x.toFixed(1)}, ${p.y.toFixed(1)}, ${p.z.toFixed(1)})` : 'Offline'
        const hpStr = bot?.health !== undefined ? `HP: ${bot.health}` : 'HP: -'
        const foodStr = bot?.food !== undefined ? `Food: ${bot.food}` : 'Food: -'
        const modeStr = bot?.game?.gameMode || '-'
        const authStr = s.auth?.state || (s.auth?.authenticated ? 'authenticated' : '-')
        const jobStr = s.jobs.busy ? `Job: ${s.jobs.name}` : 'Idle'
        console.log(`[${s.id}] ${s.username.padEnd(14)}: ${posStr} | ${hpStr} | ${foodStr} | Mode: ${modeStr} | Auth: ${authStr} | ${jobStr}`)
      }
      return
    }

    const bot = this.session.bot
    const job = this.session.jobs?.current

    console.log('--- Status ---')
    console.log(`Koneksi : ${bot && bot.entity ? 'tersambung' : 'tidak tersambung'}`)
    if (bot?.entity) {
      const p = bot.entity.position
      console.log(`Posisi  : ${p.x.toFixed(1)} ${p.y.toFixed(1)} ${p.z.toFixed(1)}`)
      console.log(`Health  : ${bot.health}  Food: ${bot.food}`)
      console.log(`Versi   : ${bot.version}`)
      console.log(`Mode    : ${bot.game?.gameMode || 'survival'}`)
      console.log(`Auth    : ${this.session.auth?.state || '-'}`)
      console.log(`Follow  : ${this.session.owner?.target ? 'target ' + this.session.owner.target.toString() : (this.config.owner.autoFollow ? 'aktif' : 'nonaktif')}`)
    }
    if (job) {
      console.log(`Job     : ${job.name} (${((Date.now() - job.startedAt) / 1000).toFixed(1)}s)`)
      if (job.progress) {
        const p = job.progress
        console.log(`Progress: ${p.done + p.skipped}/${p.total} selesai, ${p.failed} gagal, pass ${p.pass}`)
      }
    } else {
      console.log('Job     : idle')
    }
    console.log(`Scaffold: ${this.session.builder?.scaffolds?.length || 0} blok`)
  }

  printPosition () {
    if (this.swarm) {
      const active = this.swarm.getConnectedBots()
      if (active.length === 0) {
        console.log('Tidak ada bot yang terhubung')
        return
      }
      for (const s of active) {
        const p = s.bot.entity.position
        console.log(`${s.username.padEnd(16)}: ${p.x.toFixed(2)} ${p.y.toFixed(2)} ${p.z.toFixed(2)}`)
      }
      return
    }

    const bot = this.getBot()
    const p = bot.entity.position
    console.log(`${p.x.toFixed(2)} ${p.y.toFixed(2)} ${p.z.toFixed(2)}`)
  }

  printInventory (filter) {
    if (this.swarm) {
      const active = this.swarm.getConnectedBots()
      if (active.length === 0) {
        console.log('Tidak ada bot yang terhubung')
        return
      }
      for (const s of active) {
        console.log(`--- Inventory ${s.username} ---`)
        const rows = aggregateInventory(s.bot)
          .filter(row => !filter || row.name.includes(filter))
        if (rows.length === 0) {
          console.log('(kosong)')
        } else {
          for (const row of rows) {
            console.log(`${row.name.padEnd(32)} ${String(row.count).padStart(6)}`)
          }
        }
      }
      return
    }

    const bot = this.getBot()
    const rows = aggregateInventory(bot)
      .filter(row => !filter || row.name.includes(filter))
    if (rows.length === 0) {
      console.log('(kosong)')
      return
    }
    for (const row of rows) {
      console.log(`${row.name.padEnd(32)} ${String(row.count).padStart(6)}`)
    }
  }

  async _loadAndPlan (file, bot, options = {}) {
    const resolved = resolveBlueprintPath(file)
    const blueprint = await loadBlueprint(resolved, {
      maxVolume: this.config.build.maxVolume,
      version: bot?.version || this.config.server.version || null,
      rotate: options.rotate || 0,
      mirror: options.mirror || null
    })
    const mcData = this.getMcData(bot)
    const requirements = computeRequirements(blueprint, mcData)
    return { blueprint, requirements, mcData, resolved }
  }

  _printPlan (blueprint, requirements, bot, mcData) {
    console.log(`Blueprint: ${blueprint.name} (${blueprint.format})`)
    console.log(`Ukuran   : ${blueprint.size.x} x ${blueprint.size.y} x ${blueprint.size.z} (${blueprint.volume} volume)`)
    console.log(`Blok     : ${blueprint.blocks.length} (${requirements.totalBlocks} item)`)
    if (blueprint.transform) {
      const parts = []
      if (blueprint.transform.rotate) parts.push(`rotate ${blueprint.transform.rotate}° searah jarum jam`)
      if (blueprint.transform.mirror) parts.push(`mirror sumbu ${blueprint.transform.mirror}`)
      console.log(`Transform: ${parts.join(', ')}`)
    }

    const rows = [...requirements.items.values()].sort((a, b) => b.count - a.count)
    console.log('--- Material ---')
    for (const row of rows) {
      const have = bot?.version ? countItemName(bot, mcData, row.name) : null
      const suffix = have === null ? '' : ` (ada ${have})`
      console.log(`${formatItem(row)}${suffix}`)
    }

    if (requirements.unsupported.size > 0) {
      console.log('--- Tidak didukung ---')
      for (const row of [...requirements.unsupported.values()].sort((a, b) => b.count - a.count)) {
        console.log(`${row.name.padEnd(32)} x${row.count} - ${row.reason}`)
      }
    }

    if (requirements.skipped.size > 0) {
      console.log('--- Dilewati otomatis ---')
      for (const row of [...requirements.skipped.values()].sort((a, b) => b.count - a.count)) {
        console.log(`${row.name.padEnd(32)} x${row.count} - ${row.reason}`)
      }
    }
  }

  async handleMaterials (args) {
    const options = this._parseBuildOptions(args, 'materials')
    const session = this.getSession(options.bot)
    const bot = session?.bot || null
    const { blueprint, requirements, mcData } = await this._loadAndPlan(options.file, bot, options)
    this._printPlan(blueprint, requirements, bot, mcData)
  }

  _parseBuildOptions (args, command = 'build') {
    const options = {
      file: null,
      at: null,
      dryRun: false,
      noGather: false,
      force: false,
      creative: false,
      survival: false,
      rotate: 0,
      mirror: null,
      bot: null
    }
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]
      if (arg === '--at') {
        const x = Number(args[++i])
        const y = Number(args[++i])
        const z = Number(args[++i])
        if (![x, y, z].every(Number.isFinite)) throw new Error('--at butuh tiga angka: x y z')
        options.at = new Vec3(x, y, z)
      } else if (arg === '--rotate') {
        const deg = Number(args[++i])
        if (![0, 90, 180, 270, 360].includes(deg)) {
          throw new Error('--rotate harus kelipatan 90 (0, 90, 180, 270, 360)')
        }
        options.rotate = deg % 360
      } else if (arg === '--mirror') {
        const axis = String(args[++i] || '').toLowerCase()
        if (axis !== 'x' && axis !== 'z') throw new Error('--mirror harus x atau z')
        options.mirror = axis
      } else if (arg === '--bot') {
        options.bot = args[++i] || null
        if (!options.bot) throw new Error('--bot butuh id atau nama bot')
      } else if (arg === '--dry-run' || arg === '--dry') {
        options.dryRun = true
      } else if (arg === '--no-gather') {
        options.noGather = true
      } else if (arg === '--force') {
        options.force = true
      } else if (arg === '--creative') {
        options.creative = true
      } else if (arg === '--survival') {
        options.survival = true
      } else if (!options.file) {
        options.file = arg
      }
    }
    if (!options.file) throw new Error(`Gunakan: ${command} <file> [opsi]`)
    return options
  }

  _originFor (buildOptions, bot, session = this.getSession()) {
    if (buildOptions.at) return buildOptions.at.clone()

    const anchor = this.config.build.anchor
    if (anchor === 'player') {
      const owner = session?.owner?.getOwnerEntity()
      if (owner) return owner.position.floored()
    }
    if (anchor === 'origin' && bot.spawnPoint) return bot.spawnPoint.floored()
    return bot.entity.position.floored()
  }

  async handleGamemode (args) {
    if (this.swarm) {
      return this.swarm.gamemode(args[0])
    }
    const bot = this.getBot()
    const gm = this.session.gamemode
    const target = args[0]
    if (!target) {
      const mode = bot.game?.gameMode || 'tidak diketahui'
      this.logger.info(`Gamemode bot saat ini: ${mode}`)
      return mode
    }
    if (!gm) throw new Error('GamemodeManager belum siap')
    this.logger.info(`Mengganti gamemode ke ${target}...`)
    const res = await gm.setGamemode(target)
    if (res.ok) {
      this.logger.info(`Gamemode berhasil diubah ke ${res.mode}`)
    } else {
      this.logger.warn(`Gagal mengubah gamemode: ${res.error || 'Server menolak'}`)
    }
    return res
  }

  async handleBuild (args) {
    const options = this._parseBuildOptions(args)
    const session = this.getSession(options.bot)
    const bot = this.getBotFor(session)
    let { blueprint, requirements, mcData } = await this._loadAndPlan(options.file, bot, options)

    this._printPlan(blueprint, requirements, bot, mcData)

    if (options.dryRun) return

    if (session.jobs.busy) {
      throw new Error(`Masih ada job: ${session.jobs.name}. Jalankan "stop" dulu.`)
    }

    if (!session.auth?.authenticated) {
      this.logger.warn('Bot belum terkonfirmasi login. Build tetap dicoba, tapi server bisa menolak.')
    }

    if (this.swarm && this.swarm.getAllSessions().length > 1) {
      this.logger.info(`Build dijalankan oleh bot ${session.username || session.id}`)
    }

    const origin = this._originFor(options, bot, session)
    const materials = new MaterialManager(bot, this.config, this.logger, { origin })

    await session.jobs.run('build', async (cancellation, job) => {
      session.materials = materials
      session.owner?.pause()
      bot.storageManager?.clearKeep()
      bot.storageManager?.addKeep([...requirements.items.keys()])

      let enteredCreative = false
      const gm = session.gamemode
      const preferCreative = options.creative ? true : (options.survival ? false : (this.config.gamemode?.buildMode === 'creative'))

      if (preferCreative && gm) {
        this.logger.info('Mencoba mengaktifkan creative mode untuk build...')
        const res = await gm.setGamemode('creative')
        if (res.ok) {
          enteredCreative = true
          this.logger.info('Creative mode aktif. Pengumpulan material dan dialog biome dilewati.')
        } else {
          if (options.creative && !options.force) {
            throw new Error(`Gagal beralih ke creative mode: ${res.error || 'Server menolak'}. Gunakan --force untuk lanjut di survival.`)
          }
          this.logger.warn(`Server tidak mengizinkan creative mode (${res.error || 'ditolak'}), melanjutkan dalam mode survival.`)
        }
      }

      const isCreative = enteredCreative || bot.game?.gameMode === 'creative'

      try {
        let substitutions = new Map()
        if (!isCreative) {
          const resolution = await materials.resolveBiomeMaterials(requirements, {
            origin,
            dialog: this._getDialog(session, bot),
            cancellation
          })
          requirements = resolution.requirements
          substitutions = resolution.substitutions
          if (resolution.decisions.length > 0) {
            this.logger.info(`Resolusi material biome: ${resolution.decisions.length} keputusan`)
          }

          if (this.config.gather.enabled && !options.noGather) {
            applyMovements(bot, 'travel', this.config.owner)
            const prep = await materials.prepare(requirements, cancellation)
            if (!prep.ok) {
              const lines = prep.missing.map(row => `${row.name}: ${row.have}/${row.needed} (${row.reason})`)
              this.logger.warn(`Material kurang:\n${lines.join('\n')}`)
              if (!options.force) {
                throw new Error('Material belum lengkap. Lengkapi chest, atau pakai --no-gather/--force.')
              }
            }
          } else {
            const missing = []
            for (const item of requirements.items.values()) {
              const have = countItemName(bot, mcData, item.name)
              if (have < item.count) missing.push(`${item.name}: ${have}/${item.count}`)
            }
            if (missing.length > 0) {
              this.logger.warn(`Material kurang (gather dimatikan):\n${missing.join('\n')}`)
              if (!options.force) throw new Error('Material belum lengkap. Pakai --force untuk tetap build.')
            }
          }
        }

        cancellation.throwIfCancelled()
        session.builder = new Builder(bot, blueprint, {
          config: this.config,
          logger: this.logger,
          origin,
          materials,
          allowGather: !isCreative && this.config.gather.enabled && !options.noGather,
          substitutions,
          cancellation,
          onProgress: progress => job.progress = progress
        })

        const result = await session.builder.build()
        this.logger.info(
          `Ringkasan build: ${result.done} dipasang, ${result.skipped} sudah ada, ` +
          `${result.failed} gagal, ${result.remaining} tersisa`
        )
        return result
      } finally {
        session.builder = null
        bot.storageManager?.clearKeep()
        if (enteredCreative && this.config.gamemode?.restoreAfterBuild !== false && gm) {
          try {
            await gm.restoreGamemode()
          } catch (err) {
            this.logger.debug(`Gagal mengembalikan gamemode: ${err.message}`)
          }
        }
        session.owner?.resume()
      }
    })
  }

  async handleGather (args) {
    let item = String(args[0] || '').replace(/^minecraft:/, '')
    let count = Number(args[1] || 1)

    // Support "ancient debris" or "ancient debries" split into two args
    if (item === 'ancient' && args[1] && (args[1].toLowerCase() === 'debris' || args[1].toLowerCase() === 'debries')) {
      item = 'ancient_debris'
      count = Number(args[2] || 1)
    } else if (item === 'ancient_debries') {
      item = 'ancient_debris'
    }

    if (!item || !Number.isFinite(count) || count <= 0) {
      throw new Error('Gunakan: gather <item> [count]')
    }

    if (this.swarm) {
      return this.swarm.gather(item, count)
    }

    const bot = this.getBot()
    if (this.session.jobs.busy) throw new Error(`Masih ada job: ${this.session.jobs.name}`)

    const materials = new MaterialManager(bot, this.config, this.logger, {
      origin: bot.entity.position.floored()
    })

    await this.session.jobs.run('gather', async cancellation => {
      this.session.owner?.pause()
      bot.storageManager?.clearKeep()
      bot.storageManager?.addKeep([item])
      try {
        const result = await materials.ensureItem(item, count, cancellation)
        if (result.ok) {
          this.logger.info(`Gather selesai: ${item} ${result.have}/${count}`)
        } else {
          this.logger.warn(`Gather kurang: ${item} ${result.have}/${count} (${result.reason || '-'})`)
        }
        return result
      } finally {
        bot.storageManager?.clearKeep()
        applyMovements(bot, 'travel', this.config.owner)
        this.session.owner?.resume()
      }
    })
  }

  async handleAttack (args) {
    let selector = null
    const positional = []
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]
      if (arg === '--bot') {
        selector = args[++i] || null
        if (!selector) throw new Error('--bot butuh id atau nama bot')
        continue
      }
      positional.push(arg)
    }

    const target = positional.join(' ').trim()
    if (!target) throw new Error('Gunakan: attack <nama player>')

    const session = this.getSession(selector)
    if (selector || !this.swarm) {
      const bot = this.getBotFor(session)
      this._assertTargetVisible(bot, target)
      return startHuntJob(session, target, { config: this.config, logger: this.logger })
    }

    return this.swarm.attack(target)
  }

  _assertTargetVisible (bot, target) {
    const found = findPlayer(bot, target)
    if (found.player || found.entity) return

    const username = String(bot?.username || '').toLowerCase()
    const names = Object.keys(bot?.players || {}).filter(name => name.toLowerCase() !== username)
    const hint = names.length > 0 ? ` Pilihan: ${names.join(', ')}` : ' Belum ada player lain yang terlihat.'
    throw new Error(`Player "${target}" tidak ditemukan.${hint}`)
  }

  async handleCombat (args) {
    const mode = String(args[0] || '').toLowerCase()
    let enable = null
    if (mode === 'on' || mode === 'aktif') enable = true
    else if (mode === 'off' || mode === 'mati') enable = false
    else if (mode) throw new Error('Gunakan: combat [on|off]')

    const sessions = this.swarm ? this.swarm.getConnectedBots() : [this.session]
    const lines = []
    for (const s of sessions) {
      const engine = s?.bot?.combatEngine
      if (!engine) continue
      if (enable !== null) engine.enabled = enable
      const status = engine.enabled ? 'aktif' : 'nonaktif'
      const st = engine.stats || {}
      lines.push(`${s.bot.username || 'bot'}: ${status} (luncur ${st.launches || 0}, smash ${st.smashes || 0}, charge ${st.charges || 0}, clutch ${st.clutch || 0})`)
    }
    if (!lines.length) throw new Error('Bot belum terhubung atau engine PvP tidak tersedia')
    for (const line of lines) this.logger.info(`Combat ${line}`)
    return lines
  }

  async handleTrack (args) {
    const mode = String(args[0] || '').toLowerCase()
    const sessions = this.swarm ? this.swarm.getConnectedBots() : [this.session]
    const lines = []

    if (mode === '' || mode === 'list') {
      for (const s of sessions) {
        const tracker = s?.bot?.playerTracker
        if (!tracker) continue
        const rows = tracker.list()
        lines.push(`${s.bot.username || 'bot'}: ${tracker.enabled ? 'aktif' : 'nonaktif'} (${rows.length} player, ${tracker.stats?.samples || 0} sampel)`)
        for (const row of rows.slice(0, 10)) {
          const age = `${Math.round(row.ageMs / 1000)}s lalu`
          lines.push(`  ${row.username} @ ${row.coords} ${row.compass} ${Math.round(row.distance)} blok, ${row.stale ? 'prediksi' : 'segar'} (${age})`)
        }
      }
      if (!lines.length) throw new Error('Bot belum terhubung atau tracker tidak tersedia')
      for (const line of lines) this.logger.info(`Track ${line}`)
      return lines
    }

    if (mode === 'on' || mode === 'aktif' || mode === 'off' || mode === 'mati') {
      const enable = mode === 'on' || mode === 'aktif'
      for (const s of sessions) {
        const tracker = s?.bot?.playerTracker
        if (!tracker) continue
        tracker.enabled = enable
        lines.push(`${s.bot.username || 'bot'}: ${enable ? 'aktif' : 'nonaktif'}`)
      }
      if (!lines.length) throw new Error('Tracker tidak tersedia')
      for (const line of lines) this.logger.info(`Track ${line}`)
      return lines
    }

    if (mode === 'where') {
      const name = args[1]
      if (!name) throw new Error('Gunakan: track where <player>')
      for (const s of sessions) {
        const info = s?.bot?.playerTracker?.where(name)
        if (!info) continue
        lines.push(`${s.bot.username || 'bot'} -> ${info.username} @ ${info.coords} (${info.dimension || '?'}) jarak ${Math.round(info.distance)} blok arah ${info.compass || '?'}, ${info.stale ? 'PREDIKSI' : 'segar'} ${Math.round(info.ageMs / 1000)}s lalu`)
        if (info.prediction) {
          lines.push(`  prediksi ${Math.round((info.prediction.aheadMs || 0) / 1000)}s: ${info.prediction.x.toFixed(1)} ${info.prediction.y.toFixed(1)} ${info.prediction.z.toFixed(1)} (+-${(info.prediction.uncertainty || 0).toFixed(1)} blok)`)
        }
      }
      if (!lines.length) throw new Error(`Koordinat ${name} tidak ada di tracker`)
      for (const line of lines) this.logger.info(`Track ${line}`)
      return lines
    }

    if (mode === 'export') {
      const file = args[1] || `data/tracker/export-${Date.now()}.json`
      for (const s of sessions) {
        const tracker = s?.bot?.playerTracker
        if (!tracker) continue
        const target = await tracker.exportTo(file)
        lines.push(`${s.bot.username || 'bot'} -> ${target}`)
      }
      if (!lines.length) throw new Error('Tracker tidak tersedia')
      for (const line of lines) this.logger.info(`Track ${line}`)
      return lines
    }

    if (mode === 'clear') {
      for (const s of sessions) {
        s?.bot?.playerTracker?.clear()
        lines.push(`${s.bot.username || 'bot'}: riwayat dihapus`)
      }
      if (!lines.length) throw new Error('Tracker tidak tersedia')
      for (const line of lines) this.logger.info(`Track ${line}`)
      return lines
    }

    throw new Error('Gunakan: track [on|off|where <player>|export [file]|clear]')
  }

  async handleCome (args) {
    let coords = null
    if (args.length >= 3) {
      const [x, y, z] = args.slice(0, 3).map(Number)
      if (![x, y, z].every(Number.isFinite)) throw new Error('Koordinat tidak valid')
      coords = new Vec3(x, y, z)
    }

    if (this.swarm) {
      return this.swarm.come(coords)
    }

    const bot = this.getBot(false)
    if (!this.session.owner) throw new Error('Owner tracker belum siap')
    this.session.owner.resume()

    const result = await this.session.owner.come(coords)
    if (!result.ok) this.logger.warn(`Gagal mendekati owner: ${result.reason || 'tidak ditemukan'}`)
    else this.logger.info('Sudah dekat dengan owner')
  }

  handleRegister () {
    if (this.swarm) {
      if (!this.config.auth?.enabled) throw new Error('auth.enabled=false di config, register tidak dikirim')
      return this.swarm.forceRegister()
    }
    this.getBot()
    if (!this.session.auth) throw new Error('Auth belum siap, bot belum terhubung')
    if (!this.config.auth.enabled) throw new Error('auth.enabled=false di config, register tidak dikirim')
    if (!this.session.auth.forceRegister()) {
      this.logger.warn('Register sedang diproses, tunggu sebentar')
      return
    }
    this.logger.info('Command register dikirim ke server')
  }

  async handleSay (text) {
    if (!text) throw new Error('Gunakan: say <teks>')
    if (this.swarm) {
      return this.swarm.say(text)
    }
    const bot = this.getBot(false)
    bot.chat(text)
  }

  _getDialog (session, bot) {
    if (session.dialog) return session.dialog
    if (this.config.build?.biomeMaterials?.enabled === false) return null
    if (this.config.build?.biomeMaterials?.askOwner === false) return null
    const dialog = new OwnerDialog(bot, this.config, this.logger)
    dialog.start()
    session.dialog = dialog
    return dialog
  }

  handleStop () {
    if (this.swarm) {
      return this.swarm.stop('Dihentikan oleh pengguna')
    }
    this.session.dialog?.cancel('Dihentikan oleh pengguna')
    const stopped = this.session.jobs.stop('Dihentikan oleh pengguna')
    try { this.session.bot?.pathfinder?.stop() } catch {}
    if (this.session.builder) this.session.builder.paused = false
    if (stopped) this.logger.info('Job dihentikan')
    else this.logger.info('Tidak ada job yang berjalan')
  }
}

module.exports = { Cli, parseCommandLine, resolveBlueprintPath, HELP }
