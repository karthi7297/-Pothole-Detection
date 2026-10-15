const { chromium } = require('playwright-core');
const path = require('path');

const EXE = path.join(
  process.env.LOCALAPPDATA,
  'ms-playwright',
  'chromium-1243',
  'chrome-win64',
  'chrome.exe'
);
const OUT = 'C:/Users/91915/Documents/New folder/-Pothole-Detection/.workbuddy-ai/shots';

(async () => {
  const browser = await chromium.launch({
    executablePath: EXE,
    headless: true,
    args: ['--enable-unsafe-swiftshader', '--use-gl=angle', '--use-angle=swiftshader', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1560, height: 1100 }, deviceScaleFactor: 1 });

  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('[console] ' + m.text().slice(0, 220)); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + String(e).slice(0, 220)));

  // Anonymous citizen — the exact path the user described.
  console.log('→ opening the citizen report page (no sign-in)…');
  await page.goto('http://localhost:5173/report', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(2500);

  const fields = await page.evaluate(() => {
    const labels = [...document.querySelectorAll('label')].map((l) => l.textContent.trim());
    return {
      labels,
      hasLocationNameLabel: labels.some((l) => /location name/i.test(l)),
      inputs: [...document.querySelectorAll('input')].map((i) => i.getAttribute('placeholder')),
    };
  });
  console.log('FORM FIELDS:', JSON.stringify(fields, null, 2));

  // Type a real Coimbatore coordinate and let the debounced lookup name the place.
  console.log('→ typing coordinates 11.0283 / 76.9942 …');
  const latInput = page.locator('input[placeholder="11.0168"]');
  const lonInput = page.locator('input[placeholder="76.9558"]');
  await latInput.fill('11.0283');
  await lonInput.fill('76.9942');

  await page.waitForTimeout(6000); // debounce (600 ms) + reverse geocode

  const named = await page.evaluate(() => {
    const inputs = [...document.querySelectorAll('input')];
    const nameInput = inputs.find((i) => /Near |Road|Colony|Junction|Zone/i.test(i.value) && i.type === 'text');
    return {
      locationNameValue: nameInput ? nameInput.value : null,
      allInputValues: inputs.map((i) => i.value).filter(Boolean),
      badgeText: [...document.querySelectorAll('.badge, [class*="badge"]')].map((b) => b.textContent.trim()),
    };
  });
  console.log('AUTO-NAMED:', JSON.stringify(named, null, 2));

  await page.screenshot({ path: path.join(OUT, '20-report-form.png') });

  // Now type a manual name and confirm it is not overwritten by the lookup.
  console.log('→ typing a manual name…');
  await page.fill('input[placeholder="e.g. Near PSG Hospitals, Avinashi Road"]', 'My own landmark name');
  await page.waitForTimeout(3000);
  const manual = await page.evaluate(() => {
    const i = document.querySelector('input[placeholder="e.g. Near PSG Hospitals, Avinashi Road"]');
    return i ? i.value : null;
  });
  console.log('MANUAL NAME PRESERVED:', JSON.stringify(manual));
  await page.screenshot({ path: path.join(OUT, '21-report-form-manual.png') });

  console.log('\n=== ERRORS (' + errors.length + ') ===');
  for (const e of errors.slice(0, 15)) console.log(e);

  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
