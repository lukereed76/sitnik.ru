#!/usr/bin/env node

let { writeFile, readFile, copyFile, unlink } = require('fs').promises
let { basename, extname, join } = require('path')
let { nodeResolve } = require('@rollup/plugin-node-resolve')
let rollupCommonJS = require('@rollup/plugin-commonjs')
let { existsSync } = require('fs')
let { promisify } = require('util')
let combineMedia = require('postcss-combine-media-query')
let stripDebug = require('strip-debug')
let { terser } = require('rollup-plugin-terser')
let { rollup } = require('rollup')
let posthtml = require('posthtml')
let Bundler = require('parcel-bundler')
let postcss = require('postcss')
let crypto = require('crypto')
let dotenv = require('dotenv')
let zlib = require('zlib')
let del = require('del')

let gzip = promisify(zlib.gzip)

dotenv.config()

const A = 'a'.charCodeAt(0)
const SRC = join(__dirname, '..', 'src')
const DIST = join(__dirname, '..', 'dist')
const NGINX = join(__dirname, '..', 'nginx.conf')
const EARTH = join(SRC, 'earth')
const FAVICON = join(SRC, 'base', 'favicon.ico')
const LOCATION = join(__dirname, 'location', 'last.json')
const ROOT_INDEX = join(DIST, 'index.html')

async function cleanBuildDir () {
  await del(join(DIST, '*'), { dot: true })
}

function findAssets (bundle) {
  return Array.from(bundle.childBundles).reduce(
    (all, i) => {
      return all.concat(findAssets(i))
    },
    [bundle.name]
  )
}

function sha256 (string) {
  return crypto.createHash('sha256').update(string, 'utf8').digest('base64')
}

function replaceAll (str, from, to) {
  return str.replace(new RegExp(from, 'g'), to)
}

let bundler = new Bundler(join(SRC, 'index.pug'), { sourceMaps: false })

