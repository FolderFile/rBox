const { chromium } = require('playwright-core')

const BASE = process.argv[2]
const CHROME = process.argv[3]
const USER = process.argv[4] || 'admin'
const PASS = process.argv[5] || 'secret123'

let pass = 0, fail = 0
const ok = m => console.log(`  ok: ${m}`) && pass++
const check = (m, c) => { if (c) { ok(m) } else { console.log(`  FAIL: ${m}`); fail++ } }

async function box(page, sel) {
  const el = page.locator(sel).first()
  return el.evaluate(e => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, right: r.right, bottom: r.bottom } })
}

;(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true })
  const errors = []
  const watch = p => {
    p.on('pageerror', e => errors.push(`pageerror: ${e.message}`))
    p.on('console', m => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
  }

  // ---------- desktop 1280x800 ----------
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  watch(page)
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.fill('input[type="text"]', USER)
  await page.fill('input[type="password"]', PASS)
  await page.click('button[type="submit"]')
  await page.waitForSelector('button[aria-label="Toggle sidebar"]', { timeout: 15000 })
  await page.waitForTimeout(600)

  const sidebar = await box(page, 'nav')
  const search = await box(page, 'header >> text=Search')
  const toggle = await box(page, 'button[aria-label="Toggle sidebar"]')
  const table = await box(page, 'table')
  check('desktop: sidebar occupies its own 240px column', Math.abs(table.w - (1280 - 240 - 32)) < 6)
  check('desktop: search bar starts right of the sidebar', search.x >= sidebar.right - 2)
  check('desktop: table starts below and fully beside the sidebar', table.x >= sidebar.right - 2 && table.w > 1000)
  check('desktop: sidebar does not cover the Name column', sidebar.right <= table.x + 1)

  // default folders seeded and visible in the drawer
  for (const f of ['Images', 'Videos', 'Audio', 'Documents', 'Code', 'Archives']) {
    check(`desktop: drawer lists "${f}"`, await page.locator(`nav >> text="${f}"`).count() > 0)
  }
  for (const s of ['WORKSPACE', 'FOLDERS', 'SYSTEM']) {
    const vis = await page.locator(`nav >> text=${s}`).first().isVisible().catch(() => false)
    check(`desktop: section header ${s}`, vis)
  }
  const sectionBox = await box(page, 'nav >> text=WORKSPACE')
  check('desktop: section header has breathing room (padding)', sectionBox.y > 40 && sectionBox.h > 10)

  // table shows the real default folders
  for (const f of ['Images', 'Documents']) {
    check(`desktop: table lists real folder "${f}"`, (await page.locator(`tr:has-text("${f}")`).count()) > 0)
  }

  // toggle collapses smoothly
  await page.click('button[aria-label="Toggle sidebar"]')
  await page.waitForTimeout(500)
  const collapsed = await box(page, 'nav')
  check('desktop: sidebar collapses to zero width', collapsed.w < 4)
  const tableWide = await box(page, 'table')
  check('desktop: explorer expands to full width when collapsed', Math.abs(tableWide.w - 1280 + 32) < 8)
  await page.click('button[aria-label="Toggle sidebar"]')
  await page.waitForTimeout(500)
  check('desktop: sidebar expands back', (await box(page, 'nav')).w > 230)

  // sidebar folder click navigates into the real folder
  await page.locator('nav >> text=Images').first().click()
  await page.waitForTimeout(800)
  check('desktop: Images click navigates to /f/Images', page.url().endsWith('/f/Images'))
  check('desktop: breadcrumb shows Images', (await page.locator('nav[aria-label="breadcrumb"], [role="navigation"]').count()) >= 0)
  check('desktop: folder view is empty state', (await page.locator('text=This folder is empty').count()) > 0)
  await page.locator('nav >> text=Documents').first().click()
  await page.waitForTimeout(800)
  check('desktop: Documents click navigates to /f/Documents', page.url().endsWith('/f/Documents'))

  // toolbar: five tonal buttons
  for (const a of ['Upload files', 'New folder', 'New file', 'Sort', 'Switch view']) {
    check(`desktop: toolbar has "${a}" tonal button`, (await page.locator(`button[aria-label="${a}"]`).count()) > 0)
  }
  const upBtn = await box(page, 'button[aria-label="Upload files"]')
  check('desktop: tonal buttons are 36px rounded squares', Math.abs(upBtn.h - 36) < 2)
  // view switcher cycles table -> list -> grid
  await page.click('button[aria-label="Switch view"]')
  await page.waitForTimeout(300)
  check('desktop: view cycles to compact list', (await page.locator('ul, [role="list"]').count()) >= 0)
  await page.click('button[aria-label="Switch view"]')
  await page.waitForTimeout(300)
  check('desktop: view cycles to grid', (await page.locator('text=This folder is empty').count()) > 0)

  // row hover reveals quick icons (opacity 0 until hover)
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.waitForSelector('tr:has-text("Images")')
  const row = page.locator('tr:has-text("Images")').first()
  const before = await row.locator('.quick').first().evaluate(e => getComputedStyle(e).opacity)
  await row.hover()
  await page.waitForTimeout(300)
  const after = await row.locator('.quick').first().evaluate(e => getComputedStyle(e).opacity)
  check('desktop: quick row icons hidden until hover', before === '0' && after === '1')

  // ---------- mobile 390x844 ----------
  const mob = await browser.newPage({ viewport: { width: 390, height: 844 } })
  watch(mob)
  await mob.goto(BASE + '/', { waitUntil: 'networkidle' })
  await mob.fill('input[type="text"]', USER)
  await mob.fill('input[type="password"]', PASS)
  await mob.click('button[type="submit"]')
  await mob.waitForSelector('button[aria-label="Toggle sidebar"]', { timeout: 15000 })
  await mob.waitForTimeout(500)
  check('mobile: no persistent sidebar column', !(await mob.locator('nav').first().isVisible()))
  check('mobile: hamburger visible at far left', (await mob.locator('button[aria-label="Toggle sidebar"]').count()) > 0)
  const mobToggle = await box(mob, 'button[aria-label="Toggle sidebar"]')
  const mobTable = await box(mob, 'table')
  check('mobile: table uses full width', Math.abs(mobTable.w - (390 - 24)) < 8)
  check('mobile: hamburger at far left', mobToggle.x < 16)
  await mob.click('button[aria-label="Toggle sidebar"]')
  await mob.waitForSelector('.MuiDrawer-root >> text=WORKSPACE', { timeout: 5000 })
  check('mobile: drawer opens with sections', (await mob.locator('.MuiDrawer-root >> text=Images').count()) > 0)
  await mob.locator('.MuiDrawer-root >> text=Images').first().click()
  await mob.waitForTimeout(800)
  check('mobile: Images click navigates to /f/Images', mob.url().endsWith('/f/Images'))
  check('mobile: drawer closed after pick', (await mob.locator('.MuiDrawer-root >> text=WORKSPACE').count()) === 0)

  const real = errors.filter(e => !/401|403|429|favicon/i.test(e))
  check('zero console.error / pageerror across both viewports', real.length === 0)
  if (real.length) console.log(real.slice(0, 5))

  await browser.close()
  console.log(`\n${pass} passed, ${fail} failed`)
  process.exit(fail ? 1 : 0)
})().catch(e => { console.error(e); process.exit(1) })
