#!/usr/bin/env node

const fs = require('fs')
const path = require('path')

const DELTA = 0x9e3779b9

function toUint32Array(bytes, includeLength) {
  const length = bytes.length
  let n = length >> 2
  if ((length & 3) !== 0) n += 1

  const words = new Uint32Array(includeLength ? n + 1 : n)
  if (includeLength) words[n] = length

  for (let i = 0; i < length; ++i) {
    words[i >> 2] |= bytes[i] << ((i & 3) << 3)
  }
  return words
}

function toUint8Array(words, includeLength) {
  const wordLength = words.length
  let byteLength = wordLength << 2

  if (includeLength) {
    const declaredLength = words[wordLength - 1]
    byteLength -= 4
    if (declaredLength < byteLength - 3 || declaredLength > byteLength) {
      throw new Error('invalid xxtea plaintext length')
    }
    byteLength = declaredLength
  }

  const bytes = new Uint8Array(byteLength)
  for (let i = 0; i < byteLength; ++i) {
    bytes[i] = words[i >> 2] >>> ((i & 3) << 3)
  }
  return bytes
}

function mx(sum, y, z, p, e, k) {
  return (((z >>> 5) ^ (y << 2)) + ((y >>> 3) ^ (z << 4))) ^
    ((sum ^ y) + (k[(p & 3) ^ e] ^ z))
}

function fixedKey(key) {
  if (key.length >= 16) return key
  const padded = new Uint8Array(16)
  padded.set(key)
  return padded
}

function decrypt(data, key) {
  if (!data || data.length === 0) return new Uint8Array()

  const words = toUint32Array(data, false)
  const k = toUint32Array(fixedKey(key), false)
  const n = words.length - 1
  const rounds = Math.floor(6 + 52 / words.length)

  let y = words[0]
  let z
  let sum = rounds * DELTA

  while (sum !== 0) {
    const e = (sum >>> 2) & 3
    for (let p = n; p > 0; --p) {
      z = words[p - 1]
      y = words[p] -= mx(sum, y, z, p, e, k)
    }
    z = words[n]
    y = words[0] -= mx(sum, y, z, 0, e, k)
    sum -= DELTA
  }

  return toUint8Array(words, true)
}

function decryptFile(inputPath, outputPath) {
  const encrypted = new Uint8Array(fs.readFileSync(inputPath))
  const plaintext = decrypt(encrypted, Buffer.from('0Aed5E79bbEa69f8', 'utf8'))
  const text = new TextDecoder().decode(plaintext)
  fs.writeFileSync(outputPath, text)
  return { encryptedBytes: encrypted.length, plaintextBytes: plaintext.length, text }
}

function main() {
  const args = process.argv.slice(2)
  const files = args.length
    ? args
    : ['game/index.3cf1d.jsc', 'launcher/index.9706c.jsc', 'TEST_REMOTE_MODULE/index.dfe5b.jsc']

  for (const file of files) {
    const inputPath = path.resolve(file)
    const outputPath = inputPath.replace(/\.jsc$/i, '.js')
    const result = decryptFile(inputPath, outputPath)
    console.log(
      `${path.basename(inputPath)} -> ${path.basename(outputPath)} ` +
      `(${result.encryptedBytes} -> ${result.plaintextBytes} bytes): ` +
      JSON.stringify(result.text.slice(0, 120))
    )
  }
}

main()
