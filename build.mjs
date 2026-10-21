import { build } from 'esbuild'
import fs from 'fs'
const r = await build({ entryPoints: ['src/main.jsx'], bundle: true, minify: true, write: false, format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' }, legalComments: 'none', target: 'es2020' })
let js = r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')
const html = fs.readFileSync('src/template.html', 'utf8').replace('/*BUNDLE*/', () => js)
fs.mkdirSync('dist', { recursive: true })
fs.writeFileSync('dist/khom-diorama.html', html)
console.log('bytes', html.length)
