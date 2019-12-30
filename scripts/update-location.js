#!/usr/bin/env node

let { writeFile, mkdir } = require('fs').promises
let { join, dirname } = require('path')
let { existsSync } = require('fs')
let dotenv = require('dotenv')

let MyError = require('./lib/my-error')
let read = require('./lib/read')
let get = require('./lib/get')

dotenv.config()

const LAST = join(__dirname, 'location', 'last.json')
const RU = join(__dirname, '..', 'dist', 'ru', 'index.html')
const EN = join(__dirname, '..', 'dist', 'en', 'index.html')

async function loadLocation () {
  return get('https://evilmartians.com/locations/ai')
}

async function wasNotChanged (cur) {
  if (!existsSync(LAST)) return false
  let last = JSON.parse(await read(LAST))
  if (cur.latitude === last.latitude && cur.longitude === last.longitude) {
    process.stdout.write('Location was not changed\n')
    return true
  } else {
    return false
  }
}

async function saveLast (location) {
  if (!existsSync(dirname(LAST))) {
    await mkdir(dirname(LAST))
  }
  await writeFile(LAST, JSON.stringify(location))
}

async function processCity (token, html, location) {
  let lang = html.includes(' lang="ru"') ? 'ru' : 'en'

  let geodata = await get(
    'https://maps.googleapis.com/maps/api/geocode/json' +
    `?latlng=${ location.latitude },${ location.longitude }` +
    `&language=${ lang }` +
    `&key=${ token }`
  )
  if (!geodata.results[0]) {
    console.error(geodata)
    throw new Error('Bad responce from Google')
  }
  let address = geodata.results[0].address_components
  let country = address.find(i => i.types.includes('country'))
  let city = address.find(i => i.types.includes('locality'))

  if (country.short_name === 'JP') {
    if (address.find(i => i.short_name === 'Tōkyō-to')) {
      city = { long_name: lang === 'ru' ? 'Токио' : 'Tokyo' }
    }
  } else if (country.short_name === 'US') {
    country = { long_name: lang === 'ru' ? 'США' : 'USA' }
  }
  if (!city) {
    city = address.find(i => i.types.includes('administrative_area_level_1'))
  }
  if (city.long_name === 'New York' && lang === 'ru') {
    city.long_name = 'Нью-Йорк'
  }

  process.stdout.write(`${ city.long_name }, ${ country.long_name }\n`)

  html = html
    .replace(
      /<([^>]+) itemprop="addressLocality"([^>]?)>[^<]+<\/([^>]+)>/,
      `<$1 itemprop="addressLocality"$2>${ city.long_name }</$3>`
    )
    .replace(
      /<([^>]+) itemprop="addressCountry"([^>]?)>[^<]+<\/([^>]+)>/,
      `<$1 itemprop="addressLocality"$2>${ country.long_name }</$3>`
    )
    .replace(/ data-lat="([^"])+"/, ` data-lat="${ location.latitude }"`)
    .replace(/ data-lng="([^"])+"/, ` data-lng="${ location.longitude }"`)

  await writeFile(lang === 'ru' ? RU : EN, html)
}

Promise
  .all([read(RU), read(EN), loadLocation()])
  .then(async ([htmlRu, htmlEn, location]) => {
    if (await wasNotChanged(location)) return
    await Promise.all([
      processCity(process.env.GMAPS_TOKEN, htmlRu, location),
      processCity(process.env.GMAPS_TOKEN, htmlEn, location)
    ])
    await saveLast(location)
  })
  .catch(MyError.print)