// The rig the demo clips are recorded with.
//
// launch.sh starts a VS Code with --remote-debugging-port, and this drives it
// over the Chrome DevTools Protocol. The pointer is dispatched as real Input
// events, so hover states fire (the buttons of a score come up only under a
// pointer, as a tooltip does), and a pointer is drawn in the workbench
// document, in the shape the editor's own cursor has at that point, so the
// reader can see where it is. The frames are taken with Page.startScreencast off
// the workbench renderer, which composites the webview and the arrow into one
// picture.
//
// Not x11grab: the pointer is synthetic, so the X cursor never moves and a
// screen grab would show a still arrow. Not the webview harness in plain
// Chrome (tests/webview/harness.html): a clip has to show the VS Code around
// the editor.

"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { PUPPETEER, PORT } = require("./paths.js");
const { travel, stroke, keyGaps, readTime } = require("./motion.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// How long the pointer is on a thing before it presses it (pressAt). A hand
// that has arrived presses: a tenth of a second, where every press used to
// wait a third to a half of one whatever it was on. A button the take leaves
// its own tooltip to name is the exception, and how long the pointer is on
// that one is by what the tooltip says (readTip, below).
const SETTLE = 110;

// ---------------------------------------------------------------- overlay

// Drawn in the workbench document and not in the webview, so one overlay
// covers the whole window: the pointer travels over the tab bar and the
// activity bar as well as over the text.
//
// Built node by node with no innerHTML anywhere: the workbench enforces
// Trusted Types (require-trusted-types-for 'script'), so an innerHTML
// assignment from an evaluate() throws "This document requires 'TrustedHTML'
// assignment" and ends the take.
function overlaySource() {
  return `(${overlayFn.toString()})();`;
}

function overlayFn() {
  // The overlay's own version, so a VS Code still holding an older overlay
  // from an earlier run (the workbench outlives a run) gets this one instead.
  const VERSION = 5;
  if (window.__mdmRig && window.__mdmRig.version === VERSION) return;
  const stale = document.getElementById("__mdm_rig");
  if (stale) stale.remove();
  const staleStyle = document.getElementById("__mdm_rig_style");
  if (staleStyle) staleStyle.remove();
  const NS = "http://www.w3.org/2000/svg";
  const host = document.createElement("div");
  host.id = "__mdm_rig";
  host.style.cssText = "position:fixed;inset:0;pointer-events:none;z-index:2147483647";
  const style = document.createElement("style");
  style.id = "__mdm_rig_style";
  style.textContent = [
    "#__mdm_rig .cur{position:absolute;left:0;top:0;width:22px;height:22px;",
    "will-change:transform;transform:translate(-200px,-200px);transition:opacity .15s ease}",
    "#__mdm_rig .cur svg{display:block;filter:drop-shadow(0 1px 2.5px rgba(0,0,0,.5))}",
    "#__mdm_rig .ring{position:absolute;left:0;top:0;width:0;height:0;border-radius:50%;",
    "border:2px solid rgba(255,255,255,.95);box-shadow:0 0 0 1px rgba(0,0,0,.4);",
    "transform:translate(-50%,-50%);opacity:0}",
    "#__mdm_rig .cap{position:absolute;left:50%;bottom:9px;transform:translateX(-50%) translateY(6px);",
    "display:flex;gap:7px;align-items:center;padding:9px 15px;border-radius:10px;",
    "background:rgba(16,17,18,.92);color:#f1eee7;",
    "font:500 14.5px/1.2 ui-sans-serif,system-ui,'Segoe UI',Ubuntu,sans-serif;",
    "letter-spacing:.005em;white-space:nowrap;",
    "box-shadow:0 8px 26px rgba(0,0,0,.5),0 0 0 1px rgba(255,255,255,.09);",
    "opacity:0;transition:opacity .2s ease,transform .2s ease}",
    "#__mdm_rig .cap.on{opacity:1;transform:translateX(-50%) translateY(0)}",
    "#__mdm_rig .cap .k{display:inline-block;padding:2.5px 8px;border-radius:6px;",
    "background:#303234;border:1px solid #4a4d50;border-bottom-width:2px;",
    "font:600 13px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;color:#f7f4ed}",
    // An arrow key. At the 13 px of the other caps the arrow is a hairline
    // four pixels long once the GIF is in the Marketplace's column, and the
    // take of the score mode names an arrow in half its presses. Larger, in
    // a line of the same height, so the cap stands level with its neighbours.
    "#__mdm_rig .cap .k.arrow{font-size:19px;font-weight:700;line-height:15.6px}",
  ].join("");
  document.head.appendChild(style);

  // The three shapes the editor's own cursor takes in a take: the arrow, the
  // hand over what a click opens or presses (a score, an equation, a toolbar
  // button) and the I-beam over text. Each is dark with a white edge, so it
  // reads on paper and on slate, and each is drawn with its hot spot (the
  // arrow's tip, the fingertip, the middle of the beam) on the point the
  // Input events go to.
  const cur = document.createElement("div");
  cur.className = "cur";
  const K = "#141517";
  const W = "#ffffff";
  const BEAM = "M9.3 3.6 H14.7 M12 3.6 V20.4 M9.3 20.4 H14.7";
  const SHAPES = {
    arrow: {
      hot: [5, 2.5],
      layers: [{ d: "M5 2.5 L5 19.2 L9.15 15.3 L11.85 21.4 L14.9 20.0 L12.2 14.0 L18 13.8 Z", fill: K, stroke: W, width: 1.7 }],
    },
    hand: {
      hot: [8.5, 1.7],
      layers: [
        {
          d:
            "M7 3.2 A1.5 1.5 0 0 1 10 3.2 L10 9.6 A1.25 1.25 0 0 1 12.5 9.6 L12.5 10.4 A1.25 1.25 0 0 1 15 10.4 " +
            "L15 11.2 A1.25 1.25 0 0 1 17.5 11.2 L17.5 16.5 Q17.5 19.6 15.8 21 L15.8 22.3 L9.6 22.3 L9.6 21 " +
            "Q8.3 19.6 7.2 17.8 L4.6 13.9 A1.3 1.3 0 0 1 6.6 12.4 L7 13 Z",
          fill: K,
          stroke: W,
          width: 1.5,
        },
        { d: "M12.5 10.8 V13.8 M15 11.6 V14.2", fill: "none", stroke: W, width: 1 },
      ],
    },
    ibeam: {
      hot: [12, 12],
      layers: [
        { d: BEAM, fill: "none", stroke: W, width: 4 },
        { d: BEAM, fill: "none", stroke: K, width: 1.7 },
      ],
    },
  };
  const svgs = {};
  Object.keys(SHAPES).forEach(function (name) {
    const s = SHAPES[name];
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("width", "22");
    svg.setAttribute("height", "22");
    svg.setAttribute("viewBox", "0 0 24 24");
    // 24 units drawn in 22 px: the hot spot sits hot * 22/24 px in from the
    // corner, and the drawing is moved back by that much.
    svg.style.cssText =
      "position:absolute;left:" + (-s.hot[0] * 22) / 24 + "px;top:" + (-s.hot[1] * 22) / 24 + "px;display:none";
    s.layers.forEach(function (l) {
      const p = document.createElementNS(NS, "path");
      p.setAttribute("d", l.d);
      p.setAttribute("fill", l.fill);
      p.setAttribute("stroke", l.stroke);
      p.setAttribute("stroke-width", String(l.width));
      p.setAttribute("stroke-linejoin", "round");
      p.setAttribute("stroke-linecap", "round");
      svg.appendChild(p);
    });
    cur.appendChild(svg);
    svgs[name] = svg;
  });
  let shape = "arrow";
  svgs.arrow.style.display = "block";
  function setShape(name) {
    if (!svgs[name] || name === shape) return;
    svgs[shape].style.display = "none";
    svgs[name].style.display = "block";
    shape = name;
  }

  const cap = document.createElement("div");
  cap.className = "cap";
  // One pixel, flipped between two alphas a screen cannot tell apart, so the
  // page can be made to send a screencast frame without anything visible
  // changing (see startRec).
  const dot = document.createElement("div");
  dot.style.cssText = "position:absolute;left:0;top:0;width:1px;height:1px;background:rgba(0,0,0,0)";
  host.appendChild(cur);
  host.appendChild(cap);
  host.appendChild(dot);
  document.body.appendChild(host);
  let flip = false;
  let beat = null;
  function tick() {
    flip = !flip;
    dot.style.background = flip ? "rgba(0,0,0,0.004)" : "rgba(0,0,0,0)";
  }

  window.__mdmRig = {
    version: VERSION,
    tick: tick,
    // The pixel flipped 25 times a second for as long as the camera runs,
    // so the screencast has a frame of whatever is on screen within 40 ms
    // of its getting there (see startRec).
    pulse: function (on) {
      if (beat) clearInterval(beat);
      beat = on ? setInterval(tick, 40) : null;
    },
    move: function (x, y, name) {
      cur.style.transform = "translate(" + x + "px," + y + "px)";
      if (name) setShape(name);
    },
    shape: function (name) {
      setShape(name);
    },
    ring: function (x, y) {
      const r = document.createElement("div");
      r.className = "ring";
      r.style.left = x + "px";
      r.style.top = y + "px";
      host.appendChild(r);
      r.animate(
        [{ width: "0px", height: "0px", opacity: 0.95 }, { width: "38px", height: "38px", opacity: 0 }],
        { duration: 430, easing: "cubic-bezier(.2,.7,.3,1)" }
      ).onfinish = function () {
        r.remove();
      };
    },
    // parts is a list of strings and {k: "Ctrl"} keycaps, so no markup crosses
    // the boundary and Trusted Types has nothing to object to. bottom is how
    // far the caption's foot stands from the window's, for a take that wants
    // it beside what its keys work on; 9 px with none given.
    caption: function (parts, bottom) {
      if (!parts || !parts.length) {
        cap.classList.remove("on");
        return;
      }
      cap.style.bottom = (typeof bottom === "number" ? bottom : 9) + "px";
      while (cap.firstChild) cap.removeChild(cap.firstChild);
      parts.forEach(function (part) {
        if (typeof part === "string") {
          cap.appendChild(document.createTextNode(part));
        } else if (part && part.k) {
          const k = document.createElement("span");
          k.className = /^[\u2190-\u2193]$/.test(part.k) ? "k arrow" : "k";
          k.textContent = part.k;
          cap.appendChild(k);
        }
      });
      cap.classList.add("on");
    },
  };
}

// "Take the next one with [[Ctrl]][[D]]" -> parts for the caption above.
function capParts(text) {
  if (!text) return [];
  return text
    .split(/(\[\[[^\]]+\]\])/)
    .filter((s) => s !== "")
    .map((s) => (s.startsWith("[[") ? { k: s.slice(2, -2) } : s));
}

