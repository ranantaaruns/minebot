'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('events')
const { OwnerDialog, normalizeAnswer, matchChoice } = require('../src/owner-dialog')
const { Cancellation, CancelledError } = require('../src/util/async')

const silentLogger = {
  info () {},
  warn () {},
  debug () {},
  error () {}
}

function fakeBot () {
  const bot = new EventEmitter()
  bot.username = 'BuilderBot'
  bot.sent = []
  bot.whisper = (username, message) => bot.sent.push(['whisper', username, message])
  bot.chat = message => bot.sent.push(['chat', message])
  return bot
}

function dialogConfig () {
  return { owner: { username: 'Owner' } }
}

test('OwnerDialog asks the owner and resolves a whisper answer', async t => {
  const bot = fakeBot()
  const dialog = new OwnerDialog(bot, dialogConfig(), silentLogger)
  dialog.start()
  t.after(() => dialog.stop())

  const answer = dialog.ask('Pilih material?')
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(bot.sent[0], ['whisper', 'Owner', 'Pilih material?'])

  bot.emit('whisper', 'Owner', 'ganti')
  assert.equal(await answer, 'ganti')
})

test('OwnerDialog ignores other players and keeps waiting', async t => {
  const bot = fakeBot()
  const dialog = new OwnerDialog(bot, dialogConfig(), silentLogger)
  dialog.start()
  t.after(() => dialog.stop())

  const answer = dialog.ask('Pilih?')
  await new Promise(resolve => setImmediate(resolve))
  bot.emit('whisper', 'SomeoneElse', '1')
  bot.emit('chat', 'Owner', '2')

  assert.equal(await answer, '2')
})

test('OwnerDialog.choose retries unknown answers', async t => {
  const bot = fakeBot()
  const dialog = new OwnerDialog(bot, dialogConfig(), silentLogger)
  dialog.start()
  t.after(() => dialog.stop())

  const chosen = dialog.choose('Pilih?', [
    { key: '1', aliases: ['ganti'], value: 'replace' },
    { key: '2', aliases: ['tetap'], value: 'keep' }
  ])
  await new Promise(resolve => setImmediate(resolve))
  bot.emit('whisper', 'Owner', 'apa')
  await new Promise(resolve => setImmediate(resolve))
  bot.emit('whisper', 'Owner', '1')

  assert.equal((await chosen).value, 'replace')
  assert.ok(bot.sent.some(([, , message]) => /Jawaban tidak dikenal/.test(message)))
})

test('OwnerDialog.cancel rejects a pending question', async t => {
  const bot = fakeBot()
  const dialog = new OwnerDialog(bot, dialogConfig(), silentLogger)
  dialog.start()
  t.after(() => dialog.stop())

  const answer = dialog.ask('Pilih?')
  dialog.cancel('stop dari test')

  await assert.rejects(answer, err => {
    assert.ok(err instanceof CancelledError)
    assert.equal(err.message, 'stop dari test')
    return true
  })
})

test('OwnerDialog honors job cancellation while waiting', async t => {
  const bot = fakeBot()
  const dialog = new OwnerDialog(bot, dialogConfig(), silentLogger)
  dialog.start()
  t.after(() => dialog.stop())

  const cancellation = new Cancellation()
  const answer = dialog.ask('Pilih?', { cancellation })
  cancellation.cancel('job berhenti')

  await assert.rejects(answer, err => {
    assert.ok(err instanceof CancelledError)
    assert.equal(err.message, 'job berhenti')
    return true
  })
})

test('normalizeAnswer and matchChoice strip formatting and match aliases', () => {
  assert.equal(normalizeAnswer('  §aGANTI '), 'ganti')
  const choice = matchChoice('Tetap', [{ key: '2', aliases: ['tetap'] }])
  assert.equal(choice.key, '2')
  assert.equal(matchChoice('nope', [{ key: '1' }]), null)
})
