package com.tutoringles.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClientCompat
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject

class MainActivity : AppCompatActivity() {

    private lateinit var webView: WebView
    private lateinit var speech: SpeechManager
    private lateinit var tts: TtsManager
    private lateinit var translator: TranslatorManager
    private var micPermissionRequested = false

    private val micPermissionCode = 41

    /** Invoca window.TutorNative.<funcion>(payload) dentro del WebView */
    private fun jsCall(function: String, payload: String) {
        if (!::webView.isInitialized) return
        webView.post {
            webView.evaluateJavascript(
                "window.TutorNative && window.TutorNative.$function($payload);",
                null
            )
        }
    }

    private fun jsString(s: String): String = JSONObject.quote(s)

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        // WebView primero: los callbacks de voz llegan por JS
        val assetLoader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        webView = WebView(this)
        setContentView(webView)
        webView.settings.javaScriptEnabled = true
        webView.settings.domStorageEnabled = true
        webView.webViewClient = object : WebViewClientCompat() {
            override fun shouldInterceptRequest(
                view: WebView,
                request: WebResourceRequest
            ): WebResourceResponse? = assetLoader.shouldInterceptRequest(request.url)
        }
        webView.addJavascriptInterface(Bridge(), "AndroidBridge")
        webView.loadUrl("https://appassets.androidplatform.net/assets/www/index.html")

        // Voz de salida (TTS)
        tts = TtsManager { status -> jsCall("onTtsStatus", jsString(status)) }
        tts.init(this)

        // Voz de entrada (STT)
        speech = SpeechManager(this, object : SpeechManager.Events {
            override fun onPartial(text: String) {
                jsCall("onSttPartial", jsString(text))
            }

            override fun onFinal(text: String) {
                jsCall("onSttResult", jsString(text))
            }

            override fun onError(code: Int, message: String) {
                jsCall("onSttError", "{\"code\":$code,\"message\":${jsString(message)}}")
            }
        })

        // Traducción on-device (ML Kit): descarga los modelos en segundo plano
        translator = TranslatorManager { status -> jsCall("onTranslatorStatus", jsString(status)) }
        translator.ensureModels()
    }

    fun hasMicPermission(): Boolean =
        ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED

    fun requestMicPermission() {
        if (micPermissionRequested) return
        micPermissionRequested = true
        ActivityCompat.requestPermissions(
            this,
            arrayOf(Manifest.permission.RECORD_AUDIO),
            micPermissionCode
        )
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (requestCode == micPermissionCode) {
            val granted = grantResults.isNotEmpty() &&
                grantResults[0] == PackageManager.PERMISSION_GRANTED
            micPermissionRequested = false
            jsCall("onMicPermission", if (granted) "true" else "false")
            // La UI (app.js) reinicia la escucha con el idioma correcto al recibir onMicPermission(true).
        }
    }

    /** Puente JavaScript <-> Kotlin llamado desde la interfaz web */
    inner class Bridge {

        @JavascriptInterface
        fun speak(text: String, lang: String, rate: Float) {
            tts.speak(text, lang, rate)
        }

        @JavascriptInterface
        fun stopSpeaking() {
            tts.stop()
        }

        @JavascriptInterface
        fun startListening(lang: String) {
            if (hasMicPermission()) {
                speech.start(if (lang.startsWith("en")) "en-US" else "es-MX")
            } else {
                requestMicPermission()
            }
        }

        @JavascriptInterface
        fun stopListening() {
            speech.stop()
        }

        @JavascriptInterface
        fun checkMic(): Boolean = hasMicPermission()

        @JavascriptInterface
        fun requestMic() {
            requestMicPermission()
        }

        /** @param source "es" o "en" */
        @JavascriptInterface
        fun translate(text: String, requestId: String, source: String) {
            translator.translate(text, requestId, source) { id, result, error ->
                val obj = if (error == null) {
                    "{\"id\":${jsString(id)},\"text\":${jsString(result ?: "")}}"
                } else {
                    "{\"id\":${jsString(id)},\"error\":${jsString(error)}}"
                }
                jsCall("onTranslateResult", obj)
            }
        }

        @JavascriptInterface
        fun translatorReady(): Boolean {
            return true
        }
    }

    override fun onBackPressed() {
        if (webView.canGoBack()) webView.goBack() else super.onBackPressed()
    }

    override fun onDestroy() {
        speech.destroy()
        tts.shutdown()
        translator.close()
        webView.destroy()
        super.onDestroy()
    }
}