// ---------------------------------------------------------------- the rig

class Rig {
  constructor() {
    this.x = 0;
    this.y = 0;
    this.frames = [];
    this.recording = false;
    this.timers = new Set();
  }

  async connect() {
    let puppeteer;
    try {
      puppeteer = require(PUPPETEER);
    } catch (e) {
      throw new Error("puppeteer-core is not installed: run `npm install` in tests/");
    }
    this.browser = await puppeteer.connect({
      browserURL: `http://127.0.0.1:${PORT}`,
      defaultViewport: null,
      protocolTimeout: 180000,
    });
    const pages = await this.browser.pages();
    this.page = pages.find((p) => p.url().includes("workbench.html"));
    if (!this.page) throw new Error("no VS Code workbench on port " + PORT + ": is launch.sh running?");
    this.cdp = await this.page.target().createCDPSession();
    return this;
  }

  async close() {
    for (const t of this.timers) clearTimeout(t);
    this.timers.clear();
    if (this.browser) await this.browser.disconnect();
  }

  // ---- the size of the frame ----
  //
  // Set by two things and neither is a CDP call. Electron does not implement
  // Browser.getWindowForTarget, so the window cannot be resized from here; and
  // Emulation.setDeviceMetricsOverride resizes the workbench without telling
  // the webview, which then draws a page laid out for the old width behind a
  // horizontal scrollbar. So the OS window keeps the size VS Code opens it at
  // (1440x900 here) and window.zoomLevel in the profile sets the logical size.
  //
  // zoomLevel 2 is a factor of 1.44: the layout is 1000x625 drawn into
  // 1440x900 physical pixels, and encoding down to 900 wide for the GIF (1000
  // for the review page's mp4) supersamples it.
  // 2 and not 1 because the Marketplace shows a README image at most 710.5 px
  // wide: at zoomLevel 1 the layout is 1200 wide and the prose reaches that
  // page at about 9 px.

