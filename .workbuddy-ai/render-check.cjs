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

  const page = await browser.newPage({ viewport: { width: 1560, height: 1000 }, deviceScaleFactor: 1 });

  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push('[console] ' + m.text().slice(0, 260)); });
  page.on('pageerror', (e) => errors.push('[pageerror] ' + String(e).slice(0, 260)));

  console.log('→ opening app…');
  await page.goto('http://localhost:5173/', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(2500);

  console.log('→ logging in as the FIELD OFFICER (inspector)…');
  await page.fill('input[type="email"]', 'inspector@cmc.gov.in');
  await page.fill('input[type="password"]', 'roadpulse123');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(3500);

  console.log('→ opening Report Map…');
  await page.goto('http://localhost:5173/map', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForSelector('.mapboxgl-canvas', { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(9000);
  await page.screenshot({ path: path.join(OUT, '10-report-map.png') });

  const probe = await page.evaluate(() => {
    const canvas = document.querySelector('.mapboxgl-canvas');
    const txt = (sel) => [...document.querySelectorAll(sel)].map((n) => n.textContent.trim());
    return {
      hasCanvas: !!canvas,
      legendRows: document.querySelectorAll('.map__legend-row').length,
      legendText: txt('.map__legend-row'),
      strip: txt('.report-strip__chip'),
      reportRows: document.querySelectorAll('.report-row').length,
      sources: txt('.report-src'),
      zoneLabels: txt('.map-zone-label'),
    };
  });
  console.log('\n=== REPORT MAP PROBE ===');
  console.log(JSON.stringify(probe, null, 2));

  // FULL-SET LAYER PROBE — confirm report markers actually render on the canvas
  // before any filter is applied (this is the core "whole map shows reports" claim).
  const fullProbe = await page.evaluate(() => {
    const m = window.__rpMap;
    if (!m) return { error: 'no map handle (dev build only)' };
    const ids = ['reports-icon', 'reports-pending-ring', 'clusters-ring', 'clusters-halo', 'segments-line', 'geofences-line'];
    const rendered = {};
    for (const id of ids) rendered[id] = m.getLayer(id) ? m.queryRenderedFeatures({ layers: [id] }).length : 'MISSING';
    const src = m.getSource('reports');
    return {
      zoom: Math.round(m.getZoom() * 10) / 10,
      rendered,
      sourceFeatureCount: src && src._data ? src._data.features.length : 'n/a',
      images: ['report-pin-verified', 'report-pin-pending', 'report-pin-rejected', 'report-cam-verified', 'report-cam-pending', 'report-cam-rejected']
        .reduce((a, k) => ({ ...a, [k]: m.hasImage(k) }), {}),
    };
  });
  console.log('FULL-SET LAYER PROBE:', JSON.stringify(fullProbe));

  // zoom in for a close-up of the report markers
  try {
    const box = await page.locator('.map__canvas').boundingBox();
    await page.mouse.move(box.x + box.width * 0.45, box.y + box.height * 0.55);
    for (let i = 0; i < 5; i += 1) { await page.mouse.wheel(0, -260); await page.waitForTimeout(320); }
    await page.waitForTimeout(3000);
    await page.screenshot({ path: path.join(OUT, '11-report-map-zoom.png') });
  } catch (e) { console.log('zoom failed:', e.message.slice(0, 100)); }

  // filter to pending only, then exercise the field-officer accept flow
  try {
    await page.getByRole('button', { name: /pending review/i }).first().click();
    await page.waitForTimeout(2500);
    await page.screenshot({ path: path.join(OUT, '12-report-map-pending.png') });
    const pending = await page.evaluate(() => ({
      rows: document.querySelectorAll('.report-row').length,
      acceptButtons: [...document.querySelectorAll('button')].filter((b) => /accept/i.test(b.textContent)).length,
      rejectButtons: [...document.querySelectorAll('button')].filter((b) => /reject/i.test(b.textContent)).length,
    }));
    console.log('PENDING FILTER:', JSON.stringify(pending));

    if (pending.acceptButtons > 0) {
      const before = await page.evaluate(() => document.querySelectorAll('.report-row').length);
      await page.getByRole('button', { name: /^accept$/i }).first().click();
      await page.waitForTimeout(3500);
      const after = await page.evaluate(() => ({
        rows: document.querySelectorAll('.report-row').length,
        toast: document.querySelector('.toast, [class*="toast"]')?.textContent?.trim() || '',
      }));
      console.log('ACCEPT FLOW: rows before', before, '→ after', after.rows, '| toast:', after.toast.slice(0, 90));
      await page.screenshot({ path: path.join(OUT, '14-accept-result.png') });
    }
  } catch (e) { console.log('pending filter failed:', e.message.slice(0, 120)); }

  // LAYER PROBE — must run while still on /map. Click the first report row so the
  // camera flies to it, then query the rendered feature counts per layer.
  try {
    await page.locator('.report-row').first().click();
    await page.waitForTimeout(5000);
    await page.screenshot({ path: path.join(OUT, '15-report-focused.png') });

    const layers = await page.evaluate(() => {
      const m = window.__rpMap;
      if (!m) return { error: 'no map handle' };
      const ids = ['reports-icon', 'reports-pending-ring', 'clusters-ring', 'segments-line', 'geofences-line'];
      const out = { rendered: {}, images: {}, zoom: Math.round(m.getZoom() * 10) / 10 };
      for (const id of ids) out.rendered[id] = m.getLayer(id) ? m.queryRenderedFeatures({ layers: [id] }).length : 'MISSING';
      for (const img of ['report-pin-verified', 'report-pin-pending', 'report-cam-verified', 'report-cam-pending']) {
        out.images[img] = m.hasImage(img);
      }
      const src = m.getSource('reports');
      out.sourceFeatureCount = src && src._data ? src._data.features.length : 'n/a';
      return out;
    });
    console.log('LAYER PROBE:', JSON.stringify(layers));
  } catch (e) { console.log('focus test failed:', e.message.slice(0, 140)); }

  console.log('→ opening Fleet page…');
  await page.goto('http://localhost:5173/fleet', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForTimeout(6000);
  await page.screenshot({ path: path.join(OUT, '13-fleet.png') });
  const fleetProbe = await page.evaluate(() => ({
    mapsOnFleetPage: document.querySelectorAll('.mapboxgl-canvas').length,
    bodyHasSourceTable: document.body.innerText.includes('Citizen app'),
    bodyHasVerification: document.body.innerText.includes('Pending review'),
  }));
  console.log('FLEET PROBE:', JSON.stringify(fleetProbe));

  console.log('\n=== ERRORS (' + errors.length + ') ===');
  for (const e of errors.slice(0, 20)) console.log(e);

  await browser.close();
})().catch((e) => { console.error('FATAL', e); process.exit(1); });
