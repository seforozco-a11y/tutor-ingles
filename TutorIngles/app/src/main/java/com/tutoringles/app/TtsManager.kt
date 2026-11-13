package com.tutoringles.app

import android.content.Context
import android.speech.tts.TextToSpeech
import java.util.Locale

/**
 * Texto a voz con el motor nativo de Android (Google TTS).
 * Voz de inglés americano (en-US) para la palabra/frase y voz española (es-MX)
 * para el significado. Funciona offline con los paquetes de voz del sistema.
 */
class TtsManager(private val onStatus: (String) -> Unit) {

    private var tts: TextToSpeech? = null
    private var ready = false

    fun init(context: Context) {
        tts = TextToSpeech(context) { status ->
            ready = status == TextToSpeech.SUCCESS
            onStatus(if (ready) "listo" else "no disponible")
        }
    }

    fun speak(text: String, lang: String, rate: Float = 0.9f) {
        if (!ready) return
        val isEnglish = lang.startsWith("en")
        var res = tts?.setLanguage(if (isEnglish) Locale.US else Locale("es", "MX")) ?: return
        if (res == TextToSpeech.LANG_MISSING_DATA || res == TextToSpeech.LANG_NOT_SUPPORTED) {
            res = tts?.setLanguage(if (isEnglish) Locale.ENGLISH else Locale("es")) ?: return
        }
        tts?.setSpeechRate(rate)
        tts?.speak(text, TextToSpeech.QUEUE_FLUSH, null, "utt${System.currentTimeMillis()}")
    }

    fun stop() {
        tts?.stop()
    }

    fun shutdown() {
        tts?.stop()
        tts?.shutdown()
        tts = null
    }
}