  async viewport() {
    return this.page.evaluate(() => ({
      w: innerWidth,
      h: innerHeight,
      dpr: devicePixelRatio,
      pw: Math.round(innerWidth * devicePixelRatio),
      ph: Math.round(innerHeight * devicePixelRatio),
    }));
  }

  // ---- overlay ----

  // Idempotent, and it puts the caption away. The overlay lives in the
  // workbench document, which outlives a run: a run stopped while a caption
  // was up left it up, and the next run recorded one take with the caption
  // across its bottom from first frame to last (so its seam measured
  // nothing) and another opening with it and closing without it (a 1.9%
  // seam).
  async overlay() {
    await this.page.evaluate(overlaySource());
    await this.caption(null);
  }

  // caption("Take the next one with [[Ctrl]][[D]]"), or caption(null) to clear.
  // With bottom, the caption's foot that many px above the window's.
  async caption(text, bottom) {
    await this.page.evaluate((parts, bottom) => window.__mdmRig && window.__mdmRig.caption(parts, bottom), capParts(text), bottom === undefined ? null : bottom);
  }

  // ---- VS Code's notifications ----
  //
  // A toast is drawn by the workbench over whatever the take frames, and one
  // that is up when the camera starts is up in every frame, first and last
  // alike, where the seam cannot see it. Two takes of 2026-09-11 went out
  // under "Extensions have been modified on disk. Please reload the window.",
  // raised at launch because the linked extension had changed since the
  // profile last scanned it; nothing on disk changed while they were
  // recorded. So a take closes every toast with its own clear action before
  // it is set up, and record.js refuses one with a toast on screen when the
  // camera starts or stops.
  async clearToasts() {
    for (let i = 0; i < 10; i++) {
      const left = await this.page.evaluate(() => {
        const up = [...document.querySelectorAll(".notification-toast")].filter((t) => t.offsetWidth || t.offsetHeight);
        for (const t of up) {
          const clear = t.querySelector(".codicon-notifications-clear");
          if (clear) clear.click();
        }
        return up.length;
      });
      if (!left) return;
      await new Promise((r) => setTimeout(r, 200));
    }
  }

  // The text of every toast on screen, for the checks around a take.
  async toasts() {
    return this.page.evaluate(() =>
      [...document.querySelectorAll(".notification-toast")]
        .filter((t) => t.offsetWidth || t.offsetHeight)
        .map((t) => t.innerText.trim().replace(/\s*\n\s*/g, " / "))
    );
  }

  // ---- the webview ----

  // The MDM editor is a webview: an iframe in the workbench holding another
  // iframe with the page main.js builds. The two are same-origin with each
  // other and cross-origin with the workbench, so the offset of the pair is
  // measured from the workbench side and an element's rect from the inside.
  async webview() {
    for (let i = 0; i < 60; i++) {
      for (const f of this.page.frames().filter((f) => f.url().includes("vscode-webview://"))) {
        const has = await f.evaluate(() => !!document.querySelector("#app .mdm-toolbar")).catch(() => false);
        if (has) {
          this.frame = f;
          return f;
        }
      }
      await sleep(250);
    }
    throw new Error("MDM webview frame not found");
  }

