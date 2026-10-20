// Loaded before VectorCraft's wasm in the Android app (the workflow adds it to index.html).
//
// On-screen Shift, Alt and Ctrl keys for a tablet without a keyboard, so the pen can constrain a
// shape (Shift: a square, a circle, 45° lines, proportional scaling), draw from the centre or
// duplicate (Alt), and so on. Each key works like a phone's Shift key:
//  - tap: on for the next stroke or tap (it turns itself off when the pen lifts);
//  - double-tap: locked on until tapped again;
//  - press and hold: on while the finger stays on it (with the pen drawing in the other hand).
// Drag the bar by its handle to move it; tap the handle to fold it away.
//
// VectorCraft (egui) reads modifiers from each event's shiftKey / altKey / ctrlKey, so this makes
// those report the on-screen keys too, and sends a Shift/Alt/Control keydown or keyup when one
// changes, so a stroke in progress sees it at once.
(function () {
  "use strict";

  var KEYS = [
    { prop: "shiftKey", key: "Shift", code: "ShiftLeft", label: "Shift", hint: "constrain" },
    { prop: "altKey", key: "Alt", code: "AltLeft", label: "Alt", hint: "centre · copy" },
    { prop: "ctrlKey", key: "Control", code: "ControlLeft", label: "Ctrl", hint: "" },
  ];
  var DOUBLE_TAP_MS = 350; // a second tap within this locks the key
  var HOLD_MS = 400; // pressed longer than this, the key is held, not tapped
  var STORE = "vectorcraft-android-modifier-bar";

  // Per key: "off", "once" (the next stroke), "locked"; and whether a finger holds it down.
  var state = {};
  var held = {};
  KEYS.forEach(function (k) { state[k.prop] = "off"; held[k.prop] = false; });

  function active(prop) { return held[prop] || state[prop] !== "off"; }

  // Every mouse, pointer, wheel, key and touch event reports the on-screen keys as pressed.
  [window.MouseEvent, window.KeyboardEvent, window.TouchEvent].forEach(function (C) {
    if (!C) return;
    KEYS.forEach(function (k) {
      var d = Object.getOwnPropertyDescriptor(C.prototype, k.prop);
      if (!d || !d.get || !d.configurable) return;
      Object.defineProperty(C.prototype, k.prop, {
        configurable: true,
        enumerable: d.enumerable,
        get: function () { return d.get.call(this) || active(k.prop); },
      });
    });
  });

  var bar = null;
  var buttons = {};

  function canvas() { return document.getElementById("vectorcraft_canvas"); }

  // Tell egui now: a stroke in progress would otherwise see the change only when the pen moves.
  function announce(k, wasOn) {
    var on = active(k.prop);
    if (on !== wasOn) {
      var c = canvas();
      if (c) c.dispatchEvent(new KeyboardEvent(on ? "keydown" : "keyup", { key: k.key, code: k.code, bubbles: true, cancelable: true }));
    }
    var b = buttons[k.prop];
    if (b) {
      b.setAttribute("data-state", held[k.prop] ? "held" : state[k.prop]);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  function set(k, next, nextHeld) {
    var wasOn = active(k.prop);
    state[k.prop] = next;
    held[k.prop] = nextHeld;
    announce(k, wasOn);
  }

  // Taps on a key: off -> once; once + quick second tap -> locked; anything else -> off.
  var lastTap = {};
  function tap(k) {
    var now = Date.now();
    var s = state[k.prop];
    var quick = now - (lastTap[k.prop] || 0) < DOUBLE_TAP_MS;
    lastTap[k.prop] = now;
    if (s === "off") set(k, "once", false);
    else if (s === "once" && quick) set(k, "locked", false);
    else set(k, "off", false);
  }

  // "Once" keys turn off after the next stroke: when every pointer that went down off the bar is
  // up again. A pinch or two-finger pan doesn't use them up.
  var down = {};
  var downCount = 0;
  var most = 0;
  function strokeStart(e) {
    if (!down[e.pointerId]) {
      down[e.pointerId] = true;
      downCount++;
      most = Math.max(most, downCount);
    }
  }
  function strokeEnd(e) {
    if (!down[e.pointerId]) return;
    delete down[e.pointerId];
    downCount--;
    if (downCount > 0) return;
    var single = most === 1;
    most = 0;
    if (!single) return;
    // After VectorCraft has read this release (with the keys still on).
    setTimeout(function () {
      KEYS.forEach(function (k) { if (state[k.prop] === "once") set(k, "off", held[k.prop]); });
    }, 0);
  }

  // The bar's own presses, by pointer id: { key or "grip", at, x, y, moved }.
  var presses = {};

  function onBar(e) { return bar && e.target instanceof Node && bar.contains(e.target); }

  function keyOf(target) {
    var el = target instanceof Element ? target.closest("[data-prop]") : null;
    if (!el) return null;
    var prop = el.getAttribute("data-prop");
    for (var i = 0; i < KEYS.length; i++) if (KEYS[i].prop === prop) return KEYS[i];
    return null;
  }

  function barPointer(e) {
    // VectorCraft's handlers (pen, palm rejection, eframe) never see the bar's touches, and the
    // canvas keeps the keyboard focus.
    e.stopImmediatePropagation();
    if (e.cancelable) e.preventDefault();
    var p = presses[e.pointerId];
    if (e.type === "pointerdown") {
      var k = keyOf(e.target);
      var grip = e.target instanceof Element && e.target.closest(".vcm-grip");
      if (!k && !grip) return;
      presses[e.pointerId] = { key: k, grip: !!grip, at: Date.now(), x: e.clientX, y: e.clientY, moved: false,
        left: bar.offsetLeft, top: bar.offsetTop };
      if (k) {
        presses[e.pointerId].timer = setTimeout(function () {
          set(k, state[k.prop], true); // held from now on
        }, HOLD_MS);
      }
      try { bar.setPointerCapture(e.pointerId); } catch (err) { /* only a nicety */ }
      return;
    }
    if (!p) return;
    if (e.type === "pointermove") {
      if (p.grip) {
        var dx = e.clientX - p.x, dy = e.clientY - p.y;
        if (Math.abs(dx) + Math.abs(dy) > 6) p.moved = true;
        if (p.moved) place(p.left + dx, p.top + dy);
      }
      return;
    }
    // pointerup / pointercancel
    delete presses[e.pointerId];
    if (p.timer) clearTimeout(p.timer);
    if (p.key) {
      if (held[p.key.prop]) set(p.key, state[p.key.prop], false); // a hold lets go
      else if (e.type === "pointerup") tap(p.key);
    } else if (p.grip) {
      if (p.moved) save();
      else if (e.type === "pointerup") fold(!bar.classList.contains("vcm-folded"));
    }
  }

  ["pointerdown", "pointermove", "pointerup", "pointercancel"].forEach(function (kind) {
    window.addEventListener(kind, function (e) {
      if (onBar(e) || presses[e.pointerId]) {
        barPointer(e);
      } else if (kind === "pointerdown") {
        strokeStart(e);
      } else if (kind === "pointerup" || kind === "pointercancel") {
        strokeEnd(e);
      }
    }, { capture: true, passive: false });
  });
  // The touch and mouse events behind the bar's pointer events stay with the bar too.
  ["touchstart", "touchmove", "touchend", "touchcancel", "mousedown", "mousemove", "mouseup", "click", "contextmenu"].forEach(function (kind) {
    window.addEventListener(kind, function (e) {
      if (!onBar(e)) return;
      e.stopImmediatePropagation();
      if (e.cancelable) e.preventDefault();
    }, { capture: true, passive: false });
  });

  // ---- The bar ----

  function place(left, top) {
    var w = bar.offsetWidth, h = bar.offsetHeight;
    var maxL = Math.max(0, window.innerWidth - w), maxT = Math.max(0, window.innerHeight - h);
    bar.style.left = Math.min(Math.max(0, left), maxL) + "px";
    bar.style.top = Math.min(Math.max(0, top), maxT) + "px";
    bar.style.right = "auto";
    bar.style.bottom = "auto";
  }

  function save() {
    try {
      localStorage.setItem(STORE, JSON.stringify({
        left: bar.offsetLeft / window.innerWidth,
        top: bar.offsetTop / window.innerHeight,
        folded: bar.classList.contains("vcm-folded"),
      }));
    } catch (err) { /* the position just isn't remembered */ }
  }

  function fold(folded) {
    bar.classList.toggle("vcm-folded", folded);
    if (folded) KEYS.forEach(function (k) { set(k, "off", false); });
    // Keep it on screen as it changes size.
    place(bar.offsetLeft, bar.offsetTop);
    save();
  }

  function build() {
    var style = document.createElement("style");
    style.textContent =
      "#vectorcraft-modifiers{position:fixed;right:16px;bottom:56px;z-index:10;display:flex;flex-direction:column;gap:6px;" +
      "padding:6px;border-radius:14px;background:rgba(40,40,40,.88);box-shadow:0 2px 10px rgba(0,0,0,.45);" +
      "font:600 15px system-ui,sans-serif;color:#ddd;touch-action:none;user-select:none;-webkit-user-select:none}" +
      "#vectorcraft-modifiers .vcm-grip{height:22px;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#888;font-size:13px;letter-spacing:2px}" +
      "#vectorcraft-modifiers .vcm-key{width:76px;height:60px;border-radius:10px;border:1px solid #555;background:#333;color:inherit;" +
      "display:flex;flex-direction:column;align-items:center;justify-content:center;gap:2px;padding:0;font:inherit;outline:none}" +
      "#vectorcraft-modifiers .vcm-key small{font-size:10px;font-weight:400;color:#999}" +
      "#vectorcraft-modifiers .vcm-key[data-state=once],#vectorcraft-modifiers .vcm-key[data-state=held]{background:#2f5f9e;border-color:#4d86d1;color:#fff}" +
      "#vectorcraft-modifiers .vcm-key[data-state=locked]{background:#1f7a4a;border-color:#3fbf78;color:#fff;box-shadow:inset 0 -3px 0 #3fbf78}" +
      "#vectorcraft-modifiers .vcm-key[data-state=once] small,#vectorcraft-modifiers .vcm-key[data-state=held] small,#vectorcraft-modifiers .vcm-key[data-state=locked] small{color:#e6e6e6}" +
      "#vectorcraft-modifiers.vcm-folded .vcm-key{display:none}" +
      "#vectorcraft-modifiers.vcm-folded .vcm-grip{width:44px;height:44px}";
    document.head.appendChild(style);

    bar = document.createElement("div");
    bar.id = "vectorcraft-modifiers";
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "Modifier keys");
    var grip = document.createElement("div");
    grip.className = "vcm-grip";
    grip.textContent = "⋮⋮";
    grip.title = "Drag to move, tap to fold";
    bar.appendChild(grip);
    KEYS.forEach(function (k) {
      var b = document.createElement("button");
      b.type = "button";
      b.tabIndex = -1;
      b.className = "vcm-key";
      b.setAttribute("data-prop", k.prop);
      b.setAttribute("data-state", "off");
      b.setAttribute("aria-pressed", "false");
      b.title = "Tap: next stroke. Double-tap: lock. Hold: while held.";
      b.appendChild(document.createTextNode(k.label));
      if (k.hint) {
        var s = document.createElement("small");
        s.textContent = k.hint;
        b.appendChild(s);
      }
      buttons[k.prop] = b;
      bar.appendChild(b);
    });
    document.body.appendChild(bar);

    var saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORE) || "null"); } catch (err) { saved = null; }
    if (saved && isFinite(saved.left) && isFinite(saved.top)) {
      place(saved.left * window.innerWidth, saved.top * window.innerHeight);
    }
    if (saved && saved.folded) bar.classList.add("vcm-folded");

    window.addEventListener("resize", function () {
      if (bar.style.left) place(bar.offsetLeft, bar.offsetTop);
    });
  }

  if (document.body) build();
  else document.addEventListener("DOMContentLoaded", build);
})();
