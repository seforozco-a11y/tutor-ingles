# Tutor de Inglés — APK offline

App Android que convierte el PDF **"El curso más completo de inglés"** (Omar Ali Caldela /
mailxmail) en un tutor, traductor y guía de inglés americano que funciona **sin internet**:

- **Consulta por voz**: tocas el micrófono y preguntas *"¿cómo se dice maestro?"*; la app responde con **audio** (voz en-US del propio dispositivo) y por escrito.
- **Dos colores en pantalla** (tal como pide el curso): la **lectura fonética** (`ti...cher`) en **ámbar #F59E0B** y la **traducción formal** (`maestro, profesor`) en **azul #2563EB**; el término en inglés va en negro.
- **1847 términos + 77 lecciones** del PDF en una base de datos embebida (`app/src/main/assets/www/curso.json`).
- **Traducción automática on-device** (ML Kit) para frases que no están en el curso: descarga el modelo una sola vez (~30 MB) y después traduce sin conexión.
- **Motor de voz nativo de Android**: `SpeechRecognizer` (entrada) y `TextToSpeech` (salida), sin servicios de pago ni nube propia.

## Cómo obtener el APK con GitHub Actions (recomendado)

1. Crea una cuenta en GitHub (si no tienes) y un repositorio nuevo, por ejemplo `tutor-ingles`.
2. Sube **todo el contenido de esta carpeta** al repositorio (incluida la carpeta `.github`).
   - Desde la web de GitHub: "Add file → Upload files", arrastrando el contenido completo.
   - O con git: `git init && git add . && git commit -m "Tutor de Inglés" && git remote add origin <tu-url> && git push -u origin main`.
3. En el repositorio, pestaña **Actions** → selecciona el workflow **Build APK** → **Run workflow** (o se lanza solo al subir el código).
4. Espera 5–10 minutos. En el resumen del run, en la sección **Artifacts**, descarga **TutorIngles-apk** → dentro está `app-debug.apk`.
5. Copia el APK a tu teléfono Android (7.0 o superior) e instálalo (activa "Instalar apps de origen desconocido" cuando te lo pida).

## Cómo compilar localmente (opcional)

Con Android Studio (Hedgehog o superior) y JDK 17:

```bash
cd TutorIngles
gradle assembleDebug     # APK en app/build/outputs/apk/debug/
```

## Motores de voz sin internet

Para que la app **entienda** tu voz y **hable** sin conexión, instala una vez los paquetes de voz de Google (la propia app lo explica en **Guía de voz**):

- **Salida (TTS)**: Ajustes → Gestión global / Idiomas → Salida de texto a voz → Google TTS → idiomas instalados → **Español (México)** e **Inglés (EE. UU.)*.
- **Entrada (STT)**: la app de Google de reconocimiento de voz → *"Reconocimiento sin conexión"* → descargar español e inglés.

Si el paquete de voz no está instalado, la app te lo avisa y sugiere la guía.

## Arquitectura

```
app/src/main/
├── java/com/tutoringles/app/
│   ├── MainActivity.kt       # WebView + puente JavaScript <-> Kotlin
│   ├── SpeechManager.kt      # SpeechRecognizer (es-MX / en-US, offline si hay paquete)
│   ├── TtsManager.kt         # TextToSpeech (en-US y es-MX)
│   └── TranslatorManager.kt  # ML Kit Translate on-device (ES<->EN)
└── assets/www/
    ├── index.html / style.css / app.js   # interfaz (tema claro, colores ámbar/azul)
    └── curso.json                        # 1847 términos + 77 lecciones parseadas del PDF
```

Flujo de una consulta: voz → STT → limpieza de muletillas ("¿cómo se dice…?") → búsqueda difusa en la base del curso (normalización de acentos, coincidencia parcial, Levenshtein) → tarjeta con inglés (negro) + fonética (ámbar) + significado (azul) → TTS lee el término en inglés. Si no hay coincidencia, responde ML Kit con la etiqueta "Traducción automática".

## Notas

- El APK debug es instalable sin firma de producción; para publicar en Play Store se necesitaría generar un release firmado (`assembleRelease` con un keystore propio).
- Los títulos de las lecciones provienen de los marcadores del PDF; el capítulo 76 hereda el título "Phrasal Verbs List VI" del documento original (75 y 76 comparten título en la fuente).
- Proyecto generado para el usuario; el contenido del curso pertenece a su autor (uso personal de estudio).