  async webviewOffset() {
    return this.page.evaluate(() => {
      const el = document.querySelector(".webview.ready, iframe.webview, .webview");
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top, w: r.width, h: r.height };
    });
  }

  // The centre of a selector inside the webview, in window coordinates.
  async at(selector, opts) {
    const o = opts || {};
    const off = await this.webviewOffset();
    if (!off) throw new Error("no webview element in the workbench");
    const r = await this.frame.evaluate(
      (sel, nth) => {
        const el = document.querySelectorAll(sel)[nth || 0];
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { left: b.left, top: b.top, width: b.width, height: b.height };
      },
      selector,
      o.nth || 0
    );
    if (!r) throw new Error("selector not found in webview: " + selector);
    const fx = o.fx === undefined ? 0.5 : o.fx;
    const fy = o.fy === undefined ? 0.5 : o.fy;
    return { x: Math.round(off.x + r.left + r.width * fx), y: Math.round(off.y + r.top + r.height * fy) };
  }

  // A drop-down row found by what it says, since the theme menu is built from
  // whatever colour themes are installed and its indices are not stable.
  //
  // Prefix and not equality: themeMenuLabel (main.js) appends a tick to the
  // row of the theme that is set, so that row reads "MDM Light ✓" and not
  // "MDM Light".
  async atLabel(selector, text) {
    const off = await this.webviewOffset();
    const r = await this.frame.evaluate(
      (sel, want) => {
        const rows = [...document.querySelectorAll(sel)];
        const norm = (e) => (e.textContent || "").trim().toLowerCase();
        const el =
          rows.find((e) => norm(e) === want.toLowerCase()) ||
          rows.find((e) => norm(e).startsWith(want.toLowerCase()));
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { left: b.left, top: b.top, width: b.width, height: b.height };
      },
      selector,
      text
    );
    if (!r) throw new Error(`no ${selector} reads ${JSON.stringify(text)}`);
    return { x: Math.round(off.x + r.left + r.width / 2), y: Math.round(off.y + r.top + r.height / 2) };
  }

  // ---- pointer ----

  // The shape the editor's own cursor has at (x, y), picked the way the page
  // would pick it: "hand" where the CSS cursor is pointer, "ibeam" over text,
  // "arrow" anywhere else. The OS draws the real cursor and it never reaches
  // the frames, so the drawn one has to be told; before this the arrow
  // crossed the score and the toolbar where the editor shows a hand.
  async shapeAt(x, y, off) {
    try {
      return await this.pickShape(x, y, off === undefined ? await this.webviewOffset() : off);
    } catch (e) {
      // A late check can find the page gone from under it (a webview closed
      // between takes, the rig disconnected at the end of a run), and a throw
      // there, inside a timer, ended the run. The arrow is the safe answer.
      return "arrow";
    }
  }

  async pickShape(x, y, o) {
    const inside = !!(o && this.frame && x >= o.x && y >= o.y && x < o.x + o.w && y < o.y + o.h);
    const pick = (px, py) => {
      const el = document.elementFromPoint(px, py);
      if (!el) return "arrow";
      const c = getComputedStyle(el).cursor;
      if (c === "pointer") return "hand";
      if (c === "text" || c === "vertical-text") return "ibeam";
      if (c !== "auto") return "arrow";
      // auto is the I-beam over a run of text and the arrow anywhere else.
      const at = document.caretRangeFromPoint && document.caretRangeFromPoint(px, py);
      const node = at && at.startContainer;
      if (!node || node.nodeType !== 3) return "arrow";
      const r = document.createRange();
      r.selectNodeContents(node);
      for (const b of r.getClientRects()) {
        if (px >= b.left && px <= b.right && py >= b.top && py <= b.bottom) return "ibeam";
      }
      return "arrow";
    };
    return inside ? await this.frame.evaluate(pick, x - o.x, y - o.y) : await this.page.evaluate(pick, x, y);
  }

  // What is under a still pointer can change without it moving (a click opens
  // a score's source under it, the player's row pushes the page down), and the
  // editor's cursor changes with it. Checked again a moment later, and only if
  // the pointer is still where it was.
  reshapeLater(ms) {
    const x = this.x;
    const y = this.y;
    const timer = setTimeout(async () => {
      this.timers.delete(timer);
      if (this.x !== x || this.y !== y) return;
      const shape = await this.shapeAt(x, y);
      if (this.x !== x || this.y !== y) return;
      await this.page.evaluate((s) => window.__mdmRig && window.__mdmRig.shape(s), shape).catch(() => {});
    }, ms);
    this.timers.add(timer);
  }

  async warp(x, y) {
    this.x = x;
    this.y = y;
    await this.cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, buttons: 0 });
    const shape = await this.shapeAt(x, y);
    await this.page.evaluate((p) => window.__mdmRig && window.__mdmRig.move(p.x, p.y, p.shape), { x, y, shape });
  }

  // A travel as a hand makes it (motion.js): for as long as its distance and
  // the size of its target make it take, with no ms given, on a shallow arc,
  // quick off the mark and slow into the target. opts.size is how wide the
  // thing aimed at is, opts.pace stretches the time (above 1) or shortens
  // it, and opts.direct has the pointer go all the way in one stroke. A ms
  // given is the time outright.
  //
  // One Input event per step, with the drawn pointer kept in step. The event
  // goes first, so a hover it sets off (the buttons of a score, a tooltip,
  // the wash under a button) is there when the shape is picked. The pointer
  // is put where the clock says it is at each step, so the move takes the
  // time it was given however long a step takes to send; counted out in
  // steps with a fixed sleep between them, as it first was, a move ran
  // longer than its time by whatever the three round trips of a step cost.
  async moveTo(target, ms, opts) {
    const o = opts || {};
    const path = travel({ x: this.x, y: this.y }, target, { ms, width: o.size, pace: o.pace, direct: o.direct });
    const off = await this.webviewOffset();
    const began = Date.now();
    for (;;) {
      const t = Math.min(path.ms, Date.now() - began);
      const p = path.at(t);
      const x = Math.round(p.x);
      const y = Math.round(p.y);
      if (x !== this.x || y !== this.y) {
        await this.cdp.send("Input.dispatchMouseEvent", {
          type: "mouseMoved",
          x,
          y,
          buttons: o.buttons || 0,
          modifiers: o.modifiers || 0,
        });
        const shape = await this.shapeAt(x, y, off);
        await this.page.evaluate((p) => window.__mdmRig && window.__mdmRig.move(p.x, p.y, p.shape), { x, y, shape });
        this.x = x;
        this.y = y;
      }
      if (t >= path.ms) break;
      await sleep(8);
    }
  }

  // The pointer taken to a place and pressed there: the travel, the moment a
  // hand takes to press once it has arrived (SETTLE), and the click. With
  // opts.tip the pointer stays until the editor's tooltip has come up and
  // been read (readTip), for a button nothing else on screen names. The
  // rest of opts goes to the travel and to the click.
  async pressAt(target, opts) {
    const o = opts || {};
    await this.moveTo(target, o.ms, o);
    if (o.tip) await this.readTip();
    else await sleep(o.settle === undefined ? SETTLE : o.settle);
    if (o.clickCount === 2) await this.doubleClick(o);
    else await this.click(o);
  }

  // The tooltip of the thing under the pointer: what it says, and whether
  // it is whole on screen yet. The editor draws a tip from the aria-label of
  // whatever carries .mdm-tip, in its ::after, faded in 200 ms after the
  // pointer comes (style.css); the pointer is a real one to the page, so
  // :hover names the thing, the innermost of them where a button stands
  // inside another thing that has a tip. A score puts up a tip of its own
  // for the buttons of its chrome (.mdm-score-edit__tip, two lines of it on
  // a line's end), which is read off what it shows.
  async tipUnder() {
    return this.evalFrame(() => {
      const whole = (style) => style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity) > 0.99;
      const own = document.querySelector("#app .mdm-score-edit__tip--shown");
      if (own) {
        const label = Array.from(own.children, (line) => line.textContent).join("\n") || own.textContent;
        return { label, whole: whole(getComputedStyle(own)) };
      }
      const under = document.querySelectorAll("#app .mdm-tip:hover");
      const el = under[under.length - 1];
      if (!el) return { label: "", whole: false };
      return { label: el.getAttribute("aria-label") || "", whole: whole(getComputedStyle(el, "::after")) };
    });
  }

  // The pointer left where it is until the tooltip there has come up and
  // been on screen for what it takes to read (motion.js, readTime). The
  // reading is counted from the tip being whole and not from the pointer's
  // arrival, since how far along the tip is by then depends on the travel:
  // waiting 1130 ms from the arrival left "Score navigation" whole for 1130,
  // the tip having started up before the pointer stopped. A take that waits
  // for a tip on a thing that has none, or whose tip does not come up (one
  // put away by a click is not shown again until the pointer has left), is
  // stopped: the wait would be a pointer standing still for nothing. What
  // the tip said is returned, for a take that counts on what it says.
  async readTip() {
    const until = Date.now() + 1500;
    let tip = await this.tipUnder();
    while (!tip.whole && Date.now() < until) {
      await sleep(20);
      tip = await this.tipUnder();
    }
    if (!tip.label) throw new Error("the pointer waits for a tooltip on a thing that has none");
    if (!tip.whole) throw new Error(`the tooltip ${JSON.stringify(tip.label)} did not come up`);
    await sleep(readTime(tip.label));
    return tip.label;
  }

  async click(opts) {
    const o = opts || {};
    await this.page.evaluate((p) => window.__mdmRig && window.__mdmRig.ring(p.x, p.y), { x: this.x, y: this.y });
    const base = {
      x: this.x,
      y: this.y,
      button: "left",
      clickCount: o.clickCount || 1,
      modifiers: o.modifiers || 0,
    };
    await this.cdp.send("Input.dispatchMouseEvent", { ...base, type: "mousePressed", buttons: 1 });
    await sleep(o.hold === undefined ? 70 : o.hold);
    await this.cdp.send("Input.dispatchMouseEvent", { ...base, type: "mouseReleased", buttons: 0 });
    this.reshapeLater(180);
    this.reshapeLater(700);
  }

  // Modifier 1 is Alt in the protocol's bitmask (Alt 1, Ctrl 2, Meta 4, Shift 8).
  async altClick() {
    await this.click({ modifiers: 1 });
  }

  // Two presses, the second counted as the second, which is what a hand
  // sends: CodeMirror reads the count from the event's detail (getClickType in
  // @codemirror/view, in Chrome), and the first press is the one that puts
  // the caret down, or adds one with Alt, before the second takes the word.
  // The modifiers ride on the mouse events alone, with no key sent for them,
  // so a held Alt never reaches VS Code as a clean tap that would open its
  // menu bar (addsCaret in main.js has that story).
  async doubleClick(opts) {
    const o = opts || {};
    await this.page.evaluate((p) => window.__mdmRig && window.__mdmRig.ring(p.x, p.y), { x: this.x, y: this.y });
    const base = { x: this.x, y: this.y, button: "left", modifiers: o.modifiers || 0 };
    for (const n of [1, 2]) {
      await this.cdp.send("Input.dispatchMouseEvent", { ...base, type: "mousePressed", buttons: 1, clickCount: n });
      await sleep(55);
      await this.cdp.send("Input.dispatchMouseEvent", { ...base, type: "mouseReleased", buttons: 0, clickCount: n });
      if (n === 1) await sleep(85);
    }
    this.reshapeLater(180);
  }

  // A press here, a travel to target with the button held, and the release
  // there: a selection dragged out with the mouse, or a thing carried. A
  // hand carries slower than it points, a third slower here with no ms and
  // no opts.pace given, and looks at where it has brought the thing before
  // it lets go (opts.hold, 140 ms with none given).
  async dragTo(target, ms, opts) {
    const o = opts || {};
    const base = { button: "left", clickCount: 1 };
    await this.page.evaluate((p) => window.__mdmRig && window.__mdmRig.ring(p.x, p.y), { x: this.x, y: this.y });
    await this.cdp.send("Input.dispatchMouseEvent", { ...base, x: this.x, y: this.y, type: "mousePressed", buttons: 1 });
    await sleep(110);
    await this.moveTo(target, ms, { buttons: 1, size: o.size, pace: o.pace === undefined ? 1.3 : o.pace, direct: o.direct });
    await sleep(o.hold === undefined ? 140 : o.hold);
    await this.cdp.send("Input.dispatchMouseEvent", { ...base, x: this.x, y: this.y, type: "mouseReleased", buttons: 0 });
    this.reshapeLater(180);
  }

  // ---- reading the document ----
  //
  // CodeMirror builds only the lines in view, so a score below the fold is not
  // in the DOM and a selector for it cannot resolve. Anything that reaches down
  // the document goes through one of these.

  async evalFrame(fn, ...args) {
    return this.frame.evaluate(fn, ...args);
  }

  async waitFor(fn, opts) {
    const o = opts || {};
    const deadline = Date.now() + (o.timeout || 8000);
    for (;;) {
      const v = await this.frame.evaluate(fn, o.arg).catch(() => null);
      if (v) return v;
      if (Date.now() > deadline) throw new Error("waitFor timed out: " + fn.toString().slice(0, 90));
      await sleep(o.poll || 120);
    }
  }

  // Framing, as against scrolling. A wheel event is quantised and lands where
  // it lands, which is fine inside a take and no use for putting a score at a
  // chosen height before one starts. This sets the scroller directly and only
  // ever runs before the camera does.
  async frameAt(selector, top, opts) {
    const o = opts || {};
    const tol = o.tolerance === undefined ? 6 : o.tolerance;
    for (let i = 0; i < (o.tries || 14); i++) {
      const r = await this.frame.evaluate(
        (sel, want) => {
          const sc = document.querySelector("#app .cm-scroller");
          const el = document.querySelector(sel);
          if (!el) {
            sc.scrollTop += 300;
            return { missing: true };
          }
          const d = el.getBoundingClientRect().top - sc.getBoundingClientRect().top - want;
          const before = sc.scrollTop;
          sc.scrollTop += d;
          const max = sc.scrollHeight - sc.clientHeight;
          // Nothing can sit lower than the top of the document allows or
          // higher than its end allows; asking for either gets the nearest.
          return {
            missing: false,
            delta: Math.round(d),
            pinned: (d < 0 && before === 0) || (d > 0 && before >= max - 1),
          };
        },
        selector,
        top
      );
      await sleep(o.settle === undefined ? 200 : o.settle);
      if (!r.missing && (Math.abs(r.delta) <= tol || r.pinned)) {
        await this.clearTopEdge();
        return r;
      }
    }
    throw new Error(`frameAt could not settle ${selector} at ${top}`);
  }

  // A row of text cut by the top edge of the pane reads as a crop: the first
  // take framed at an arbitrary height opened on the bottom half of a line of
  // prose. This scrolls the cut row out of view, so the edge falls in the gap
  // between two rows. It measures visual rows (a Range's client rects), not
  // .cm-line elements, because one source line wraps into several rows. It
  // only ever moves the frame up, by less than one row (29 px at this zoom),
  // so it cannot push a take's last block below the fold.
  async clearTopEdge() {
    await this.frame.evaluate(() => {
      const sc = document.querySelector("#app .cm-scroller");
      const edge = sc.getBoundingClientRect().top;
      let cut = 0;
      for (const el of document.querySelectorAll("#app .cm-content .cm-line")) {
        const range = document.createRange();
        range.selectNodeContents(el);
        for (const r of range.getClientRects()) {
          if (r.height && r.top < edge - 0.5 && r.bottom > edge + 0.5) cut = Math.max(cut, r.bottom - edge);
        }
      }
      if (cut) sc.scrollTop += Math.ceil(cut) + 2;
    });
    await sleep(200);
  }

  async atScrollTop() {
    return this.frame.evaluate(() => document.querySelector("#app .cm-scroller").scrollTop);
  }

  async scrollTop(px) {
    await this.frame.evaluate((v) => {
      document.querySelector("#app .cm-scroller").scrollTop = v;
    }, px);
    await sleep(220);
  }

  // A scroll that lands where it was asked to. A wheel is quantised, so a take
  // that scrolls down by wheel and back by the same wheel does not end on the
  // offset it began at, and the loop jumps. This moves the scroller on the
  // curve of the pointer's own stroke (motion.js), off quickly and slowing
  // to a stop as a page flicked with a wheel does, which looks like a scroll
  // and ends on an exact offset. By the clock, as moveTo is, so it takes the
  // time it is given.
  async smoothScrollTo(target, ms) {
    const dur = ms === undefined ? 480 : ms;
    const from = await this.atScrollTop();
    const began = Date.now();
    for (;;) {
      const t = Math.min(dur, Date.now() - began);
      await this.frame.evaluate((v) => {
        document.querySelector("#app .cm-scroller").scrollTop = v;
      }, Math.round(from + (target - from) * stroke(t / dur)));
      if (t >= dur) break;
      await sleep(8);
    }
  }

  // ---- keyboard ----

  // Text typed a key at a time, `delay` ms a key on average and unevenly, as
  // fingers type (keyGaps in motion.js): at one fixed interval a line of
  // text came out as a teleprinter's. opts.even keeps the fixed interval.
  async type(text, delay, opts) {
    const base = delay === undefined ? 55 : delay;
    if (!base || (opts && opts.even)) {
      await this.page.keyboard.type(text, { delay: base });
      return;
    }
    const keys = Array.from(text);
    const gaps = keyGaps(text, base);
    for (let i = 0; i < keys.length; i++) {
      await this.page.keyboard.type(keys[i]);
      if (i < keys.length - 1) await sleep(gaps[i]);
    }
  }

  async press(chord) {
    const parts = chord.split("+");
    const key = parts.pop();
    for (const m of parts) await this.page.keyboard.down(m);
    await this.page.keyboard.press(key);
    for (const m of parts.reverse()) await this.page.keyboard.up(m);
  }

  // ---- recording ----

  async startRec(outDir) {
    fs.rmSync(outDir, { recursive: true, force: true });
    fs.mkdirSync(outDir, { recursive: true });
    this.outDir = outDir;
    this.frames = [];
    this.lag = 0;
    let seq = 0;
    this.recording = true;
    this._onFrame = async ({ data, metadata, sessionId }) => {
      if (!this.recording) return;
      const file = path.join(outDir, `f${String(seq++).padStart(5, "0")}.png`);
      fs.writeFileSync(file, Buffer.from(data, "base64"));
      this.frames.push({ file, t: metadata.timestamp });
      // How far behind the screen the camera runs: a frame is stamped when
      // it is taken, and gets here when the ones before it have been.
      this.lag = Math.max(this.lag, Date.now() / 1000 - metadata.timestamp);
      try {
        await this.cdp.send("Page.screencastFrameAck", { sessionId });
      } catch (e) {
        /* the session can close under us at the end of a take */
      }
    };
    this.cdp.on("Page.screencastFrame", this._onFrame);
    await this.cdp.send("Page.startScreencast", { format: "png", quality: 100, everyNthFrame: 1 });
    // The screencast sends a frame only when the page changes, so a take
    // whose first second stands still could get its first frame late and
    // lose its opening. Not seen to happen (the 1.9% seam that prompted this
    // was a caption left up by a stopped run, see overlay()), but cheap to
    // rule out: the take waits for a first frame, nudging the invisible pixel.
    for (let i = 0; i < 40 && !this.frames.length; i++) {
      await this.page.evaluate(() => window.__mdmRig && window.__mdmRig.tick && window.__mdmRig.tick());
      await sleep(50);
    }
    if (!this.frames.length) throw new Error("the screencast sent no first frame");
    // And a frame of everything after it. What changes in the webview with
    // nothing painted anew, a tooltip faded in by its opacity, did not
    // always send one: the tip of a score's line-end button came up 300 ms
    // into a hover of 1.2 s and reached the take with the frame of the press
    // that ended it, 1.155 s after the frame before (the frames of
    // 2026-10-06), so the take showed the pointer standing on a button for
    // no reason and the tip for a tenth of a second. The pixel is flipped
    // from the page's own timer while the camera runs, and every frame it
    // forces carries the window as it then is.
    await this.page.evaluate(() => window.__mdmRig && window.__mdmRig.pulse && window.__mdmRig.pulse(true));
  }

  async stopRec() {
    this.recording = false;
    await this.page.evaluate(() => window.__mdmRig && window.__mdmRig.pulse && window.__mdmRig.pulse(false)).catch(() => {});
    try {
      await this.cdp.send("Page.stopScreencast");
    } catch (e) {
      /* already gone */
    }
    if (this._onFrame) this.cdp.off("Page.screencastFrame", this._onFrame);
    return this.frames.slice();
  }
}

