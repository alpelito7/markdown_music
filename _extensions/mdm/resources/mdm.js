// mdm.js: renders the MDM music blocks with abcjs once the page has loaded,
// and brings the player bar of a `.play` block into the same manners as the
// MDM editor's: a stop button, a draggable progress bar with its fill, a
// volume with mute, tooltips drawn from aria-label, and the notes lighting up
// on the score as they sound. What the bar looks like is in mdm-look.css,
// which is the port of the editor's own stylesheet; this file is what that
// sheet has to have in front of it.
(function () {
  "use strict";

  // ---------- The audio graph ----------

  // One volume for the whole page: set it on one score and every player
  // sounds at that level. Mute is a state of its own and not a level of zero,
  // so silencing a score and bringing it back does not cost the level set.
  var audioVolume = 1;
  var audioMuted = false;
  var audioCtx = null;
  var audioGain = null;
  var audioProxy = null;

  // abcjs plays straight into activeAudioContext().destination and offers no
  // volume hook, so the context it is handed is a Proxy whose destination is
  // a gain of ours, behind which sits the real output; the slider moves that
  // gain live, mid playback included. Everything else forwards to the real
  // context, bound so the native methods keep their receiver.
  function ensureAudioGraph() {
    if (audioCtx) return audioCtx;
    var Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return null;
    audioCtx = new Ctor();
    audioGain = audioCtx.createGain();
    audioGain.gain.value = audioMuted ? 0 : audioVolume;
    audioGain.connect(audioCtx.destination);
    return audioCtx;
  }

  // Registered before anything in the engine asks for a context: its
  // supportsAudio() goes through activeAudioContext(), which makes a context
  // of its own when none is registered, and that one would then run for the
  // rest of the session beside ours, holding a second output stream open for
  // nothing.
  function registerAudioGraph(A) {
    if (!ensureAudioGraph() || !A.synth || !A.synth.registerAudioContext) return;
    if (!audioProxy) {
      audioProxy = new Proxy(audioCtx, {
        get: function (target, prop) {
          if (prop === "destination") return audioGain;
          var value = target[prop];
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    }
    A.synth.registerAudioContext(audioProxy);
  }

  // The level reaching the output. A jump straight to zero cuts the waveform
  // wherever it happens to be and clicks; a 20 ms ramp is short enough to read
  // as immediate and long enough to land quietly.
  function applyVolume() {
    if (!audioGain || !audioCtx) return;
    var now = audioCtx.currentTime;
    audioGain.gain.cancelScheduledValues(now);
    audioGain.gain.setValueAtTime(audioGain.gain.value, now);
    audioGain.gain.linearRampToValueAtTime(
      audioMuted ? 0 : audioVolume,
      now + 0.02
    );
  }

  // A context made outside a user gesture starts suspended; the first press on
  // a bar is what lets it run.
  function wakeAudio() {
    if (audioCtx && audioCtx.state !== "running") {
      try {
        audioCtx.resume().catch(function () {});
      } catch (e) {
        // a context that cannot be resumed here; play will try again
      }
    }
  }

  // ---------- Icons ----------

  // Drawn to fill with currentColor, on the same 16-unit grid as the editor's.
  // A <g> around the stop shape because the rules that colour these buttons
  // reach for one: that is how abcjs draws its own.
  var STOP_ICON =
    '<svg viewBox="0 0 16 16"><g><rect x="3" y="3" width="10" height="10" rx="1.8"/></g></svg>';
  var SPEAKER_CONE =
    '<path d="M2 6.5Q2 6 2.5 6H4.6L7.9 3.2Q8.8 2.5 8.8 3.6V12.4Q8.8 13.5 7.9 12.8L4.6 10H2.5Q2 10 2 9.5Z"/>';
  var SPEAKER_WAVE =
    '<path d="M11 5.2q2 2.8 0 5.6l-.9-.62q1.55-2.18 0-4.36z"/>';
  var SPEAKER_SLASH =
    '<path d="M11.31 5.32 14.31 9.72 13.49 10.28 10.49 5.88Z"/>';
  var VOLUME_ICON =
    '<svg viewBox="0 0 16 16">' + SPEAKER_CONE + SPEAKER_WAVE + "</svg>";
  var VOLUME_OFF_ICON =
    '<svg viewBox="0 0 16 16">' + SPEAKER_CONE + SPEAKER_SLASH + "</svg>";

  // ---------- The volume control ----------

  function volumeControl() {
    var wrap = document.createElement("div");
    wrap.className = "mdm-audio-vol";
    // The speaker is the mute button. Here the icon reports the state and not
    // the destination of the click: it sits in an open bar next to the level
    // it governs, where a struck-through speaker is read as "no sound is
    // coming out" by everybody. The tooltip still names the destination
    // ("Mute", "Unmute"), which is the pairing every player uses.
    var mute = document.createElement("span");
    mute.className = "mdm-audio-mute mdm-tip mdm-tip--n";
    mute.setAttribute("role", "button");
    mute.setAttribute("tabindex", "0");
    var slider = document.createElement("input");
    slider.type = "range";
    slider.min = "0";
    slider.max = "100";
    slider.step = "1";
    slider.value = String(Math.round(audioVolume * 100));
    slider.setAttribute("aria-label", "Volume");
    function paint() {
      mute.setAttribute("aria-label", audioMuted ? "Unmute" : "Mute");
      var face = audioMuted ? "off" : "on";
      if (mute.getAttribute("data-mdm-face") !== face) {
        mute.setAttribute("data-mdm-face", face);
        mute.innerHTML = audioMuted ? VOLUME_OFF_ICON : VOLUME_ICON;
      }
      wrap.classList.toggle("mdm-audio-vol--muted", audioMuted);
      // What the slider has been set to, for the fill of its track.
      slider.style.setProperty("--mdm-vol", slider.value + "%");
    }
    function toggleMute() {
      audioMuted = !audioMuted;
      applyVolume();
      paint();
    }
    mute.addEventListener("click", toggleMute);
    mute.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      toggleMute();
    });
    slider.addEventListener("input", function () {
      audioVolume = Number(slider.value) / 100;
      // Reaching for the level is asking for sound: it lifts the mute rather
      // than setting a level nobody would hear.
      audioMuted = false;
      applyVolume();
      paint();
    });
    paint();
    wrap.appendChild(mute);
    wrap.appendChild(slider);
    return wrap;
  }

  // ---------- The progress bar ----------
  //
  // abcjs wires its bar to a single `click`: one listener on
  // .abcjs-midi-progress-background, and its handler reads nothing but the x
  // of that one event. So the handle can be jumped to but never taken hold of,
  // while the volume beside it is a native range that drags, keeps following
  // the pointer once it has left the control, and answers the arrow keys. What
  // follows adds the missing half, as the editor does.
  //
  // The pointer owns the handle for as long as the button is down: the drag
  // moves the handle and the clock, and the seek lands on release. Seeking as
  // the pointer moves is not on with this engine, since midiBuffer.seek stops
  // every sounding source and kicks off a fresh one at the new offset, and
  // doing that at the rate pointermove arrives stutters.
  //
  // The plain click is taken over too, and abcjs's own swallowed, rather than
  // leaving two owners to seek the same bar: abcjs sets aside a seek asked for
  // while a tune is loading and looks again every 500 ms, so its own would be
  // served whenever it got round to it, landing last and undoing every press
  // made after it.
  var SEEK_KEYS = {
    ArrowLeft: -0.02,
    ArrowRight: 0.02,
    ArrowDown: -0.02,
    ArrowUp: 0.02,
    PageDown: -0.1,
    PageUp: 0.1,
  };

  function clampPercent(percent) {
    return percent < 0 ? 0 : percent > 1 ? 1 : percent;
  }

  function makeProgressDraggable(bar, controller) {
    var track = bar.querySelector(".abcjs-midi-progress-background");
    var control = controller.control;
    if (!track || !control) return;
    var show = control.setProgress.bind(control);
    var dragging = false; // the button is down on the track
    var head = 0; // where the head is drawn, which is what a key steps from
    var announced = -1;
    var asked = null; // a position waiting for the engine to be free
    var seeking = false;

    // The fill starts empty and is written from paint() thereafter. Set here
    // as well so the track is painted from a value of its own from the first
    // frame, rather than from the fallback of the stylesheet.
    track.style.setProperty("--mdm-progress", "0.00%");
    track.setAttribute("tabindex", "0");
    track.setAttribute("role", "slider");
    track.setAttribute("aria-label", "Position");
    track.setAttribute("aria-valuemin", "0");
    track.setAttribute("aria-valuemax", "100");

    // Every move of the handle goes through here, the drag's included, so the
    // reading a screen reader is given follows the pointer as well as the
    // playhead. Written only when the whole per cent changes: the playhead
    // reports far oftener than that.
    function paint(percent, duration) {
      show(percent, duration);
      head = percent;
      // The fill of the track comes off the same number as the head, so the
      // two cannot drift apart: this is the one call every move goes through.
      track.style.setProperty(
        "--mdm-progress",
        (clampPercent(percent) * 100).toFixed(2) + "%"
      );
      var value = Math.round(percent * 100);
      if (value === announced) return;
      announced = value;
      track.setAttribute("aria-valuenow", String(value));
    }
    // While a tune sounds, its timer reports the playhead into
    // control.setProgress sixteen times a beat, which would pull the handle
    // out from under the pointer. That method is the one place the two writers
    // meet, so it is wrapped: silent for as long as the drag lasts, and called
    // by the drag itself.
    control.setProgress = function (percent, duration) {
      if (!dragging) paint(percent, duration);
    };

    // What the clock is drawn from. abcjs takes it off the primed buffer in
    // the one other place it sets the progress by hand (setWarp), and before
    // the tune is primed it has no duration to show either.
    function totalMs() {
      var buffer = controller.midiBuffer;
      return buffer && buffer.duration ? buffer.duration * 1000 : 0;
    }

    // offsetWidth, not the width of the box: the head is placed at
    // clientWidth * percent, and on a track with neither border nor padding
    // that is the same integer, so the head lands under the pointer to the
    // pixel rather than a fraction of one off it.
    function pointerPercent(clientX) {
      var width = track.offsetWidth;
      if (!width) return 0;
      return clampPercent(
        (clientX - track.getBoundingClientRect().left) / width
      );
    }

    // What the last gesture asked for is what the engine is told, and it is
    // told once. The head answers the hand at once, while a tune nobody has
    // played yet takes a second or more to prime, so a burst of gestures
    // inside that window has to collapse into the last of them.
    function seek(percent) {
      paint(percent, totalMs());
      asked = percent;
      if (!seeking) runSeek();
    }

    // runWhenReady is what abcjs defers its own controls through: it primes
    // the tune if it has not been played yet and waits out a priming already
    // under way. The position is read inside, once the engine is free, and not
    // at the point the gesture was made.
    function runSeek() {
      seeking = true;
      var start = bar.querySelector(".abcjs-midi-start");
      var priming = !!start && !controller.isLoaded;
      if (priming) start.classList.add("abcjs-loading");
      var served = false;
      function done() {
        seeking = false;
        if (priming) start.classList.remove("abcjs-loading");
        // Nothing was served: there is no tune to seek in, and asking again
        // would only spin.
        if (!served) asked = null;
        else if (asked !== null) runSeek();
      }
      controller
        .runWhenReady(function () {
          served = true;
          var percent = asked;
          asked = null;
          controller.seek(percent);
          // The seek moves the timer and the sound; the reading the widget is
          // drawn from is a field of its own on the controller. The timer does
          // write it back, but only when the new position falls in another
          // subdivision of the beat, so this is what puts the head on the
          // point that was asked for rather than on the nearest one the timer
          // happens to report.
          controller.setProgress(percent, totalMs());
          return Promise.resolve();
        }, null)
        .then(done, done);
    }

    track.addEventListener("pointerdown", function (e) {
      if (e.button !== 0) return;
      dragging = true;
      paint(pointerPercent(e.clientX), totalMs());
      // Moves that leave the bar keep arriving here, the way the browser goes
      // on feeding a range input it has taken hold of.
      try {
        track.setPointerCapture(e.pointerId);
      } catch (err) {
        // a pointer the browser has already let go of
      }
    });
    track.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      paint(pointerPercent(e.clientX), totalMs());
    });
    track.addEventListener("pointerup", function (e) {
      if (!dragging) return;
      dragging = false;
      seek(pointerPercent(e.clientX));
    });
    track.addEventListener("pointercancel", function () {
      if (!dragging) return;
      dragging = false;
      paint(controller.percent || 0, totalMs()); // back onto the playhead
    });
    // abcjs's listener on the same element cannot be outrun by another added
    // to it, since at the target the two are called in the order they were
    // registered; caught on the way down, at the bar, it never gets there.
    bar.addEventListener(
      "click",
      function (e) {
        if (track.contains(e.target)) e.stopPropagation();
      },
      true
    );
    track.addEventListener("keydown", function (e) {
      var percent = null;
      if (e.key === "Home") percent = 0;
      else if (e.key === "End") percent = 1;
      // Stepped from where the head is drawn, not from the controller's own
      // reading: that one is only written back once the seek has gone through,
      // and priming zeroes it on the way, so presses made before a tune is
      // ready would all have stepped off the same nought.
      else if (SEEK_KEYS[e.key] !== undefined) {
        percent = clampPercent(head + SEEK_KEYS[e.key]);
      }
      if (percent === null) return;
      e.preventDefault();
      seek(percent);
    });
  }

  // ---------- Stop ----------

  // abcjs ships no stop, only play/pause and repeat: pausing leaves the tune
  // halfway and the next press carries on from there. Stop is built out of the
  // two things the controller does have. The pause goes through the play
  // button itself rather than controller.pause(), so the widget's own state
  // follows the press, and restart() rewinds both the timer and the sound to
  // the top.
  function stopButton(bar, controller, onStop) {
    var button = document.createElement("button");
    button.type = "button";
    button.className = "abcjs-btn mdm-audio-stop mdm-tip mdm-tip--n";
    button.setAttribute("aria-label", "Stop");
    button.innerHTML = STOP_ICON;
    button.addEventListener("click", function () {
      var start = bar.querySelector(".abcjs-midi-start");
      if (start && start.classList.contains("abcjs-pushed")) start.click();
      // The rewind waits a microtask on that pause. abcjs finishes pausing
      // after the click returns and writes down where the sound stopped as it
      // does, so a restart in the same tick was undone by it: the clock and
      // the head went back to the top while the buffer stayed where it was,
      // and the next play sounded from there.
      Promise.resolve().then(function () {
        try {
          controller.restart();
        } catch (e) {
          // a tune that never played has no timer to rewind
        }
        onStop();
      });
    });
    return button;
  }

  // ---------- The widget, brought into the editor's manners ----------
  //
  // Two things abcjs does not do on its own:
  //
  //  - Tooltips. It labels its buttons with the `title` attribute, a native
  //    tooltip: slow, unstyled and nothing like the ones the editor draws.
  //    They get the same CSS tooltip instead, drawn from aria-label (.mdm-tip
  //    in mdm-look.css), north, since the bar sits at the foot of the block
  //    and a tooltip below it would hang under the score.
  //  - Labels that follow the state, naming what the click leads to rather
  //    than the state in force.
  //
  // Play leads the bar and repeat follows it: abcjs emits repeat first, and it
  // looks for its controls by class, never by position, so the two are swapped.
  function decorateWidget(bar, controller, onStop) {
    var widget = bar.querySelector(".abcjs-inline-audio");
    if (!widget) return;
    var start = widget.querySelector(".abcjs-midi-start");
    var loop = widget.querySelector(".abcjs-midi-loop");
    if (start && loop) widget.insertBefore(start, loop);
    if (start) {
      start.insertAdjacentElement(
        "afterend",
        stopButton(bar, controller, onStop)
      );
    }
    [start, loop].forEach(function (button) {
      if (!button) return;
      button.classList.add("mdm-tip", "mdm-tip--n");
      button.removeAttribute("title");
    });
    widget.appendChild(volumeControl());
    makeProgressDraggable(bar, controller);
    syncWidgetLabels(bar);
    // Playing, pausing and finishing are class changes abcjs makes itself, and
    // the labels have to follow them. Only the class attribute is watched, so
    // writing the labels back cannot feed the observer.
    new MutationObserver(function () {
      syncWidgetLabels(bar);
    }).observe(widget, {
      attributes: true,
      attributeFilter: ["class"],
      subtree: true,
    });
    // The first press is also what lets a context made outside a gesture run.
    bar.addEventListener("pointerdown", wakeAudio);
  }

  function syncWidgetLabels(bar) {
    var start = bar.querySelector(".abcjs-midi-start");
    var loop = bar.querySelector(".abcjs-midi-loop");
    if (start) {
      start.setAttribute(
        "aria-label",
        start.classList.contains("abcjs-pushed") ? "Pause" : "Play"
      );
    }
    if (loop) {
      loop.setAttribute(
        "aria-label",
        loop.classList.contains("abcjs-pushed") ? "Play once" : "Repeat"
      );
    }
  }

  // ---------- The notes lighting up ----------

  // What abcjs writes into the fill attribute of a sounding note. The colour
  // on screen is NOT this one: the stylesheet paints .abcjs-note_selected
  // (--mdm-play-accent), which lets the mark carry one value for the light
  // side and another for the dark. This value is what shows if that rule is
  // ever missed, so it is the light one.
  var PLAY_HIGHLIGHT = "#a0740f";

  // The engraver keeps the elements it has lit in `selected`; this puts their
  // ink back. abcjs 6 has no clearSelection on the controller, only the
  // per-element unhighlight its own rangeHighlight uses.
  function clearEngraverSelection(engraver) {
    if (typeof engraver.clearSelection === "function") {
      engraver.clearSelection();
      return;
    }
    var color =
      (engraver.renderer && engraver.renderer.foregroundColor) || "#000000";
    (engraver.selected || []).forEach(function (el) {
      try {
        el.unhighlight(undefined, color);
      } catch (e) {
        // an element re-engraved out from under the selection
      }
    });
    engraver.selected = [];
  }

  function engraverOf(visual) {
    var engraver = visual && visual.engraver;
    return engraver && engraver.staffgroups ? engraver : null;
  }

  // Every stretch of source sounding at one moment. The event names one of
  // them in startChar/endChar, and only one: abcjs fills that pair from the
  // first note it walks into the group and leaves it alone, while every note
  // of the group, that one included, goes into startCharArray/endCharArray.
  // In a duet those are the parts on the other staves, sounding together, so
  // a range read off the pair alone lights the voice that was engraved first
  // (the top staff) and leaves the rest of the system in ink.
  function soundingRanges(ev) {
    var starts = (ev && ev.startCharArray) || [];
    var ends = (ev && ev.endCharArray) || [];
    var ranges = [];
    for (var i = 0; i < Math.min(starts.length, ends.length); i++) {
      if (typeof starts[i] === "number" && typeof ends[i] === "number") {
        ranges.push([starts[i], ends[i]]);
      }
    }
    // An event that carries no arrays still lights the note it does name.
    if (!ranges.length && ev && typeof ev.startChar === "number") {
      ranges.push([ev.startChar, ev.endChar]);
    }
    return ranges;
  }

  // What the engraver's own rangeHighlight does (walk the engraved elements,
  // light the ones whose chars intersect a sounding range), but with a colour
  // of ours: highlight() hardwires its default to the selection red. And with
  // every range the event carries, so that the voices of a duet light on
  // their own staves together.
  function highlightPlaying(visual, ev) {
    var engraver = engraverOf(visual);
    if (!engraver) return;
    var ranges = soundingRanges(ev);
    clearEngraverSelection(engraver);
    var root = null;
    engraver.staffgroups.forEach(function (group) {
      group.voices.forEach(function (voice) {
        voice.children.forEach(function (child) {
          var elem = child.abcelem;
          if (
            elem &&
            ranges.some(function (range) {
              return range[1] > elem.startChar && range[0] < elem.endChar;
            })
          ) {
            engraver.selected.push(child);
            child.highlight(undefined, PLAY_HIGHLIGHT);
            if (!root && child.elemset && child.elemset[0]) {
              root = child.elemset[0].ownerSVGElement;
            }
          }
        });
      });
    });
    // A note is handed the shapes of the staff it sits on in the same set, so
    // marking one can put the accent on a staff line and draw a rule across
    // the system. The ink they carry is the black abcjs draws with, which is
    // what unhighlight would restore anyway.
    if (root) {
      root
        .querySelectorAll(".abcjs-staff.abcjs-note_selected")
        .forEach(function (el) {
          el.classList.remove("abcjs-note_selected");
          el.setAttribute("fill", "#000000");
        });
    }
  }

  function clearPlayingHighlight(visual) {
    var engraver = engraverOf(visual);
    if (engraver) clearEngraverSelection(engraver);
  }

  // ---------- Mounting ----------

  function mountPlayer(block, visual) {
    var controls = block.querySelector(".mdm-audio");
    if (!controls) return;
    var controller = new ABCJS.synth.SynthController();
    controller.load(
      controls,
      {
        // The cursor control: the synth reports each note group with the chars
        // of source it came from, and the engraving lights up the elements on
        // that same range.
        onEvent: function (ev) {
          try {
            if (!ev || typeof ev.startChar !== "number") return;
            highlightPlaying(visual, ev);
          } catch (e) {
            // highlighting must never break playback
          }
        },
        onFinished: function () {
          try {
            clearPlayingHighlight(visual);
          } catch (e) {
            // same
          }
        },
        // How often the controller is told where it has got to. abcjs reports
        // once per beat by default, and that number is also what it restarts
        // the cursor from after a pause, while the sound resumes from exactly
        // where it stopped: the cursor came back up to half a beat ahead of
        // the music. Sixteen readings per beat leave that under one frame, and
        // cost nothing: the timer runs on requestAnimationFrame either way.
        beatSubdivisions: 16,
      },
      {
        displayPlay: true,
        displayProgress: true,
        displayLoop: true,
      }
    );
    // What is written is what sounds: without this, abcjs turns the chord
    // symbols ("Dm7") into a strummed accompaniment of its own, four crotchets
    // filling the bar under a written semibreve. Same rule as the editor.
    controller.setTune(visual, false, { chordsOff: true });
    decorateWidget(controls, controller, function () {
      clearPlayingHighlight(visual);
    });
    // The bar sits under the score at the score's width (with a floor so the
    // controls fit), which keeps it reading as part of the block.
    var svg = block.querySelector(".mdm-paper svg");
    var width = svg ? svg.getBoundingClientRect().width : 0;
    if (width) controls.style.maxWidth = Math.max(280, Math.ceil(width)) + "px";
  }


  function renderBlock(block) {
    var srcEl = block.querySelector(".mdm-src");
    var paper = block.querySelector(".mdm-paper");
    if (!srcEl || !paper) return;
    var source = srcEl.textContent;
    // A first render without responsive, to measure the natural width of the
    // engraving: a narrow score (%%staffwidth, say) must not be stretched to
    // the width of the page, no more than a display equation is. The container
    // is then held at that width, so the responsive render that follows can
    // only shrink it on a small screen, never blow it up.
    //
    // Nothing is passed for the width, which is the whole of the fix and the
    // opposite of what used to be here. This asked abcjs for a staff the width
    // of the box, so that a tune with nothing to say about its width would
    // fill the column rather than sit at a size it never asked for. The
    // trouble is that the editor asks for no width either, and abcjs draws
    // that at 740 px: the page was therefore engraving the same tune 820 px
    // wide where the editor engraved it 740, and since a responsive SVG scales
    // its whole drawing, every note, clef, staff line and word came out 11%
    // larger on the page than in the editor. Filling the column is a defensible
    // look, but it is not the editor's, and the editor is the reference.
    // A %%staffwidth in the source still decides, here as there.
    // The room there is, read before anything is drawn into the box.
    var box = paper.clientWidth;
    ABCJS.renderAbc(paper, source, {
      paddingleft: 0,
      paddingright: 0,
    });
    var svgEl = paper.querySelector("svg");
    var natural = svgEl ? parseFloat(svgEl.getAttribute("width")) : 0;
    // The box the score sits in, always: it is what carries the alignment
    // (mdm-look.css), and for a narrow score the width as well. The limit
    // goes here and not on the paper itself because abcjs keeps the ratio of
    // the drawing in a percentage padding-bottom, and a percentage is
    // resolved against the width of the containing block: with the max-width
    // on the paper, that padding went on being computed from the width of the
    // page and left a vertical gap under the score.
    var fit = document.createElement("div");
    fit.className = "mdm-fit";
    if (natural && box && natural < box) {
      fit.style.maxWidth = Math.ceil(natural) + "px";
    }
    // And the card around it, the width of the column, as in the editor: it
    // carries the fill, whose side padding gives way before the drawing does
    // (.mdm-card in mdm-look.css), so it is told the drawing's own width. The
    // player bar stays outside it, under the card, as it was under the fill.
    var card = document.createElement("div");
    card.className = "mdm-card";
    if (natural) card.style.setProperty("--mdm-score-natural", natural + "px");
    paper.parentNode.insertBefore(card, paper);
    card.appendChild(fit);
    fit.appendChild(paper);
    var visual = ABCJS.renderAbc(paper, source, {
      // The classes the stylesheet keys on: the staff lines it recolours, and
      // the notes the player lights up. The paddings are the editor's, so the
      // engraving sits in the text the same way here as it does there.
      add_classes: true,
      responsive: "resize",
      paddingtop: 2,
      paddingbottom: 2,
      paddingleft: 0,
      paddingright: 0,
    })[0];
    if (
      block.classList.contains("mdm-play") &&
      ABCJS.synth &&
      ABCJS.synth.supportsAudio()
    ) {
      mountPlayer(block, visual);
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    if (typeof ABCJS === "undefined") return;
    var blocks = document.querySelectorAll(".mdm-block");
    if (!blocks.length) return;
    // Before anything asks the engine whether it can play: registering later
    // would leave a context of abcjs's own running beside ours.
    if (document.querySelector(".mdm-block.mdm-play")) registerAudioGraph(ABCJS);
    blocks.forEach(renderBlock);
  });
})();
