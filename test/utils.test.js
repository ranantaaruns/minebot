'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const Vec3 = require('vec3')

const { parseCoordinates } = require('../src/owner')
const { classifyAuthMessage, fillCommand, cleanText } = require('../src/auth')
const { parseCommandLine } = require('../src/cli')
const { orderActions } = require('../src/build/order')
const { stateKey, posKey } = require('../src/blueprint')

test('parseCoordinates reads keyed, plain and colored messages', () => {
  assert.deepEqual(parseCoordinates('x: 10 y: -64 z: 200'), new Vec3(10, -64, 200))
  assert.deepEqual(parseCoordinates('X=1.5 Y=2 Z=-3.25'), new Vec3(1.5, 2, -3.25))
  assert.deepEqual(parseCoordinates('pos 12, 64, -7'), new Vec3(12, 64, -7))
  assert.deepEqual(parseCoordinates('§aKoordinat: 1 2 3'), new Vec3(1, 2, 3))
  assert.equal(parseCoordinates('tidak ada koordinat'), null)
  assert.equal(parseCoordinates(''), null)
})

test('classifyAuthMessage recognizes auth prompts', () => {
  const config = {
    loginPatterns: ['login', 'masuk'],
    registerPatterns: ['register', 'daftar'],
    alreadyRegisteredPatterns: ['already registered', 'sudah terdaftar'],
    loggedInPatterns: ['successfully logged in', 'berhasil login']
  }

  assert.equal(classifyAuthMessage('Please register with /register', config), 'register')
  assert.equal(classifyAuthMessage('Silakan daftar dulu', config), 'register')
  assert.equal(classifyAuthMessage('Please login with /login', config), 'login')
  assert.equal(classifyAuthMessage('You are already registered', config), 'already-registered')
  assert.equal(classifyAuthMessage('Successfully logged in!', config), 'logged-in')
  assert.equal(classifyAuthMessage('Welcome to the server', config), null)
})

test('fillCommand substitutes every password placeholder', () => {
  assert.equal(fillCommand('/register {password} {password}', 'rahasia'), '/register rahasia rahasia')
  assert.equal(fillCommand('/login {password}', 'rahasia'), '/login rahasia')
  assert.equal(cleanText('§aHello   World'), 'hello world')
})

test('parseCommandLine supports quotes and flags', () => {
  assert.deepEqual(parseCommandLine('build rumah.schem --at 1 2 3'), {
    cmd: 'build',
    args: ['rumah.schem', '--at', '1', '2', '3'],
    raw: 'build rumah.schem --at 1 2 3'
  })
  assert.deepEqual(parseCommandLine('say "halo dunia"'), {
    cmd: 'say',
    args: ['halo dunia'],
    raw: 'say "halo dunia"'
  })
  assert.deepEqual(parseCommandLine('   '), { cmd: '', args: [], raw: '' })
})

test('stateKey and posKey are stable', () => {
  assert.equal(stateKey('minecraft:oak_stairs', { facing: 'east', half: 'bottom' }), 'minecraft:oak_stairs[facing=east,half=bottom]')
  assert.equal(stateKey('minecraft:stone', {}), 'minecraft:stone')
  assert.equal(posKey(-1, 2, 3), '-1,2,3')
})

test('orderActions builds layer by layer from the nearest z row', () => {
  const actions = [
    { pos: new Vec3(1, 0, 5) },
    { pos: new Vec3(0, 0, 0) },
    { pos: new Vec3(1, 0, 0) },
    { pos: new Vec3(0, 1, 0) },
    { pos: new Vec3(0, 0, 3) }
  ]

  const ordered = orderActions(actions, new Vec3(0, 0, 1))
  assert.deepEqual(
    ordered.map(action => `${action.pos.x},${action.pos.y},${action.pos.z}`),
    ['0,0,0', '1,0,0', '0,0,3', '1,0,5', '0,1,0']
  )
})