// ---------------------------------------------------------------- encoding

// The Marketplace draws nothing round a README image (its one rule for them
// is max-width:100%, with no border, shadow or radius), so a light clip on
// its white page has no edge. The edge is drawn into the frames instead.
// #c8c8c8 one pixel wide in the 900 px GIF, shown in the 710.5 px column,
// covers 79% of a screen pixel, which averages to about #d4d4d4 against the
// white (0.79 x 200 + 0.21 x 255 = 212), the grey of a 1 px CSS hairline.
// The mp4 and its poster, 1000 px wide and only for the review page, carry
// the same line at 71% of a pixel (#d8d8d8).
const HAIRLINE = "drawbox=x=0:y=0:w=iw:h=ih:color=0xc8c8c8:t=1";

// The screencast emits a frame when the page changes, so the gaps between
// frames are uneven. The concat demuxer replays them on their own clock and
// ffmpeg resamples to a constant rate, which a player and a GIF both want.
function buildConcat(dir, frames) {
  const lines = [];
  for (let i = 0; i < frames.length; i++) {
    const dur = i + 1 < frames.length ? frames[i + 1].t - frames[i].t : 0.4;
    lines.push(`file '${path.basename(frames[i].file)}'`);
    lines.push(`duration ${Math.max(0.008, dur).toFixed(4)}`);
  }
  // The demuxer honours the last duration only if the last file is repeated.
  lines.push(`file '${path.basename(frames[frames.length - 1].file)}'`);
  const list = path.join(dir, "concat.txt");
  fs.writeFileSync(list, lines.join("\n") + "\n");
  return list;
}