async function build () {
  await cleanBuildDir()
  let plugins = [nodeResolve(), rollupCommonJS(), terser()]
  let [bundle, indexBundle, workerBundle] = await Promise.all([
    bundler.bundle(),
    rollup({ input: join(SRC, 'index.js'), plugins }),
    rollup({ input: join(SRC, 'earth', 'worker.js'), plugins })
  ])
  await unlink(ROOT_INDEX)

  let assets = findAssets(bundle)

  let cssFile = assets.find(i => extname(i) === '.css')
  let mapFile = assets.find(i => /map\..*\.webp/.test(i))
  let hereFile = assets.find(i => /here\..*\.webp/.test(i))
  let srcJsFile = assets.find(i => /src\..*\.js/.test(i))
  let workerFile = assets.find(i => /worker\..*\.js/.test(i))

  let [indexOutput, workerOutput] = await Promise.all([
    indexBundle.generate({ format: 'iife', strict: false }),
    workerBundle.generate({ format: 'iife', strict: false })
  ])
  let js = indexOutput.output[0].code.trim()
  let worker = workerOutput.output[0].code.trim()

  let [css, nginx] = await Promise.all([
    readFile(cssFile).then(i => i.toString()),
    readFile(NGINX).then(i => i.toString()),
    copyFile(join(EARTH, 'here.png'), hereFile.replace('webp', 'png')),
    copyFile(join(EARTH, 'map.png'), mapFile.replace('webp', 'png')),
    copyFile(FAVICON, join(DIST, 'favicon.ico')),
    unlink(srcJsFile)
  ])

  js = js
    .replace(/var /g, 'let ')
    .replace(/function\s*\((\w+)\)/g, '$1=>')
    .replace(/}\(\);$/, '}()')
    .replace(/\w+\("\[as=script]"\)\.href/, `"/${basename(workerFile)}"`)
    .replace(/\w+\("[^"]+\[href\*=map]"\)\.href/, `"/${basename(mapFile)}"`)
    .replace(/\w+\("[^"]+\[href\*=here]"\)\.href/, `"/${basename(hereFile)}"`)
  worker = worker
    .replace(/\/\/ .*?\\n/g, '\\n')
    .replace(/\s\/\/.*?\\n/g, '\\n')
    .replace(/((\\t)+\\n)+/g, '')
    .replace(/(\\n)+/g, '\\n')
    .replace(/TypeError("[^"]+")/g, 'TypeError("TypeError")')
    .replace(/(\n)+/g, '\n')
    .replace(/{aliceblue[^}]+}/, '{}')
  worker = stripDebug(worker).toString()

  let location = {}
  if (existsSync(LOCATION)) {
    location = JSON.parse(await readFile(LOCATION))
  }
  let simpleLocation = JSON.stringify({
    latitude: location.latitude,
    longitude: location.longitude
  })

  await Promise.all([
    writeFile(join(DIST, 'location.json'), simpleLocation),
    writeFile(workerFile, worker),
    unlink(cssFile)
  ])

  let classes = {}
  let lastUsed = -1

  function cssPlugin (root) {
    root.walkRules(rule => {
      rule.selector = rule.selector.replace(/\.[\w-]+/g, str => {
        let kls = str.substr(1)
        if (!classes[kls]) {
          lastUsed += 1
          if (lastUsed === 26) lastUsed -= 26 + 7 + 25
          classes[kls] = String.fromCharCode(A + lastUsed)
        }
        return '.' + classes[kls]
      })
    })
  }

  css = postcss([cssPlugin, combineMedia]).process(css, { from: cssFile }).css

  for (let origin in classes) {
    let converted = classes[origin]
    if (origin.startsWith('earth') || origin.startsWith('globe')) {
      js = replaceAll(js, `".${origin}"`, `".${converted}"`)
    }
    if (origin.startsWith('is-')) {
      js = replaceAll(js, `"${origin}"`, `"${converted}"`)
    }
  }

  nginx = nginx
    .replace(/(style-src 'sha256-)[^']+'/g, `$1${sha256(css)}'`)
    .replace(/(script-src 'sha256-)[^']+'/g, `$1${sha256(js)}'`)
  await writeFile(NGINX, nginx)

  function htmlPlugin (tree) {
    tree.match({ tag: 'link', attrs: { rel: 'stylesheet' } }, () => {
      return { tag: 'style', content: css }
    })
    tree.match({ tag: 'link', attrs: { rel: 'preload' } }, i => {
      if (i.attrs.as === 'script' || i.attrs.as === 'image') {
        return false
      } else {
        return i
      }
    })
    tree.match({ tag: 'script' }, i => {
      if (i.attrs.src && i.attrs.src.includes('/src.')) {
        return {
          tag: 'script',
          content: js
        }
      } else {
        return i
      }
    })
    tree.match({ tag: 'a', attrs: { href: /^\/\w\w\/index.html$/ } }, i => {
      return {
        tag: 'a',
        content: i.content,
        attrs: {
          ...i.attrs,
          href: i.attrs.href.replace('index.html', '')
        }
      }
    })
    tree.match({ attrs: { class: true } }, i => {
      return {
        tag: i.tag,
        content: i.content,
        attrs: {
          ...i.attrs,
          class: i.attrs.class
            .split(' ')
            .map(kls => {
              if (!classes[kls]) {
                process.stderr.write(`Unused class .${kls}\n`)
                process.exit(1)
              }
              return classes[kls]
            })
            .join(' ')
        }
      }
    })
  }

  let uncompressable = { '.png': true, '.webp': true, '.jpg': true }
  await Promise.all(
    assets
      .concat([join(DIST, 'favicon.ico'), join(DIST, 'location.json')])
      .filter(i => !uncompressable[extname(i)] && i !== ROOT_INDEX)
      .filter(i => existsSync(i))
      .map(async path => {
        let file = await readFile(path)
        if (extname(path) === '.html') {
          file = posthtml().use(htmlPlugin).process(file, { sync: true }).html
          await writeFile(path, file)
        }
        let compressed = await gzip(file, { level: 9 })
        await writeFile(path + '.gz', compressed)
      })
  )
}

build().catch(e => {
  process.stderr.write(e.stack + '\n')
  process.exit(1)
})
