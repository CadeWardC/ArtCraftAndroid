package com.artcraftandroid.vectorcraft

import android.annotation.SuppressLint
import android.content.ActivityNotFoundException
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.os.Environment
import android.provider.MediaStore
import android.util.Base64
import android.util.Log
import android.view.View
import android.webkit.ConsoleMessage
import android.webkit.JavascriptInterface
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.webkit.WebViewAssetLoader
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.atomic.AtomicInteger

/**
 * VectorCraft's web build (Rust + wasm, built by Trunk) in a full-screen WebView.
 *
 * The site is bundled in the APK under assets/www and served from
 * https://appassets.androidplatform.net/ so it runs in a secure context (wasm, localStorage, fetch).
 * The parts a browser normally does itself are done here:
 *  - File → Open / Place: the `<input type=file>` the web app opens becomes the system file picker;
 *  - Save / Export / Print: android-bridge.js hands the file's bytes to [Bridge], which writes them
 *    to Downloads/VectorCraft.
 */
class MainActivity : ComponentActivity() {
    private lateinit var webView: WebView
    private var fileCallback: ValueCallback<Array<Uri>>? = null

    private val pickFiles = registerForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
        val callback = fileCallback ?: return@registerForActivityResult
        fileCallback = null
        val data = result.data
        val uris = mutableListOf<Uri>()
        if (result.resultCode == RESULT_OK && data != null) {
            val clip = data.clipData
            if (clip != null) {
                for (i in 0 until clip.itemCount) uris.add(clip.getItemAt(i).uri)
            } else {
                data.data?.let { uris.add(it) }
            }
        }
        // An empty array tells the page the picker was cancelled (null would break later picks).
        callback.onReceiveValue(uris.toTypedArray())
    }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        goFullScreen()

        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG)
        webView = WebView(this)
        webView.overScrollMode = View.OVER_SCROLL_NEVER
        webView.setBackgroundColor(0xFF262626.toInt())
        with(webView.settings) {
            javaScriptEnabled = true
            domStorageEnabled = true // Data Recovery and preferences live in localStorage
            allowFileAccess = false
            allowContentAccess = false
            setSupportZoom(false)
            builtInZoomControls = false
            displayZoomControls = false
            textZoom = 100
            // window.open (help links) navigates this view, where shouldOverrideUrlLoading sends it out.
            setSupportMultipleWindows(false)
        }

        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/", BundledSite())
            .build()

        webView.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                assetLoader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                if (request.url.host == WebViewAssetLoader.DEFAULT_DOMAIN) return false
                // Anything else (documentation, links in About) opens in the browser, not over the app.
                try {
                    startActivity(Intent(Intent.ACTION_VIEW, request.url))
                } catch (e: ActivityNotFoundException) {
                    Log.w(TAG, "no app opens ${request.url}", e)
                }
                return true
            }
        }

        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowFileChooser(
                view: WebView,
                callback: ValueCallback<Array<Uri>>,
                params: FileChooserParams,
            ): Boolean {
                fileCallback?.onReceiveValue(arrayOf())
                fileCallback = callback
                // Any file: the page's accept list is extensions (.svg, .ai, .vectorcraft...), which
                // Android's MIME filter can't express, so the web app checks the type itself.
                val intent = Intent(Intent.ACTION_GET_CONTENT)
                    .addCategory(Intent.CATEGORY_OPENABLE)
                    .setType("*/*")
                    .putExtra(Intent.EXTRA_ALLOW_MULTIPLE, params.mode == FileChooserParams.MODE_OPEN_MULTIPLE)
                return try {
                    pickFiles.launch(intent)
                    true
                } catch (e: ActivityNotFoundException) {
                    fileCallback = null
                    toast("No file picker on this device")
                    false
                }
            }

            override fun onConsoleMessage(message: ConsoleMessage): Boolean {
                Log.d(TAG, "${message.messageLevel()}: ${message.message()} (${message.sourceId()}:${message.lineNumber()})")
                return true
            }
        }

        webView.addJavascriptInterface(Bridge(), "VectorCraftAndroid")

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            // Back would close the drawing; keep it running in the background instead.
            override fun handleOnBackPressed() {
                moveTaskToBack(true)
            }
        })

        setContentView(webView)
        if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null) {
            val query = if (BuildConfig.FORCE_WEBGL) "?webgl" else ""
            webView.loadUrl("https://${WebViewAssetLoader.DEFAULT_DOMAIN}/index.html$query")
        }
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        webView.saveState(outState)
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) goFullScreen()
    }

    override fun onResume() {
        super.onResume()
        webView.onResume()
    }

    override fun onPause() {
        webView.onPause()
        super.onPause()
    }

    override fun onDestroy() {
        fileCallback?.onReceiveValue(arrayOf())
        fileCallback = null
        webView.destroy()
        super.onDestroy()
    }

    private fun goFullScreen() {
        WindowCompat.getInsetsController(window, window.decorView).apply {
            hide(WindowInsetsCompat.Type.systemBars())
            systemBarsBehavior = WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        }
    }

    private fun toast(text: String) = runOnUiThread { Toast.makeText(this, text, Toast.LENGTH_LONG).show() }

    /** Serves assets/www with the MIME types the web app needs (application/wasm in particular). */
    private inner class BundledSite : WebViewAssetLoader.PathHandler {
        override fun handle(path: String): WebResourceResponse {
            val file = path.trimStart('/').ifEmpty { "index.html" }
            if (file.split('/').any { it == ".." }) return notFound()
            return try {
                val stream = assets.open("www/$file")
                val mime = mimeType(file)
                val encoding = if (mime.startsWith("text/") || mime.endsWith("javascript") || mime.endsWith("json")) "utf-8" else null
                WebResourceResponse(mime, encoding, stream)
            } catch (e: IOException) {
                notFound()
            }
        }

        private fun notFound() =
            WebResourceResponse("text/plain", "utf-8", 404, "Not Found", emptyMap(), ByteArrayInputStream(ByteArray(0)))
    }

    /** Files coming from android-bridge.js in chunks (base64), written to Downloads when complete. */
    private inner class Bridge {
        private val nextId = AtomicInteger(1)
        private val pending = ConcurrentHashMap<Int, Pending>()

        private inner class Pending(val name: String, val mime: String) {
            val bytes = ByteArrayOutputStream()
        }

        @JavascriptInterface
        fun begin(name: String, mime: String): Int {
            val id = nextId.getAndIncrement()
            pending[id] = Pending(safeName(name), mime.ifBlank { "application/octet-stream" })
            return id
        }

        @JavascriptInterface
        fun append(id: Int, base64: String): Boolean {
            val file = pending[id] ?: return false
            return try {
                file.bytes.write(Base64.decode(base64, Base64.DEFAULT))
                true
            } catch (e: IllegalArgumentException) {
                pending.remove(id)
                false
            }
        }

        /** Returns "" on success or an error message. */
        @JavascriptInterface
        fun finish(id: Int): String {
            val file = pending.remove(id) ?: return "unknown file"
            return try {
                saveToDownloads(file.name, file.mime, file.bytes.toByteArray())
                toast("Saved to Downloads/$SAVE_FOLDER/${file.name}")
                ""
            } catch (e: Exception) {
                Log.e(TAG, "saving ${file.name} failed", e)
                toast("Couldn't save ${file.name}: ${e.message}")
                e.message ?: "save failed"
            }
        }

        @JavascriptInterface
        fun cancel(id: Int) {
            pending.remove(id)
        }
    }

    private fun saveToDownloads(name: String, mime: String, bytes: ByteArray) {
        val values = ContentValues().apply {
            put(MediaStore.Downloads.DISPLAY_NAME, name)
            put(MediaStore.Downloads.MIME_TYPE, mime)
            put(MediaStore.Downloads.RELATIVE_PATH, "${Environment.DIRECTORY_DOWNLOADS}/$SAVE_FOLDER")
            put(MediaStore.Downloads.IS_PENDING, 1)
        }
        val resolver = contentResolver
        val uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)
            ?: throw IOException("Downloads isn't available")
        try {
            val out = resolver.openOutputStream(uri) ?: throw IOException("can't write to Downloads")
            out.use { it.write(bytes) }
            values.clear()
            values.put(MediaStore.Downloads.IS_PENDING, 0)
            resolver.update(uri, values, null, null)
        } catch (e: Exception) {
            resolver.delete(uri, null, null)
            throw e
        }
    }

    companion object {
        private const val TAG = "VectorCraft"
        private const val SAVE_FOLDER = "VectorCraft"

        private fun safeName(name: String): String =
            name.substringAfterLast('/').replace(Regex("[\\\\:*?\"<>|\\u0000-\\u001f]"), "_").ifBlank { "vectorcraft" }

        private fun mimeType(file: String): String = when (file.substringAfterLast('.', "").lowercase()) {
            "html", "htm" -> "text/html"
            "js", "mjs" -> "text/javascript"
            "wasm" -> "application/wasm"
            "css" -> "text/css"
            "json", "map" -> "application/json"
            "svg" -> "image/svg+xml"
            "png" -> "image/png"
            "jpg", "jpeg" -> "image/jpeg"
            "webp" -> "image/webp"
            "ico" -> "image/x-icon"
            "ttf" -> "font/ttf"
            "otf" -> "font/otf"
            "woff" -> "font/woff"
            "woff2" -> "font/woff2"
            "txt" -> "text/plain"
            else -> "application/octet-stream"
        }
    }
}
