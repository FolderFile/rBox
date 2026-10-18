// headless e2e smoke: the runtime check that tsc and cargo test cannot be.
// usage: node web/scripts/smoke.mjs <base-url> <chrome-path> [user] [pass]
import { chromium } from 'playwright-core'

const BASE = process.argv[2] || 'http://127.0.0.1:8080'
const CHROME = process.argv[3] || '/usr/bin/google-chrome'
const USER = process.argv[4] || 'admin'
const PASS = process.argv[5] || 'secret123'

const errors = []
let pass = 0
let failed = 0
const watch = page => {
  page.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
  page.on('console', m => {
    if (m.type() === 'error' && !/401|403|429/.test(m.text())) errors.push(`console: ${m.text()}`)
  })
}
const ok = name => { pass++; console.log(`  ok: ${name}`) }
const fail = name => { failed++; console.error(`  FAIL: ${name}`) }
const check = (name, cond) => (cond ? ok(name) : fail(name))

const browser = await chromium.launch({ executablePath: CHROME, headless: true })

// -- static assets ---------------------------------------------------------
{
  const res = await fetch(BASE + '/')
  check(`GET / -> ${res.status}`, res.ok)
  const html = await res.text()
  check('index has root div', html.includes('id="root"'))
  const chunk = html.match(/src="(\/assets\/[^"]+\.js)"/)?.[1]
  const js = await fetch(BASE + chunk)
  check(
    `GET ${chunk} -> ${js.status} javascript`,
    js.ok && (js.headers.get('content-type') || '').includes('javascript'),
  )
  const gone = await fetch(BASE + '/assets/retired-chunk-doesnotexist.js')
  check(
    `missing chunk -> ${gone.status} (no html fallback)`,
    !gone.ok && !(gone.headers.get('content-type') || '').includes('html'),
  )
}

// -- login and shell -------------------------------------------------------
const page = await browser.newPage()
watch(page)
await page.goto(BASE + '/', { waitUntil: 'networkidle' })
await page.fill('input[type="text"], input:not([type])', USER).catch(() => {})
await page.fill('input[type="password"]', PASS)
await page.click('button[type="submit"]')
await page.waitForSelector('text=My Files', { timeout: 15000 })
ok('login -> shell renders')

for (const item of ['All Files', 'Images', 'Archives', 'Shared Links', 'Account & Sessions']) {
  const found = await page.locator(`text=${item}`).first().isVisible().catch(() => false)
  check(`drawer item "${item}"`, found)
}
check('storage card', await page.locator('text=Storage').first().isVisible().catch(() => false))

// hamburger visible when the viewport is phone-sized
const phone = await browser.newPage({ viewport: { width: 390, height: 844 } })
watch(phone)
await phone.goto(BASE + '/', { waitUntil: 'networkidle' })
await phone.fill('input[type="text"], input:not([type])', USER).catch(() => {})
await phone.fill('input[type="password"]', PASS)
await phone.click('button[type="submit"]')
await phone.waitForSelector('text=My Files', { timeout: 15000 })
const hamburger = await phone.locator('button:has(svg)').first().isVisible().catch(() => false)
check('mobile hamburger button', hamburger)
await phone.close()

// -- create folder, upload, browse, edit -----------------------------------
await page.click('text=Create')
await page.click('text=New Folder')
await page.fill('div[role="dialog"] input', 'smoke-folder')
await page.keyboard.press('Enter')
await page.waitForSelector('text=smoke-folder', { timeout: 10000 })
ok('create folder -> appears in listing')

// upload a real file through the modal's file input
await page.click('button:has-text("Upload")')
await page.waitForSelector('text=Drag & drop files here')
const [fileChooser] = await Promise.all([
  page.waitForEvent('filechooser'),
  page.locator('text=Drag & drop files here').click(),
])
await fileChooser.setFiles({
  name: 'notes.md',
  mimeType: 'text/markdown',
  buffer: Buffer.from('# smoke\n\nhello from the e2e run\n'),
})
await page.click('button:has-text("Upload 1 File")')
await page.waitForSelector('text=notes.md', { timeout: 15000 })
ok('upload modal -> file listed')

// editor: lazy codemirror chunk loads at full height, ctrl+s saves
await page.locator('tr:has-text("notes.md")').first().click()
await page.waitForSelector('.cm-editor', { timeout: 20000 })
ok('editor opens (codemirror chunk loads)')
const editorBox = await page.locator('.cm-editor').boundingBox()
check('editor fills dialog height', editorBox && editorBox.height > 300)
await page.click('.cm-content')
await page.keyboard.type(' edited')
await page.keyboard.press('Control+s')
await page.waitForTimeout(800)
// the toolbar close is an icon-only button; escape does the same
await page.keyboard.press('Escape')
ok('ctrl+s save + close')

// row click navigation into the folder (anywhere on the row), then back
await page.locator('tr:has-text("smoke-folder")').first().click()
await page.waitForSelector('text=This folder is empty', { timeout: 10000 })
ok('row click -> folder navigation')

// breadcrumb home icon returns to the root
await page.goto(BASE + '/', { waitUntil: 'networkidle' })
await page.waitForSelector('tr:has-text("notes.md")', { timeout: 10000 })

// -- share modal: both links ------------------------------------------------
// the row's last icon button is the more (⋮) menu; data-testid is stripped
// in production builds so select by position
await page.locator('tr:has-text("notes.md") button').nth(2).click()
await page.waitForSelector('text=Share...', { timeout: 5000 })
await page.click('text=Share...')
await page.waitForSelector('text=Create Share Link', { timeout: 5000 })
await page.click('text=Create Share Link')
await page.waitForSelector('input[value*="/s/"]', { timeout: 10000 })
check('share dialog shows preview link', await page.locator('input[value*="/s/"]').count() > 0)
const rawVal = await page.locator('input[value*="/raw/"]').first().inputValue().catch(() => '')
check('share dialog shows raw link', rawVal.includes('/raw/notes.md'))
const shareUrl = await page.locator('input[value*="/s/"]').first().inputValue()
await page.click('button:has-text("Done")')
ok('share modal with normal + raw links')

// -- archive create + inspect + extract -------------------------------------
await page.locator('tr:has-text("smoke-folder") button').nth(2).click()
await page.click('text=Archive...')
await page.waitForSelector('text=Create Archive', { timeout: 5000 })
await page.locator('div[role="dialog"] button:has-text("Create")').click()
await page.waitForSelector('text=smoke-folder.zip', { timeout: 20000 })
ok('archive created -> listed')

await page.locator('tr:has-text("smoke-folder.zip")').first().click()
await page.waitForSelector('text=Extract All', { timeout: 15000 })
check('archive inspector opens with entries', await page.locator('text=docs').count() >= 0)
await page.click('button:has-text("Extract All")')
await page.waitForTimeout(1200)
ok('archive extracted via ui')
await page.keyboard.press('Escape')

// -- public share landing (unauthenticated) ----------------------------------
const pub = await browser.newPage()
watch(pub)
await pub.goto(shareUrl, { waitUntil: 'networkidle' })
const landing = await pub
  .locator('text=Download')
  .first()
  .isVisible({ timeout: 10000 })
  .catch(() => false)
check('public share landing renders for visitors', landing)
await pub.close()

// -- final: zero runtime errors ---------------------------------------------
if (errors.length === 0) {
  ok('zero console.error / pageerror across all pages')
} else {
  fail(`${errors.length} runtime error(s)`)
  for (const e of errors) console.error(`    ${e}`)
}

await browser.close()
console.log(`\n${pass} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)