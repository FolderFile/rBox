const { chromium } = require('playwright-core')

const BASE = process.argv[2]
const CHROME = process.argv[3]
const USER = process.argv[4] || 'admin'
const PASS = process.argv[5] || 'secret123'

let pass = 0, fail = 0
const ok = m => console.log(`  ok: ${m}`) && pass++
const check = (m, c) => { if (c) { ok(m) } else { console.log(`  FAIL: ${m}`); fail++ } }

async function box(page, sel) {
  return page.locator(sel).first().evaluate(e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right } })
}

async function login(page) {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.fill('input[type="text"], input:not([type])', USER).catch(() => {})
  await page.fill('input[type="password"]', PASS)
  await page.click('button[type="submit"]')
  await page.waitForSelector('button[aria-label="Toggle sidebar"]', { timeout: 15000 })
  await page.waitForTimeout(400)
}

;(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true })
  const errors = []
  const watch = p => {
    p.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
    p.on('console', m => { if (m.type() === 'error' && !/401|403|429/.test(m.text())) errors.push(`console: ${m.text()}`) })
  }

  // ---------- branding: login page + favicons ----------
  {
    const res = await fetch(BASE + '/favicon.png')
    check('favicon.png served', res.ok && (res.headers.get('content-type') || '').includes('png'))
    const ico = await fetch(BASE + '/favicon.ico')
    check('favicon.ico served', ico.ok)
    const logo = await fetch(BASE + '/logo.png')
    check('logo.png served', logo.ok && (logo.headers.get('content-type') || '').includes('png'))
    const html = await (await fetch(BASE + '/')).text()
    check('index links Inter font', html.includes('family=Inter'))
    check('index links JetBrains Mono', html.includes('JetBrains+Mono'))
  }

  const page = await browser.newPage({ viewport: { width: 1366, height: 768 } })
  await page.addInitScript(() => localStorage.setItem('rbox-theme', 'dark'))
  watch(page)
  await page.goto(BASE + '/login', { waitUntil: 'networkidle' })
  check('login page shows logo image', (await page.locator('img[alt*="logo" i]').count()) > 0)
  check('login page shows rBox wordmark', (await page.locator('text=rBox').count()) > 0)

  await login(page)

  // ---------- branding in the shell ----------
  {
    const img = page.locator('nav img[alt*="logo" i]').first()
    check('sidebar header has logo image', (await img.count()) > 0)
    if (await img.count()) {
      const b = await img.boundingBox()
      check('logo renders at ~28px', b && Math.abs(b.width - 28) < 3)
    }
    check('sidebar wordmark "rBox"', (await page.locator('nav >> text=rBox').count()) > 0)
  }

  // ---------- sidebar sections & no-horizontal-scroll ----------
  for (const s of ['Workspace', 'Folders', 'System']) {
    check(`laptop: section header ${s}`, await page.locator(`nav >> text=${s}`).first().isVisible().catch(() => false))
  }
  check('laptop: "Settings" drawer item', await page.locator('nav >> text=Settings').first().isVisible().catch(() => false))
  check('laptop: no "Account & Sessions" anymore', (await page.locator('nav >> text=Account & Sessions').count()) === 0)

  const docScrollW = await page.evaluate(() => document.documentElement.scrollWidth)
  check(`laptop: no page-level horizontal scrollbar (scrollWidth ${docScrollW} <= 1366)`, docScrollW <= 1366)
  const navScrollW = await page.locator('nav').first().evaluate(e => ({ sw: e.scrollWidth, cw: e.clientWidth }))
  check('laptop: nav has no horizontal overflow', navScrollW.sw <= navScrollW.cw + 1)
  const navScrollH = await page.locator('nav').first().evaluate(e => ({ sh: e.scrollHeight, ch: e.clientHeight }))
  check(`laptop: all sidebar content + storage card fit 768px (scrollH ${navScrollH.sh})`, navScrollH.sh <= 768)

  // default folders carry their color-coded icons in the explorer too
  {
    const row = await page.locator('tr:has-text("Code")').first().evaluate(el => {
      const badge = el.querySelector('td div div')
      return badge ? getComputedStyle(badge).backgroundColor : 'none'
    })
    check('laptop: "Code" folder row shows the blue tinted badge', /59, ?130, ?246/.test(row))
  }

  // ---------- folder switching never flashes false empty ----------
  // put a file in Images, then hop around quickly and assert the table
  // never shows the empty state while navigating to a non-empty folder
  await page.locator('nav >> text=All Files').first().click()
  await page.waitForTimeout(300)
  await page.click('button[aria-label="Upload files"]')
  await page.waitForSelector('text=Drag & drop files here')
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.locator('text=Drag & drop files here').click(),
  ])
  await fileChooser.setFiles({ name: 'seed.txt', mimeType: 'text/plain', buffer: Buffer.from('seed') })
  await page.click('button:has-text("Upload 1 File")')
  await page.waitForSelector('text=seed.txt', { timeout: 10000 })

  // move seed.txt into Images via the picker
  await page.locator('tr:has-text("seed.txt") button[aria-label="More"]').click()
  await page.click('text=Move to...')
  await page.waitForSelector('div[role="dialog"] >> text=Images', { timeout: 5000 })
  check('picker lists default folders', (await page.locator('div[role="dialog"] >> text=Documents').count()) > 0)
  await page.locator('div[role="dialog"] >> text=Images').first().click()
  await page.waitForTimeout(300)
  await page.locator('div[role="dialog"] button:has-text("Move Here")').click()
  await page.waitForTimeout(500)
  check('picker move reports success', (await page.locator('text=Moved 1 item').count()) > 0)

  // rapid folder switching: empty state must never appear for /f/Images
  let falseEmpty = false
  for (const target of ['Images', 'Code', 'Images', 'Documents', 'Images']) {
    await page.locator(`nav >> text=${target}`).first().click()
    await page.waitForTimeout(120)
    const emptyVisible = await page.locator('text=This folder is empty').first().isVisible().catch(() => false)
    if (target === 'Images' && emptyVisible) falseEmpty = true
    await page.waitForTimeout(300)
  }
  check('rapid switching never flashes "empty" on the populated Images folder', !falseEmpty)
  check('Images contains seed.txt after switching', (await page.locator('tr:has-text("seed.txt")').count()) > 0)

  // ---------- lua file: code badge + editor highlighting ----------
  await page.locator('nav >> text=All Files').first().click()
  await page.waitForTimeout(400)
  await page.click('button[aria-label="New file"]')
  await page.fill('div[role="dialog"] input', 'hello.lua')
  await page.keyboard.press('Enter')
  await page.waitForTimeout(600)
  await page.keyboard.press('Escape') // editor opens directly; close it
  await page.waitForTimeout(400)
  const luaRow = page.locator('tr:has-text("hello.lua")')
  check('hello.lua appears in listing', (await luaRow.count()) > 0)
  const badgeColor = await luaRow.first().evaluate(el => {
    const badge = el.querySelector('td div div')
    return badge ? getComputedStyle(badge).backgroundColor : 'none'
  })
  check('hello.lua has the blue code badge', /59, ?130, ?246/.test(badgeColor))

  await luaRow.first().click()
  await page.waitForSelector('.cm-editor', { timeout: 20000 })
  check('lua opens in the code editor', true)
  check('editor labels Lua grammar', (await page.locator('text=Lua').count()) > 0)
  // write lua with a keyword and comment, then check codemirror marks them
  await page.locator('.cm-content').click()
  await page.keyboard.type('local x = 5 -- comment\nprint(x)\n')
  await page.waitForTimeout(400)
  const marks = await page.locator('.cm-content .cm-line span').count()
  const gutter = await page.locator('.cm-gutters').count()
  check('lua content is line-numbered (gutter present)', gutter > 0)
  check(`lua highlighting produces token spans (${marks})`, marks > 0)
  // editor dialog is fullscreen flush: no rounded paper
  const paperRadius = await page.evaluate(() => {
    const paper = document.querySelector('.MuiDialog-paperFullScreen')
    return paper ? getComputedStyle(paper).borderRadius : 'missing'
  })
  check('fullscreen editor paper has borderRadius 0', paperRadius === '0px')
  await page.keyboard.press('Escape')
  await page.waitForTimeout(3000)
  const dirtyConfirm = (await page.locator('text=Unsaved changes').count()) > 0
  if (dirtyConfirm) await page.locator('button:has-text("Discard and close")').click()
  check('dirty editor prompts before close', dirtyConfirm)

  // ---------- theme surfaces render ----------
  const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
  check('dark canvas is obsidian #050609', /rgb\(5, 6, 9\)/.test(bodyBg))

  // ---------- settings view ----------
  await page.locator('button[aria-label="Settings"]').first().click()
  await page.waitForSelector('text=Storage & Quota', { timeout: 5000 })
  for (const section of ['Storage & Quota', 'Preferences & Appearance', 'Account Security', 'Active Sessions']) {
    check(`settings shows "${section}"`, (await page.locator(`text=${section}`).count()) > 0)
  }
  check('settings has Recalculate button', (await page.locator('button:has-text("Recalculate")').count()) > 0)
  check('settings has view segmented control', (await page.locator('button[value="grid"]').count()) > 0)
  await page.locator('button[value="grid"]').click()
  check('editor font size choices', (await page.locator('button[value="14"]').count()) > 0)
  // back to the table view so row selectors below keep working
  await page.locator('button[value="table"]').click()

  // ---------- clipboard cut/copy/paste flow ----------
  await page.locator('nav >> text=All Files').first().click()
  await page.waitForSelector('tr:has-text("hello.lua")', { timeout: 5000 })
  await page.locator('tr:has-text("hello.lua") input[type="checkbox"]').check()
  await page.waitForSelector('text=1 selected', { timeout: 3000 })
  check('multi-select bar appears', true)
  await page.locator('button:has-text("Cut")').first().click()
  await page.waitForSelector('text=ready to move', { timeout: 3000 })
  check('clipboard bar shows "ready to move"', true)
  await page.locator('nav >> text=Code').first().click()
  await page.waitForTimeout(600)
  check('paste button names current folder', (await page.locator('button:has-text("Paste into Code")').count()) > 0)
  await page.locator('button:has-text("Paste into Code")').click()
  await page.waitForTimeout(800)
  check('cut paste moved hello.lua into Code', (await page.locator('tr:has-text("hello.lua")').count()) > 0)
  check('clipboard bar auto-clears after cut+paste', (await page.locator('text=ready to move').count()) === 0)

  // ---------- shares lifecycle: delete unshares ----------
  await page.locator('nav >> text=Code').first().click()
  await page.waitForSelector('tr:has-text("hello.lua")', { timeout: 5000 })
  await page.locator('tr:has-text("hello.lua") button[aria-label="More"]').click()
  await page.click('text=Share...')
  await page.click('button:has-text("Create Share Link")')
  await page.waitForSelector('button:has-text("Copy Link")', { timeout: 5000 })
  const shareUrl = await page.locator('div[role="dialog"] input').first().inputValue()
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  check('share created', shareUrl.includes('/s/'))

  // ---------- mobile: 390x844 ----------
  const mob = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await mob.addInitScript(() => localStorage.setItem('rbox-theme', 'dark'))
  watch(mob)
  await login(mob)
  const mobScrollW = await mob.evaluate(() => document.documentElement.scrollWidth)
  check(`mobile: no page-level horizontal scrollbar (${mobScrollW} <= 390)`, mobScrollW <= 390)
  const mobHeaderScrollW = await mob.locator('header').evaluate(e => ({ sw: e.scrollWidth, cw: e.clientWidth }))
  check('mobile: navbar no horizontal overflow', mobHeaderScrollW.sw <= mobHeaderScrollW.cw + 1)
  check('mobile: wordmark visible in collapsed navbar', (await mob.locator('header img[alt*="logo" i]').count()) > 0)
  await mob.click('button[aria-label="Toggle sidebar"]')
  await mob.waitForSelector('.MuiDrawer-root >> text=All Files', { timeout: 5000 })
  const drawerScrollW = await mob.locator('.MuiDrawer-root .MuiDrawer-paper').evaluate(e => ({ sw: e.scrollWidth, cw: e.clientWidth }))
  check('mobile: drawer no horizontal overflow', drawerScrollW.sw <= drawerScrollW.cw + 1)
  await mob.keyboard.press('Escape')
  await mob.waitForTimeout(400)

  // shared links render as cards on mobile
  await mob.goto(BASE + '/shares', { waitUntil: 'networkidle' })
  await mob.waitForTimeout(800)
  const cardCount = await mob.locator('.MuiCard-root').count()
  check('mobile: shared links render self-contained cards', cardCount > 0)
  check('mobile: cards fit the screen width', await mob.evaluate(() => {
    const c = document.querySelector('.MuiCard-root')
    return c ? c.getBoundingClientRect().width <= window.innerWidth : false
  }))
  check('mobile: revoke button visible on card', (await mob.locator('button:has-text("Revoke")').count()) > 0)
  const sharesPageScrollW = await mob.evaluate(() => document.documentElement.scrollWidth)
  check(`mobile: shares page no horizontal scrollbar (${sharesPageScrollW} <= 390)`, sharesPageScrollW <= 390)

  const real = errors.filter(e => !/favicon|fonts.googleapis|fonts.gstatic/i.test(e))
  check('zero console.error / pageerror', real.length === 0)
  if (real.length) console.log(real.slice(0, 5))

  await browser.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
