let { existsSync } = require('fs')
let { readFile } = require('fs').promises
let { join } = require('path')

let MyError = require('./my-error')

let SECRETS_FILE = join(__dirname, '..', 'secrets.json')

async function loadSecrets () {
  if (!existsSync(SECRETS_FILE)) {
    throw new MyError('Decrypt token file with `yarn decrypt`')
  }
  return JSON.parse(await readFile(SECRETS_FILE))
}

module.exports = loadSecrets
