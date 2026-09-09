// The review panel. Shows one README at a time, fills its clip slots with the
// takes for the chosen format and look, and keeps the appendix and the counts
// in step.
//
// A slot gets exactly what the Marketplace would serve from the line
// markup.js writes for the chosen format: a bare <img>, which is the line
// apply.js puts in the README, or a <video> with only the attributes its
// sanitizer keeps (src, poster, title, autoplay, loop; muted, controls and
// playsinline are stripped, see markup.js). No class and no style, because the
// page allows neither, so nothing here can make a clip look better than it
// will there.
//
// What a stripped video does then depends on the reader. Chrome does not
// autoplay it for a reader who lands from outside the Marketplace, and any
// click on this page (a click on the review panel included) counts as the
// activation that would let it, so the "reader" setting decides instead:
// "chrome" leaves the video on its poster, which is what that reader gets,
// and "plays" lets it run, as Firefox, Safari and a Chrome reader who clicked
// through from another Marketplace page see it. The appendix below the page
// is for watching the clips, so its videos keep muted and controls.
//
// The settings live in the URL hash (format=, look=, source=, reader=), so a
// view can be linked and preview/shoot.js can ask for one.

(function () {
  "use strict";

  const byId = {};
  MOCK.clips.forEach((c) => (byId[c.id] = c));
  // Against the page's folder and not the document: in Office Viewer the
  // document's address is the webview's own, and every clip set as
  // "clips/<name>" came up as a broken image. See the link in shell.html.tmpl.
  const HERE = document.getElementById("page-dir").href;
  const at = (rel) => new URL(rel, HERE).href;
  const state = { format: "gif", look: "light", source: "live", reader: "chrome" };

  function readHash() {
    new URLSearchParams(location.hash.slice(1)).forEach((v, k) => {
      if (k in state) state[k] = v;
    });
    if (!MOCK.sources.some((s) => s.key === state.source)) state.source = "live";
  }

  function writeHash() {
    history.replaceState(null, "", "#" + new URLSearchParams(state).toString());
  }

  function take(id) {
    const per = MOCK.media[id] || {};
    return per[state.look] || null;
  }

  function mediaEl(clip, rec, served) {
    if (state.format === "mp4" && rec.mp4) {
      const v = document.createElement("video");
      v.src = at(rec.mp4);
      if (rec.poster) v.poster = at(rec.poster);
      v.setAttribute("title", clip.alt);
      v.loop = true;
      if (!served) {
        v.muted = true;
        v.controls = true;
        v.autoplay = true;
      } else if (state.reader === "plays") {
        // The file has no audio track, so Firefox and Safari play it without
        // muted; muted here only stands in for that in the Chrome this page
        // is being looked at in.
        v.muted = true;
        v.autoplay = true;
      } else {
        v.preload = "metadata";
      }
      return v;
    }
    const img = document.createElement("img");
    img.src = at(rec.gif || rec.mp4);
    img.alt = clip.alt;
    return img;
  }

  function missingEl(id) {
    const s = document.createElement("span");
    s.className = "missing";
    s.textContent = `not recorded: ${id} (${state.look}); node record.js --look ${state.look} ${id}`;
    return s;
  }

  function visible() {
    return document.querySelector(`.markdown[data-source="${CSS.escape(state.source)}"]`);
  }

  function fillSlots() {
    document.querySelectorAll(".markdown").forEach((md) => {
      md.hidden = md.dataset.source !== state.source;
      if (md.hidden) md.querySelectorAll(".mdm-slot").forEach((s) => (s.textContent = ""));
    });
    visible()
      .querySelectorAll(".mdm-slot")
      .forEach((slot) => {
        const clip = byId[slot.dataset.clip];
        const rec = take(slot.dataset.clip);
        slot.textContent = "";
        slot.appendChild(clip && rec ? mediaEl(clip, rec, true) : missingEl(slot.dataset.clip));
      });
  }

  function source() {
    return MOCK.sources.find((s) => s.key === state.source);
  }

  function fillAppendix() {
    const host = document.getElementById("clip-list");
    host.textContent = "";
    source().clips.forEach((id, i) => {
      const clip = byId[id];
      const rec = take(id);
      const row = document.createElement("div");
      row.className = "clip-row";
      const left = document.createElement("div");
      left.appendChild(clip && rec ? mediaEl(clip, rec, false) : missingEl(id));
      row.appendChild(left);

      const right = document.createElement("div");
      const h = document.createElement("h3");
      h.textContent = `${i + 1}. ${clip ? clip.title : id}`;
      right.appendChild(h);
      if (rec && rec.meta) {
        const m = rec.meta;
        const facts = document.createElement("p");
        facts.className = "facts";
        const kb = (n) => (n / 1024).toFixed(0) + " KB";
        facts.textContent =
          `${m.seconds.toFixed(1)} s · recorded ${state.look} · mp4 ${kb(m.mp4)}` +
          (m.poster ? ` + poster ${kb(m.poster)}` : "") +
          ` · gif ${kb(m.gif)}`;
        right.appendChild(facts);
      }
      if (clip) {
        const pre = document.createElement("pre");
        pre.textContent = `<!-- clip: ${id} -->\n${clip.markup[state.format]}`;
        right.appendChild(pre);
      }
      row.appendChild(right);
      host.appendChild(row);
    });
  }

  function stats() {
    const s = source();
    let bytes = 0;
    s.clips.forEach((id) => {
      const rec = take(id);
      if (!rec || !rec.meta) return;
      bytes += state.format === "mp4" ? rec.meta.mp4 + (rec.meta.poster || 0) : rec.meta.gif;
    });
    document.getElementById("stats").textContent =
      `${s.words} words of prose, ${s.clips.length} clips, ` +
      `${(bytes / 1024 / 1024).toFixed(2)} MB of ${state.format}` +
      (state.format === "mp4" ? " and posters" : "") +
      ". Served from the repository; nothing is added to the .vsix." +
      (state.format === "mp4" && state.reader === "chrome"
        ? " On Chrome, arriving from outside the Marketplace, each video is its poster: no autoplay without muted, and no controls to start it."
        : "");
  }

  function buildSourceButtons() {
    const seg = document.querySelector('.seg[data-set="source"]');
    MOCK.sources.forEach((s) => {
      const b = document.createElement("button");
      b.dataset.v = s.key;
      b.textContent = s.label;
      seg.appendChild(b);
    });
  }

  function paint() {
    document.querySelectorAll(".seg").forEach((seg) => {
      seg.querySelectorAll("button").forEach((b) => b.classList.toggle("on", state[seg.dataset.set] === b.dataset.v));
    });
    fillSlots();
    fillAppendix();
    stats();
    writeHash();
  }

  buildSourceButtons();
  readHash();
  document.querySelectorAll(".seg").forEach((seg) => {
    seg.addEventListener("click", (e) => {
      const b = e.target.closest("button");
      if (!b) return;
      state[seg.dataset.set] = b.dataset.v;
      paint();
    });
  });
  window.addEventListener("hashchange", () => {
    readHash();
    paint();
  });
  paint();
})();
