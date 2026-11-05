'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const Vec3 = require('vec3')
const {
  ArrowDodger,
  isArrowEntity,
  arrowVelocity,
  simulatePath,
  escapeDirection,
  arrowThreat,
  chooseControls,
  entityDrawingBow
} = require('../src/safety/dodge')

const silentLogger = { info () {}, warn () {}, debug () {}, error () {} }

function arrow (id, position, velocity) {
  return { id, name: 'arrow', position: new Vec3(position[0], position[1], position[2]), velocity: new Vec3(velocity[0], velocity[1], velocity[2]) }
}

function fakeBot (options = {}) {
  const controls = []
  const bot = {
    entity: {
      id: 1,
      position: new Vec3(0, 64, 0),
      height: 1.8,
      yaw: options.yaw || 0
    },
    entities: {},
    controls,
    setControlState (name, state) { controls.push([name, state]) },
    heldItem: null
  }
  return bot
}

test('isArrowEntity mengenali semua jenis panah', () => {
  assert.equal(isArrowEntity({ name: 'arrow', position: new Vec3(0, 0, 0) }), true)
  assert.equal(isArrowEntity({ name: 'spectral_arrow', position: new Vec3(0, 0, 0) }), true)
  assert.equal(isArrowEntity({ name: 'minecraft:arrow', position: new Vec3(0, 0, 0) }), true)
  assert.equal(isArrowEntity({ name: 'zombie', position: new Vec3(0, 0, 0) }), false)
  assert.equal(isArrowEntity({ name: 'arrow' }), false)
})

test('simulatePath mengikuti drag dan gravitasi per tick', () => {
  const path = simulatePath(new Vec3(0, 10, 0), new Vec3(1, 0, 0), { ticks: 3 })
  assert.equal(path.length, 3)
  assert.equal(path[0].position.y, 10)
  // Urutan server: posisi bertambah dulu, gravitasi mengubah kecepatan setelahnya.
  assert.equal(path[1].position.y, 10)
  assert.ok(Math.abs(path[2].position.y - 9.95) < 1e-9)
  // Kecepatan turun ikut teredam: bukan 2 x 0.05.
  // Kecepatan turun ikut teredam: bukan 2 x 0.05.
  assert.ok(Math.abs(path[2].position.y - path[1].position.y + 0.05) < 1e-9)
  assert.ok(path[2].position.x > path[1].position.x)
})

test('arrowVelocity memakai velocity server, atau selisih posisi bila kosong', () => {
  const fromPacket = arrowVelocity(arrow(1, [0, 10, 0], [1, 0, 0]))
  assert.equal(fromPacket.x, 1)

  const stale = { id: 2, name: 'arrow', position: new Vec3(3, 10, 0), velocity: new Vec3(0, 0, 0) }
  const derived = arrowVelocity(stale, new Vec3(1, 10, 0), 50)
  assert.ok(Math.abs(derived.x - 2) < 1e-9, 'dua blok per tick')
  assert.equal(arrowVelocity(stale, null, 50), null)
})

test('panah yang membidik badan terdeteksi sebagai ancaman', () => {
  const self = { position: new Vec3(0, 64, 0), height: 1.8 }
  const flying = arrow(5, [5, 65, 0], [-1, 0, 0])
  const threat = arrowThreat(flying, self, { hitRadius: 0.55, ticks: 40 })

  assert.ok(threat, 'harus dianggap ancaman')
  assert.ok(threat.tick > 0 && threat.tick < 10, `tabrak dalam ${threat.tick} tick`)
  assert.ok(threat.distance < 0.6)
  // Arah mengelak tegak lurus lintasan (sumbu z), bukan searah panah.
  assert.ok(Math.abs(threat.direction.x) < 0.01)
  assert.ok(Math.abs(Math.abs(threat.direction.z) - 1) < 0.01)
  assert.ok(Math.abs(threat.direction.y) < 1e-9)
})

test('panah yang lewat di samping, di atas kepala, atau menjauh tidak dihindari', () => {
  const self = { position: new Vec3(0, 64, 0), height: 1.8 }
  const options = { hitRadius: 0.55, ticks: 40 }

  assert.equal(arrowThreat(arrow(5, [5, 65, 2], [-1, 0, 0]), self, options), null, 'lewat 2 blok di samping')
  assert.equal(arrowThreat(arrow(6, [5, 68, 0], [-1, 0, 0]), self, options), null, 'lewat di atas kepala')
  assert.equal(arrowThreat(arrow(7, [5, 65, 0], [1, 0, 0]), self, options), null, 'terbang menjauh')
})

test('panah yang jatuh ke tanah sebelum sampai tidak dihindari', () => {
  const self = { position: new Vec3(0, 64, 0), height: 1.8 }
  // Ditembak dari jauh dan rendah: jatuh menghantam tanah 3 blok di depan bot.
  const falling = arrow(8, [20, 64.6, 0], [-0.7, -0.15, 0])
  const threat = arrowThreat(falling, self, { hitRadius: 0.55, ticks: 40 })
  assert.equal(threat, null)
})