function ffmpeg(args) {
  execFileSync("ffmpeg", ["-y", "-v", "error", ...args], { stdio: ["ignore", "ignore", "pipe"] });
}

function encodeMp4(dir, frames, out, opts) {
  const o = opts || {};
  if (!frames || frames.length < 2) throw new Error("encodeMp4: need at least 2 frames");
  const list = buildConcat(dir, frames);
  const chain = [`scale=${o.width || 1000}:-2:flags=lanczos`, HAIRLINE, `fps=${o.fps || 30}`, "format=yuv420p"];
  ffmpeg([
    "-f", "concat", "-safe", "0", "-i", list,
    "-vf", chain.join(","),
    "-c:v", "libx264", "-preset", "veryslow", "-crf", String(o.crf || 20),
    "-an", "-movflags", "+faststart", out,
  ]);
}

function encodeGif(dir, frames, out, opts) {
  const o = opts || {};
  if (!frames || frames.length < 2) throw new Error("encodeGif: need at least 2 frames");
  const list = buildConcat(dir, frames);
  const pal = path.join(dir, "palette.png");
  const pre = `fps=${o.fps || 14},scale=${o.width || 900}:-1:flags=lanczos,${HAIRLINE}`;
  ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-vf", `${pre},palettegen=max_colors=192:stats_mode=diff`, pal]);
  ffmpeg([
    "-f", "concat", "-safe", "0", "-i", list, "-i", pal,
    "-lavfi", `${pre}[v];[v][1:v]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle`,
    "-loop", "0", out,
  ]);
}

