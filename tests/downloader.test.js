'use strict'

// Тесты чистых функций downloader.js. Запуск: npm test (node:test, без зависимостей).
const { test } = require('node:test')
const assert = require('node:assert/strict')
const { parseTime, validateUrl, humanizeError } = require('../src/main/downloader')

test('parseTime: пустое значение -> null', () => {
  assert.equal(parseTime(''), null)
  assert.equal(parseTime(null), null)
  assert.equal(parseTime(undefined), null)
})

test('parseTime: голые секунды', () => {
  assert.equal(parseTime('83'), 83)
  assert.equal(parseTime('0'), 0)
  assert.equal(parseTime('12.5'), 12.5)
})

test('parseTime: мм:сс и чч:мм:сс', () => {
  assert.equal(parseTime('1:23'), 83)
  assert.equal(parseTime('01:02:03'), 3723)
  assert.equal(parseTime('0:30'), 30)
})

test('parseTime: мусор -> null', () => {
  assert.equal(parseTime('abc'), null)
  assert.equal(parseTime('1:2:3:4'), null)
  assert.equal(parseTime('1:xx'), null)
})

test('validateUrl: валидные YouTube-ссылки проходят', () => {
  assert.equal(validateUrl('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), null)
  assert.equal(validateUrl('https://youtu.be/dQw4w9WgXcQ'), null)
  assert.equal(validateUrl('https://m.youtube.com/watch?v=abc'), null)
  assert.equal(validateUrl('https://music.youtube.com/watch?v=abc'), null)
})

test('validateUrl: чужие домены и мусор отклоняются', () => {
  assert.ok(validateUrl('https://example.com/watch?v=abc'))
  assert.ok(validateUrl('https://youtube.com.evil.io/watch'))
  assert.ok(validateUrl('not a url'))
  assert.ok(validateUrl(''))
})

test('validateUrl: не-http протоколы отклоняются', () => {
  assert.ok(validateUrl('file:///C:/Windows/system32'))
  assert.ok(validateUrl('ftp://youtube.com/video'))
  assert.ok(validateUrl('javascript:alert(1)'))
})

test('humanizeError: известные ошибки yt-dlp переводятся', () => {
  assert.match(humanizeError('ERROR: Private video', 1), /приватное/i)
  assert.match(humanizeError('ERROR: Video unavailable', 1), /недоступно/i)
  assert.match(humanizeError('Sign in to confirm your age', 1), /возрастное/i)
  assert.match(humanizeError('not available in your country', 1), /региона/i)
})

test('humanizeError: неизвестная ошибка не теряет исходный текст', () => {
  const msg = humanizeError('ERROR: something totally new', 1)
  assert.ok(msg.includes('something totally new'))
})