test('arah mengelak selalu memilih sisi yang menjauh dari garis tembakan', () => {
  const velocity = new Vec3(-1, 0, 0)
  const center = new Vec3(0, 65, 0)

  // Panah melintas di sisi +z bot, jadi bot menggeser ke -z (sisi seberang).
  const fromPlusZ = escapeDirection(new Vec3(5, 65, 0.4), velocity, center)
  const fromMinusZ = escapeDirection(new Vec3(5, 65, -0.4), velocity, center)

  assert.ok(fromPlusZ.z < -0.9, 'digeser ke sisi seberang panah')
  assert.ok(fromMinusZ.z > 0.9)
  assert.ok(Math.abs(fromPlusZ.x) < 0.01)
  assert.ok(Math.abs(fromMinusZ.x) < 0.01)
})

test('chooseControls menerjemahkan arah dunia ke tombol gerak sesuai yaw', () => {
  // Yaw 0 = menghadap -z, jadi +x adalah kanan.
  assert.deepEqual(chooseControls(0, new Vec3(1, 0, 0)), ['right'])
  assert.deepEqual(chooseControls(0, new Vec3(-1, 0, 0)), ['left'])
  assert.deepEqual(chooseControls(0, new Vec3(0, 0, -1)), ['forward'])
  assert.deepEqual(chooseControls(0, new Vec3(0, 0, 1)), ['back'])
  // Menyerong: dua tombol sekaligus supaya geseran lebih jauh.
  const diagonal = chooseControls(0, new Vec3(1, 0, -1).normalize())
  assert.equal(diagonal.length, 2)
  assert.ok(diagonal.includes('right') && diagonal.includes('forward'))
})

test('entityDrawingBow hanya percaya metadata kalau lawan memegang busur', () => {
  assert.equal(entityDrawingBow({ heldItem: { name: 'bow' }, metadata: [] }), false)
  assert.equal(entityDrawingBow({ heldItem: { name: 'bow' }, metadata: [0, 0, 0, 0, 0, 0, 0, 1] }), true)
  assert.equal(entityDrawingBow({ heldItem: { name: 'crossbow' }, metadata: [0, 0, 0, 0, 0, 0, 0, 1] }), true)
  assert.equal(entityDrawingBow({ heldItem: { name: 'diamond_sword' }, metadata: [0, 0, 0, 0, 0, 0, 0, 1] }), false)
})

test('ArrowDodger menggeser badan sekali lalu jeda sebelum mengelak lagi', () => {
  const bot = fakeBot()
  const flying = arrow(5, [5, 65, 0], [-1, 0, 0])
  bot.entities[5] = flying

  const dodger = new ArrowDodger(bot, { safety: { arrowDodge: { tickMs: 20, dodgeMs: 200, cooldownMs: 500 } } }, silentLogger)

  const first = dodger.update(1000)
  assert.ok(first, 'ancaman pertama harus ditanggapi')
  assert.equal(first.kind, 'arrow')
  assert.ok(first.controls.length >= 1)
  assert.deepEqual(bot.controls.at(-1), [first.controls[0], true])
  assert.equal(dodger.stats.dodges, 1)

  // Masih dalam masa mengelak: jangan tekan tombol lain.
  assert.equal(dodger.update(1100), null)
  assert.equal(dodger.stats.dodges, 1)

  dodger.release()
  assert.deepEqual(bot.controls.at(-1), [first.controls[0], false])

  // Setelah cooldown, ancaman yang sama dihindari lagi.
  assert.ok(dodger.update(2000))
  assert.equal(dodger.stats.dodges, 2)
  dodger.stop()
})

test('ArrowDodger menggeser badan saat lawan menarik busur ke arahnya', () => {
  const bot = fakeBot()
  bot.entities[9] = {
    id: 9,
    name: 'skeleton',
    position: new Vec3(8, 64, 0),
    height: 1.9,
    heldItem: { name: 'bow' },
    metadata: [0, 0, 0, 0, 0, 0, 0, 1]
  }

  const dodger = new ArrowDodger(bot, { safety: { arrowDodge: { tickMs: 20, dodgeMs: 200, cooldownMs: 0 } } }, silentLogger)
  const reaction = dodger.update(1000)

  assert.ok(reaction, 'harus bereaksi sebelum panah lahir')
  assert.equal(reaction.kind, 'draw')
  assert.equal(dodger.stats.preempts, 1)
  // Digeser ke samping garis tembakan (sumbu z), bukan menjauh/maju.
  assert.ok(Math.abs(reaction.direction.x) < 0.01)
  assert.ok(Math.abs(Math.abs(reaction.direction.z) - 1) < 0.01)
  dodger.stop()
})

test('ArrowDodger mengabaikan panah di luar jangkauan dan saat dinonaktifkan', () => {
  const bot = fakeBot()
  bot.entities[5] = arrow(5, [40, 65, 0], [-1, 0, 0])
  const far = new ArrowDodger(bot, { safety: { arrowDodge: { detectRange: 16 } } }, silentLogger)
  assert.equal(far.update(1000), null)

  bot.entities[6] = arrow(6, [5, 65, 0], [-1, 0, 0])
  const off = new ArrowDodger(bot, { safety: { arrowDodge: { enabled: false } } }, silentLogger)
  assert.equal(off.update(1000), null)
  assert.equal(off.stats.dodges, 0)
})
