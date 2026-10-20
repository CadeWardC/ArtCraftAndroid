// Loaded before VectorCraft's wasm in the Android app (the workflow adds it to index.html).
//
// Shift and Alt for a tablet without a keyboard, as a gesture: rest fingers on the screen while
// the pen draws or taps.
//  - one finger: Shift (a square, a circle, 45° lines, proportional scaling, add to a selection);
//  - two fingers: Alt (draw from the centre, duplicate while moving);
//  - three fingers: both.
// Fingers count only while the pen is down, and only while they stay still: a moving finger is
// panning, and a palm (a large contact) is ignored. Lifting or adding a finger mid-stroke changes
// the keys mid-stroke, as on a keyboard. A small label at the top shows the keys that are on.
//
// VectorCraft already ignores fingers while the pen is down and cancels those down when it lands
// (palm rejection), so resting fingers don't pan, zoom or undo.
//
// VectorCraft (egui) reads modifiers from each event's shiftKey / altKey, so this makes those
// report the gesture's keys too, and sends a Shift/Alt keydown or keyup when one changes, so a
// stroke in progress sees it at once.
(function () {
  "use strict";

  var KEYS = [
    { prop: "shiftKey", key: "Shift", code: "ShiftLeft", label: "Shift" },
    { prop: "altKey", key: "Alt", code: "AltLeft", label: "Alt" },
  ];
  // Resting fingers -> the keys they hold.
  var BY_FINGERS = [[], ["shiftKey"], ["altKey"], ["shiftKey", "altKey"]];
  var STILL_PX = 24; // a finger that moves farther than this is panning, not resting
  var PALM_PX = 40; // a contact wider or taller than this is a palm

  var on = { shiftKey: false, altKey: false };

  // Every mouse, pointer, wheel, key and touch event reports the gesture's keys as pressed.
  [window.MouseEvent, window.KeyboardEvent, window.TouchEvent].forEach(function (C) {
    if (!C) return;
    KEYS.forEach(function (k) {
      var d = Object.getOwnPropertyDescriptor(C.prototype, k.prop);
      if (!d || !d.get || !d.configurable) return;
      Object.defineProperty(C.prototype, k.prop, {
        configurable: true,
        enumerable: d.enumerable,
        get: function () { return d.get.call(this) || on[k.prop]; },
      });
    });
  });

  // Fingers down, by pointer id: { x, y, still }.
  var fingers = {};
  // Pens down, by pointer id.
  var pens = {};

  function penDown() { return Object.keys(pens).length > 0; }

  function resting() {
    var n = 0;
    for (var id in fingers) if (fingers[id].still) n++;
    return n;
  }

  function canvas() { return document.getElementById("vectorcraft_canvas"); }

  var label = null;

  function showLabel(names) {
    if (!label) {
      if (!document.body) return;
      label = document.createElement("div");
      label.id = "vectorcraft-modifier-label";
      label.setAttribute("aria-live", "polite");
      label.style.cssText =
        "position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:10;pointer-events:none;" +
        "padding:4px 12px;border-radius:12px;background:rgba(31,122,74,.92);color:#fff;" +
        "font:600 14px system-ui,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.4);display:none";
      document.body.appendChild(label);
    }
    label.textContent = names.join(" + ");
    label.style.display = names.length ? "block" : "none";
  }

  // Make the keys match the resting fingers (none while the pen is up), telling egui of changes.
  function update() {
    var want = penDown() ? BY_FINGERS[Math.min(resting(), BY_FINGERS.length - 1)] : [];
    var names = [];
    KEYS.forEach(function (k) {
      var next = want.indexOf(k.prop) >= 0;
      if (next) names.push(k.label);
      if (next === on[k.prop]) return;
      on[k.prop] = next;
      var c = canvas();
      if (c) c.dispatchEvent(new KeyboardEvent(next ? "keydown" : "keyup", { key: k.key, code: k.code, bubbles: true, cancelable: true }));
    });
    showLabel(names);
  }

  function palm(e) { return e.width > PALM_PX || e.height > PALM_PX; }

  // Capture phase, registered before VectorCraft's own listeners: the keys are set before it reads
  // the event. Nothing is stopped; VectorCraft sees every event as before.
  ["pointerdown", "pointermove", "pointerup", "pointercancel"].forEach(function (kind) {
    window.addEventListener(kind, function (e) {
      var id = e.pointerId;
      if (e.pointerType === "pen") {
        if (kind === "pointerdown") {
          pens[id] = true;
          update();
        } else if ((kind === "pointerup" || kind === "pointercancel") && pens[id]) {
          delete pens[id];
          // After VectorCraft has read this release (with the keys still on).
          setTimeout(update, 0);
        }
        return;
      }
      if (e.pointerType !== "touch") return;
      if (kind === "pointerdown") {
        fingers[id] = { x: e.clientX, y: e.clientY, still: !palm(e) };
      } else if (kind === "pointermove") {
        var f = fingers[id];
        if (!f || !f.still) return;
        if (palm(e) || Math.abs(e.clientX - f.x) + Math.abs(e.clientY - f.y) > STILL_PX) f.still = false;
        else return;
      } else {
        if (!fingers[id]) return;
        delete fingers[id];
      }
      update();
    }, { capture: true, passive: true });
  });
})();
