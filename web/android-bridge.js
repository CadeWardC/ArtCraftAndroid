// Loaded before VectorCraft's wasm in the Android app (the workflow adds it to index.html).
//
// Android's WebView ignores <a download href="blob:..."> clicks and can't show a PDF in an iframe,
// so this hands those files to the app (MainActivity.Bridge), which saves them to
// Downloads/VectorCraft:
//  - Save / Save As / Export: the web app clicks a hidden download link to a blob URL;
//  - Print: the web app loads the job's PDF into #vectorcraft-print-frame; it's saved instead, to
//    print from a PDF viewer.
(function () {
  "use strict";
  var bridge = window.VectorCraftAndroid;
  if (!bridge) return;

  var CHUNK = 3 * 256 * 1024; // bytes per bridge call (a multiple of 3: whole base64 groups)

  function base64(bytes) {
    var s = "";
    for (var i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(s);
  }

  function save(url, name) {
    var id = 0;
    return fetch(url)
      .then(function (r) { return r.blob(); })
      .then(function (blob) {
        return blob.arrayBuffer().then(function (buf) {
          var bytes = new Uint8Array(buf);
          id = bridge.begin(name, blob.type || "application/octet-stream");
          for (var i = 0; i < bytes.length; i += CHUNK) {
            if (!bridge.append(id, base64(bytes.subarray(i, i + CHUNK)))) throw new Error("the app refused the file");
          }
          var err = bridge.finish(id);
          id = 0;
          if (err) throw new Error(err);
        });
      })
      .catch(function (e) {
        if (id) bridge.cancel(id);
        console.error("VectorCraft Android: saving " + name + " failed: " + e);
      });
  }

  var nativeClick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () {
    if (this.hasAttribute("download") && this.href.indexOf("blob:") === 0) {
      save(this.href, this.getAttribute("download") || "vectorcraft");
      return;
    }
    return nativeClick.call(this);
  };

  var PRINT_FRAME_ID = "vectorcraft-print-frame";
  new MutationObserver(function (records) {
    records.forEach(function (r) {
      r.addedNodes.forEach(function (node) {
        if (node.id !== PRINT_FRAME_ID) return;
        var src = node.getAttribute("src");
        if (src && src.indexOf("blob:") === 0) {
          save(src, "VectorCraft print.pdf");
          node.removeAttribute("src"); // nothing to print in the WebView itself
        }
      });
    });
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