// The still a <video> shows before it plays, and the one a reader keeps if a
// page ever declines to autoplay: the first frame, which every clip is written
// to come back to.
function encodePoster(frames, out, opts) {
  const o = opts || {};
  ffmpeg(["-i", frames[0].file, "-vf", `scale=${o.width || 1000}:-2:flags=lanczos,${HAIRLINE}`, "-q:v", "3", out]);
}

// The share of the pixels of a take's last frame that differ from its first
// by more than 24 grey levels. Every clip is written to close on the frame it
// opened on, and this holds it to that: a block left open, a player row left
// in the toolbar or a page left a row off all measure in whole percent (the
// first takes that failed measured 7.6 and 8.8), a caret one character over
// in hundredths.
function seam(frames) {
  const gray = (f) =>
    execFileSync("ffmpeg", ["-v", "error", "-i", f, "-f", "rawvideo", "-pix_fmt", "gray", "-"], {
      maxBuffer: 64 * 1024 * 1024,
    });
  const a = gray(frames[0].file);
  const b = gray(frames[frames.length - 1].file);
  let n = 0;
  for (let i = 0; i < a.length; i++) if (Math.abs(a[i] - b[i]) > 24) n++;
  return n / a.length;
}

// A take that ends somewhere other than where it began can still loop without
// a jump: its last stretch dissolves into its first frame. The tail is
// resampled at a steady rate, because the screencast sends a frame only on a
// change and a tail that stood still would dissolve in one step; each
// resampled frame is the real frame of that moment blended with the first by a
// smoothstep, so what moves in the tail (a playhead) keeps moving while it
// fades. The last one is the first frame exactly, so the seam of a take that
// dissolves, as the tour does, measures 0 by construction. The check stays
// for any clip that closes on its own first frame.
function dissolveHome(frames, seconds, opts) {
  const o = opts || {};
  const fps = o.fps || 30;
  const end = frames[frames.length - 1].t;
  const start = end - seconds;
  const kept = frames.filter((f) => f.t < start);
  if (!kept.length) throw new Error("dissolveHome: the take is shorter than its dissolve");
  const dir = path.dirname(frames[0].file);
  const steps = Math.max(2, Math.round(seconds * fps));
  const out = kept.slice();
  let j = kept.length - 1;
  for (let k = 0; k <= steps; k++) {
    const t = start + (seconds * k) / steps;
    while (j + 1 < frames.length && frames[j + 1].t <= t) j++;
    const x = k / steps;
    const a = x * x * (3 - 2 * x);
    const file = path.join(dir, `d${String(k).padStart(4, "0")}.png`);
    ffmpeg([
      "-i", frames[j].file, "-i", frames[0].file,
      "-filter_complex", `[0:v][1:v]blend=all_expr='A*${(1 - a).toFixed(5)}+B*${a.toFixed(5)}',format=rgb24`,
      "-frames:v", "1", file,
    ]);
    out.push({ file, t });
  }
  return out;
}

module.exports = { Rig, sleep, SETTLE, encodeMp4, encodeGif, encodePoster, seam, dissolveHome };
