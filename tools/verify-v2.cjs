const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");

const output = path.resolve(__dirname, "../test-output/v2");
fs.mkdirSync(output, { recursive: true });

async function mapClick(page, x, y) {
  const point = await page.locator("#terrainCanvas").evaluate((canvas, coord) => {
    const rect = canvas.getBoundingClientRect();
    const size = Math.min(rect.width - 32, rect.height - 32);
    return { x: rect.left + (rect.width - size) / 2 + size * coord.x,
      y: rect.top + (rect.height - size) / 2 + size * coord.y };
  }, { x, y });
  await page.mouse.click(point.x, point.y);
}

(async () => {
  const browser = await chromium.launch({ headless: true,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle" });
  await page.waitForFunction(() => document.querySelector("#regionCoordinates").textContent.includes("°"));
  await page.screenshot({ path: path.join(output, "globe.png") });
  const before = await page.locator("#moonCanvas").evaluate((canvas) => canvas.toDataURL().slice(1000, 5000));
  const globe = await page.locator("#moonCanvas").boundingBox();
  await page.mouse.move(globe.x + globe.width * 0.5, globe.y + globe.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(globe.x + globe.width * 0.65, globe.y + globe.height * 0.7, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const after = await page.locator("#moonCanvas").evaluate((canvas) => canvas.toDataURL().slice(1000, 5000));
  if (before === after) throw new Error("Globe image did not change after 2-axis drag");
  await page.mouse.click(globe.x + globe.width * 0.5, globe.y + globe.height * 0.5);
  const selected = await page.locator("#regionCoordinates").textContent();
  await page.screenshot({ path: path.join(output, "globe-rotated.png") });

  await page.selectOption("#regionSelect", "copernicus");
  await page.click("#enterPlanner");
  await page.waitForSelector("#canvasLoading", { state: "hidden", timeout: 30000 });
  await page.click("#chooseStart");
  await mapClick(page, 0.12, 0.25);
  await page.click("#chooseEnd");
  await mapClick(page, 0.86, 0.77);
  await page.waitForFunction(() => document.querySelector("#distanceMetric").textContent !== "—", { timeout: 30000 });
  await page.click("#addPoint");
  await mapClick(page, 0.72, 0.22);
  await page.waitForFunction(() => document.querySelector("#visitOrder").textContent.includes("途经 1"), { timeout: 30000 });
  await page.screenshot({ path: path.join(output, "ordered-route.png") });
  const orderedKm = await page.locator("#distanceMetric").textContent();

  await page.click("#unorderedMode");
  await page.click("#addPoint");
  await mapClick(page, 0.18, 0.22);
  await mapClick(page, 0.75, 0.25);
  await mapClick(page, 0.62, 0.78);
  await page.waitForFunction(() => document.querySelector("#visitOrder").textContent.includes("目标 3"), { timeout: 60000 });
  const order = await page.locator("#visitOrder").textContent();
  await page.screenshot({ path: path.join(output, "unordered-route.png") });
  await page.click('[data-view="3d"]');
  await page.locator("#heightSlider").fill("2");
  await page.screenshot({ path: path.join(output, "terrain-3d.png") });

  await page.click("#brandButton");
  await page.selectOption("#regionSelect", "south-pole");
  const polarLabel = await page.locator("#mapBounds").textContent();
  await page.screenshot({ path: path.join(output, "polar-globe.png") });
  await page.click("#enterPlanner");
  await page.waitForSelector("#canvasLoading", { state: "hidden", timeout: 30000 });
  await page.click("#chooseStart");
  await mapClick(page, 0.14, 0.2);
  await page.click("#chooseEnd");
  await mapClick(page, 0.82, 0.8);
  await page.waitForFunction(() => document.querySelector("#distanceMetric").textContent !== "—", { timeout: 30000 });
  const polarKm = await page.locator("#distanceMetric").textContent();
  await page.screenshot({ path: path.join(output, "polar-route.png") });

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  mobile.on("pageerror", (error) => errors.push(`mobile: ${error.message}`));
  await mobile.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle" });
  await mobile.waitForFunction(() => document.querySelector("#regionCoordinates").textContent.includes("°"));
  await mobile.screenshot({ path: path.join(output, "mobile-globe.png"), fullPage: true });
  await mobile.click("#enterPlanner");
  await mobile.waitForSelector("#canvasLoading", { state: "hidden", timeout: 30000 });
  await mobile.screenshot({ path: path.join(output, "mobile-planner.png"), fullPage: true });

  const result = { selected, orderedKm, order, polarLabel, polarKm, errors };
  fs.writeFileSync(path.join(output, "verification.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  await browser.close();
  if (errors.length) process.exitCode = 1;
})().catch((error) => { console.error(error); process.exit(1); });
