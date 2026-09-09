// node preview/shoot.js ["format=gif&look=dark&source=live"] [screens]
//
// Opens build/index.html in Chrome at the Marketplace's own window size and
// saves a screenshot per screenful as build/shot-<n>.png, so the page can be
// judged, or compared before and after a change, without opening it by hand.
// The first argument is the page's own URL hash: the same settings the review
// panel sets.

"use strict";

const path = require("node:path");
const { BUILD, PUPPETEER } = require("../paths.js");

(async () => {
  const puppeteer = require(PUPPETEER);
  const hash = process.argv[2] || "";
  const screens = Number(process.argv[3] || 4);
  const browser = await puppeteer.launch({
    executablePath: process.env.MDM_DEMO_CHROME || "/usr/bin/google-chrome",
    args: ["--no-sandbox", "--allow-file-access-from-files", "--autoplay-policy=no-user-gesture-required"],
    defaultViewport: { width: 1440, height: 1000 },
  });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("file://" + path.join(BUILD, "index.html") + (hash ? "#" + hash : ""), { waitUntil: "load" });
  await new Promise((r) => setTimeout(r, 2500));
  console.log("errors:", errors.length ? errors : "none");
  console.log(
    JSON.stringify(
      await page.evaluate(() => {
        const col = document.querySelector(".col-readme");
        const shot = document.querySelector(".markdown:not([hidden]) .mdm-slot > *");
        return {
          readmeColumn: col ? Math.round(col.getBoundingClientRect().width) : null,
          slots: document.querySelectorAll(".markdown:not([hidden]) .mdm-slot").length,
          firstClip: shot
            ? { tag: shot.tagName, w: Math.round(shot.getBoundingClientRect().width), h: Math.round(shot.getBoundingClientRect().height) }
            : null,
          panel: (document.getElementById("stats") || {}).textContent,
        };
      })
    )
  );
  for (let i = 0; i < screens; i++) {
    await page.evaluate((y) => window.scrollTo(0, y), i * 950);
    await new Promise((r) => setTimeout(r, 700));
    await page.screenshot({ path: path.join(BUILD, `shot-${i}.png`) });
  }
  await browser.close();
})().catch((e) => {
  console.error("ERR", e.message);
  process.exit(1);
});
