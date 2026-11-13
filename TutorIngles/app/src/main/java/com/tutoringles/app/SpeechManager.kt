package com.tutoringles.app

import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.content.Intent
import android.app.Activity
import android.os.Bundle

/**
 * Reconocimiento de voz con el motor nativo de Android (SpeechRecognizer).
 * Funciona offline si el dispositivo tiene instalado el paquete de voz de Google
 * (Ajustes -> Voz -> Reconocimiento offline de español / inglés).
 */
class SpeechManager(
    private val activity: Activity,
    private val events: Events
) {
    interface Events {
        fun onPartial(text: String)
        fun onFinal(text: String)
        fun onError(code: Int, message: String)
    }

    private var recognizer: SpeechRecognizer? = null

    private val listener = object : RecognitionListener {
        override fun onReadyForSpeech(params: Bundle?) {}
        override fun onBeginningOfSpeech() {}
        override fun onRmsChanged(rmsdB: Float) {}
        override fun onBufferReceived(buffer: ByteArray?) {}
        override fun onEndOfSpeech() {}

        override fun onError(error: Int) {
            val message = when (error) {
                SpeechRecognizer.ERROR_NO_MATCH -> "No entendí lo que dijiste. Toca el micrófono e inténtalo de nuevo."
                SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "No detecté tu voz. Acércate al micrófono."
                SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Falta el permiso del micrófono."
                SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "El reconocedor está ocupado. Espera un segundo e inténtalo de nuevo."
                SpeechRecognizer.ERROR_NETWORK_TIMEOUT, SpeechRecognizer.ERROR_NETWORK ->
                    "El reconocimiento necesita el paquete de voz offline de Google (o conexión). Revisa la Guía de voz."
                SpeechRecognizer.ERROR_AUDIO -> "Problema de audio en el dispositivo."
                else -> "Error de reconocimiento (código $error)."
            }
            events.onError(error, message)
        }

        override fun onResults(results: Bundle?) {
            val list = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
            val best = list?.firstOrNull() ?: ""
            if (best.isNotBlank()) events.onFinal(best) else events.onError(
                SpeechRecognizer.ERROR_NO_MATCH, "No entendí lo que dijiste."
            )
        }

        override fun onPartialResults(partialResults: Bundle?) {
            val list = partialResults?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
            val partial = list?.firstOrNull() ?: return
            events.onPartial(partial)
        }

        override fun onEvent(eventType: Int, params: Bundle?) {}
    }

    fun start(langTag: String) {
        activity.runOnUiThread {
            if (!SpeechRecognizer.isRecognitionAvailable(activity)) {
                events.onError(-1, "Este dispositivo no tiene motor de reconocimiento de voz. Revisa la Guía de voz.")
                return@runOnUiThread
            }
            recognizer?.destroy()
            recognizer = SpeechRecognizer.createSpeechRecognizer(activity).apply {
                setRecognitionListener(listener)
                val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                    putExtra(RecognizerIntent.EXTRA_LANGUAGE, langTag)            // "es-MX" o "en-US"
                    putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                    putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
                    putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 3)
                }
                startListening(intent)
            }
        }
    }

    fun stop() {
        activity.runOnUiThread { recognizer?.stopListening() }
    }

    fun destroy() {
        recognizer?.destroy()
        recognizer = null
    }
}
