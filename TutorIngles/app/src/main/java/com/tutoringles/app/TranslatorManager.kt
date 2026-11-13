package com.tutoringles.app

import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.nl.translate.TranslateLanguage
import com.google.mlkit.nl.translate.Translation
import com.google.mlkit.nl.translate.Translator
import com.google.mlkit.nl.translate.TranslatorOptions

/**
 * Traducción automática on-device con ML Kit.
 * El modelo ES-EN se descarga UNA VEZ (~30 MB, requiere internet) y después
 * traduce sin internet. Si no hay modelo, la app sigue funcionando con la
 * base de datos del curso.
 */
class TranslatorManager(private val onStatus: (String) -> Unit) {

    private val esEn: Translator = Translation.getClient(
        TranslatorOptions.Builder()
            .setSourceLanguage(TranslateLanguage.SPANISH)
            .setTargetLanguage(TranslateLanguage.ENGLISH)
            .build()
    )

    private val enEs: Translator = Translation.getClient(
        TranslatorOptions.Builder()
            .setSourceLanguage(TranslateLanguage.ENGLISH)
            .setTargetLanguage(TranslateLanguage.SPANISH)
            .build()
    )

    fun ensureModels() {
        onStatus("descargando")
        val conditions = DownloadConditions.Builder().build()
        esEn.downloadModelIfNeeded(conditions)
            .continueWithTask { enEs.downloadModelIfNeeded(conditions) }
            .addOnSuccessListener { onStatus("listo") }
            .addOnFailureListener { onStatus("error") }
    }

    /** @param source "es" (español -> inglés) o "en" (inglés -> español) */
    fun translate(text: String, requestId: String, source: String, callback: (String, String?, String?) -> Unit) {
        val client = if (source == "es") esEn else enEs
        val conditions = DownloadConditions.Builder().build()
        client.downloadModelIfNeeded(conditions)
            .continueWithTask { client.translate(text) }
            .addOnSuccessListener { callback(requestId, it, null) }
            .addOnFailureListener { callback(requestId, null, it.message ?: "error de traducción") }
    }

    fun close() {
        esEn.close()
        enEs.close()
    }
}
