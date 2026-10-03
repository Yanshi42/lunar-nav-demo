const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");

(async () => {
  const output = path.resolve(__dirname, "../test-output");
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath: "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });
  page.on("pageerror", (error) => errors.push(error.message));

  await page.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle" });
  await page.waitForSelector("#regionSelect option:nth-child(3)", { state: "attached" });
  await page.screenshot({ path: path.join(output, "globe.png"), fullPage: true });

  await page.click("#enterPlanner");
  await page.waitForSelector("#canvasLoading", { state: "hidden" });
  await page.waitForFunction(() => document.querySelector("#distanceMetric").textContent !== "—");
  const metrics = await page.locator(".metrics-grid strong").allTextContents();
  await page.screenshot({ path: path.join(output, "planner-2d.png"), fullPage: true });

  await page.click('[data-view="3d"]');
  const canvas = page.locator("#terrainCanvas");
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.45);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.64, box.y + box.height * 0.51, { steps: 8 });
  await page.mouse.up();
  await page.screenshot({ path: path.join(output, "planner-3d.png"), fullPage: true });

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  mobile.on("console", (msg) => { if (msg.type() === "error") errors.push(`mobile: ${msg.text()}`); });
  mobile.on("pageerror", (error) => errors.push(`mobile: ${error.message}`));
  await mobile.goto("http://127.0.0.1:4173/", { waitUntil: "networkidle" });
  await mobile.waitForSelector("#regionSelect option:nth-child(3)", { state: "attached" });
  await mobile.screenshot({ path: path.join(output, "globe-mobile.png"), fullPage: true });
  await mobile.click("#enterPlanner");
  await mobile.waitForSelector("#canvasLoading", { state: "hidden" });
  await mobile.waitForFunction(() => document.querySelector("#distanceMetric").textContent !== "—");
  await mobile.screenshot({ path: path.join(output, "planner-mobile.png"), fullPage: true });

  const result = {
    title: await page.title(),
    regionCount: await page.locator("#regionSelect option").count(),
    metrics,
    errors,
    screenshots: ["globe.png", "planner-2d.png", "planner-3d.png", "globe-mobile.png", "planner-mobile.png"],
  };
  fs.writeFileSync(path.join(output, "verification.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  await browser.close();
  if (errors.length) process.exitCode = 1;
})().catch((error) => { console.error(error); process.exit(1); });
