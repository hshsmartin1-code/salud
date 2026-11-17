// Swiping between days on the diary (touch emulation). Synthetic profile only.
import type { Page } from '@playwright/test'
import { expect, logInMeal, onboard, test, today } from './helpers'

test.use({ hasTouch: true })

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
const dParam = (page: Page) => new URL(page.url().replace('#/', '')).searchParams.get('d')

/** A touch drag through CDP: a real touchstart/move/end sequence, so the browser decides scroll vs pan like on a phone. */
async function drag(page: Page, from: [number, number], to: [number, number], steps = 10) {
  const cdp = await page.context().newCDPSession(page)
  const at = (i: number) => ({ x: from[0] + ((to[0] - from[0]) * i) / steps, y: from[1] + ((to[1] - from[1]) * i) / steps })
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [at(0)] })
  for (let i = 1; i <= steps; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [at(i)] })
    await page.waitForTimeout(12)
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await cdp.detach()
}
const swipeLeft = (page: Page, y = 330) => drag(page, [340, y], [120, y])
const swipeRight = (page: Page, y = 330) => drag(page, [60, y], [280, y])

async function diary(page: Page, query = '') {
  await page.goto(`./#/comida${query}`)
  await expect(page.getByTestId('day-summary')).toBeVisible()
  await expect(page.getByTestId('diary-surface')).toBeVisible()
}

test.describe('swipe between days', () => {
  test('left goes to the next day, right to the previous one, like the arrows', async ({ page }) => {
    await onboard(page)
    await diary(page)
    expect(dParam(page)).toBeNull()
    await swipeRight(page)
    await expect.poll(() => dParam(page)).toBe(addDays(today(), -1))
    await swipeLeft(page)
    await expect.poll(() => dParam(page)).toBeNull() // back on today: no ?d=, like the "Hoy" rule
    await swipeLeft(page)
    await expect.poll(() => dParam(page)).toBe(addDays(today(), 1))
    await page.getByRole('button', { name: 'Día anterior' }).click()
    await expect.poll(() => dParam(page)).toBeNull()
  })

  test('"Hoy" is on screen without scrolling whenever another day is shown', async ({ page }) => {
    await onboard(page)
    await diary(page, `?d=${addDays(today(), -4)}`)
    await expect(page.getByRole('button', { name: 'Hoy', exact: true })).toBeInViewport({ ratio: 1 })
    await page.getByRole('button', { name: 'Hoy', exact: true }).click()
    await expect.poll(() => dParam(page)).toBeNull()
  })

  test('a mostly vertical drag, a small drag and a mouse drag do not change the day', async ({ page }) => {
    await onboard(page)
    await logInMeal(page, 'desayuno')
    await logInMeal(page, 'almuerzo')
    await logInMeal(page, 'cena')
    await diary(page)
    await drag(page, [230, 560], [150, 300])
    await drag(page, [230, 300], [190, 300])
    await page.mouse.move(340, 330)
    await page.mouse.down()
    await page.mouse.move(120, 330, { steps: 8 })
    await page.mouse.up()
    await page.waitForTimeout(250)
    expect(dParam(page)).toBeNull()
  })

  test('a gesture that starts at the screen edge is left to the system', async ({ page }) => {
    await onboard(page)
    await diary(page)
    await drag(page, [8, 330], [260, 330])
    await drag(page, [404, 330], [150, 330])
    await page.waitForTimeout(250)
    expect(dParam(page)).toBeNull()
  })

  test('a tap on a row still opens the editor; a drag that starts on a row menu button does nothing', async ({ page }) => {
    await onboard(page)
    await logInMeal(page, 'desayuno')
    await diary(page)
    const row = page.getByTestId('meal-desayuno').locator('ul > li > button').first()
    const menu = page.getByTestId('meal-desayuno').locator('ul > li').getByRole('button', { name: /^Acciones de/ })
    const box = (await menu.boundingBox())!
    await drag(page, [box.x + box.width / 2, box.y + box.height / 2], [box.x - 200, box.y + box.height / 2])
    await page.waitForTimeout(250)
    expect(dParam(page)).toBeNull()
    await expect(page.getByTestId('save-food')).toHaveCount(0)
    await row.tap()
    await expect(page.getByTestId('save-food')).toBeVisible()
  })

  test('a swipe that starts on a food row changes the day and does not open that row', async ({ page }) => {
    await onboard(page)
    await logInMeal(page, 'desayuno')
    await diary(page)
    const row = page.getByTestId('meal-desayuno').locator('ul > li > button').first()
    const box = (await row.boundingBox())!
    const y = box.y + box.height / 2
    const x = Math.min(box.x + box.width - 12, 330)
    await drag(page, [x, y], [x - 200, y])
    await expect.poll(() => dParam(page)).toBe(addDays(today(), 1))
    await page.waitForTimeout(300)
    await expect(page.getByTestId('save-food')).toHaveCount(0)
    // A deliberate tap right afterwards is a new gesture and still works.
    await page.getByRole('button', { name: 'Día anterior' }).click()
    await expect.poll(() => dParam(page)).toBeNull()
    await row.tap()
    await expect(page.getByTestId('save-food')).toBeVisible()
  })

  test('a horizontally scrollable area keeps its own drag', async ({ page }) => {
    await onboard(page)
    await diary(page)
    await page.evaluate(() => {
      const el = document.createElement('div')
      el.id = 'probe-scroller'
      el.style.cssText = 'overflow-x:auto;width:100%;height:60px;white-space:nowrap'
      el.innerHTML = '<div style="width:1200px;height:40px;background:#888"></div>'
      document.querySelector('[data-testid="meals"]')!.prepend(el)
    })
    const box = (await page.locator('#probe-scroller').boundingBox())!
    await drag(page, [340, box.y + 20], [120, box.y + 20])
    await page.waitForTimeout(250)
    expect(dParam(page)).toBeNull()
  })

  test('the slide-in follows the swipe and is skipped with reduced motion', async ({ page }) => {
    await onboard(page)
    await diary(page)
    const animationOf = () => page.getByTestId('meals').evaluate((el) => getComputedStyle(el).animationName)
    await swipeLeft(page)
    await expect.poll(() => dParam(page)).toBe(addDays(today(), 1))
    expect(['day-in-next', 'none']).toContain(await animationOf()) // may already be over; never the other direction
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await swipeRight(page)
    await expect.poll(() => dParam(page)).toBeNull()
    expect(await animationOf()).toBe('none')
    await page.emulateMedia({ reducedMotion: 'no-preference' })
    await swipeRight(page)
    await expect.poll(() => dParam(page)).toBe(addDays(today(), -1))
    await expect.poll(animationOf, { timeout: 400 }).toMatch(/day-in-prev|none/)
  })
})

test.describe('midnight rollover', () => {
  test.use({ clockAt: '2026-11-18T23:58:00-05:00' })
  test('without ?d= the diary follows the clock, and a swipe is relative to the new day', async ({ page }) => {
    await onboard(page)
    await diary(page)
    await expect(page.getByText('18 nov', { exact: false }).first()).toBeVisible()
    await page.clock.fastForward(4 * 60_000)
    await expect(page.getByText('19 nov', { exact: false }).first()).toBeVisible()
    expect(dParam(page)).toBeNull()
    await swipeRight(page)
    await expect.poll(() => dParam(page)).toBe('2026-11-18')
    await expect(page.getByRole('button', { name: 'Hoy', exact: true })).toBeVisible()
  })
})
