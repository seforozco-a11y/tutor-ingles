/* Tutor de Inglés - lógica de la interfaz
 * Datos: curso.json (1847 entradas del PDF + 77 lecciones)
 * Voz: window.AndroidBridge (Kotlin) - con simulador si se abre en navegador
 */
(function () {
  "use strict";

  /* ============================== estado ============================== */
  var DATA = null;            // {entries:[], lessons:[]}
  var normEn = [];            // inglés normalizado
  var normEs = [];            // español normalizado
  var direction = "es-en";    // o "en-es"
  var listening = false;
  var pendingAfterMic = null; // función a ejecutar tras conceder permiso
  var history = [];
  var translateCounter = 0;
  var openRequests = {};

  var $ = function (id) { return document.getElementById(id); };
  var resultsEl = $("results");
  var micBtn = $("micBtn");
  var transcriptEl = $("transcript");
  var micHint = $("micHint");

  /* ============================== normalización ============================== */
  function normalize(s) {
    return String(s || "").toLowerCase()
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9\s'?!\.\-]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  var ES_LEAD = [
    "oye", "hey", "dime", "por favor", "hola tutor", "hola",
    "como se dice", "como se diria", "como se pronuncia", "como se escribe", "como se dice en ingles",
    "como digo", "como seria", "quiero saber",
    "que significa", "que quiere decir", "cual es el significado de", "el significado de", "significado de",
    "traduccion de", "traduceme", "traduce", "traducir", "traducido al ingles",
    "la palabra", "el termino", "la frase", "en ingles", "en espanol", "al ingles", "al espanol", "en español", "en inglés"
  ];
  var EN_LEAD = [
    "what does", "how do you say", "how do i say", "how to say", "what is", "what's",
    "meaning of", "the meaning of", "translate", "how would you say", "hey", "please", "tell me"
  ];

  function cleanQuery(raw) {
    var q = normalize(raw);
    // quitar frases introductorias de la conversión por voz (iterativo)
    for (var pass = 0; pass < 3; pass++) {
      var changed = false;
      var leads = EN_LEAD.concat(ES_LEAD);
      for (var i = 0; i < leads.length; i++) {
        var lead = normalize(leads[i]);
        if (q.indexOf(lead + " ") === 0) {
          q = q.slice(lead.length + 1).trim();
          changed = true;
        }
      }
      // "what does X mean" / "que significa X" al final
      q = q.replace(/\s+(mean|means|significa|quiere decir)$/i, "").trim();
      if (!changed) break;
    }
    q = q.replace(/^["'\.\?\!\-]+|["'\.\?\!\-]+$/g, "").replace(/\s+/g, " ").trim();
    return q;
  }

  /* ============================== similitud ============================== */
  function lev(a, b) {
    if (a === b) return 0;
    var m = a.length, n = b.length;
    if (!m) return n; if (!n) return m;
    var prev = new Array(n + 1), cur = new Array(n + 1), i, j;
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur[0] = i;
      var ai = a.charCodeAt(i - 1);
      for (j = 1; j <= n; j++) {
        var cost = ai === b.charCodeAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(cur[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      }
      for (j = 0; j <= n; j++) prev[j] = cur[j];
    }
    return prev[n];
  }

  function sim(q, t) {
    if (!q || !t) return 0;
    if (q === t) return 100;
    if (t.length > 3 && (t.indexOf(q) === 0 || q.indexOf(t) === 0)) {
      return 88 - Math.min(10, Math.abs(q.length - t.length) / 3);
    }
    if (t.indexOf(q) !== -1) return 78;
    if (t.length > 5 && q.indexOf(t) !== -1) return 74;
    var toks = q.split(" "), tt = t.split(" "), overlap = 0;
    for (var i = 0; i < toks.length; i++) {
      if (toks[i].length > 1 && tt.indexOf(toks[i]) !== -1) overlap++;
    }
    var s = (overlap / toks.length) * 62;
    if (Math.abs(q.length - t.length) <= 6 && q.length <= 60 && s < 55) {
      var ratio = 1 - lev(q, t) / Math.max(q.length, t.length);
      if (ratio >= 0.76) s = Math.max(s, 42 + ratio * 20);
    }
    return s;
  }

  function search(q) {
    var best = [];
    for (var i = 0; i < DATA.entries.length; i++) {
      var e = DATA.entries[i];
      var sEn = sim(q, normEn[i]);
      var sEs = sim(q, normEs[i]);
      var s = Math.max(sEn, sEs);
      if (s >= 48) best.push({ i: i, score: s, side: sEs >= sEn ? "es" : "en" });
    }
    best.sort(function (a, b) { return b.score - a.score; });
    // dedupe por contenido
    var seen = {}, out = [];
    for (var k = 0; k < best.length && out.length < 4; k++) {
      var e2 = DATA.entries[best[k].i];
      var key = normalize(e2.en) + "|" + normalize(e2.es);
      if (!seen[key]) { seen[key] = 1; out.push(best[k]); }
    }
    return out;
  }

  /* ============================== voz ============================== */
  var hasNative = typeof window.AndroidBridge !== "undefined";

  function speak(text, lang, rate) {
    if (!text) return;
    if (hasNative) {
      AndroidBridge.speak(text, lang, rate || 0.9);
      return;
    }
    // simulador navegador (para probar fuera del APK)
    try {
      if (window.speechSynthesis) {
        var u = new SpeechSynthesisUtterance(text);
        u.lang = lang.indexOf("en") === 0 ? "en-US" : "es-MX";
        u.rate = rate || 0.9;
        speechSynthesis.cancel();
        speechSynthesis.speak(u);
      }
    } catch (e) {}
  }

  function startListening() {
    if (!DATA) return;
    var lang = direction === "es-en" ? "es-MX" : "en-US";
    if (hasNative) {
      if (AndroidBridge.checkMic()) {
        AndroidBridge.startListening(lang);
        setListening(true);
      } else {
        pendingAfterMic = function () { AndroidBridge.startListening(lang); setListening(true); };
        AndroidBridge.requestMic();
      }
      return;
    }
    // simulador navegador
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { showTranscript("error", "Este navegador no soporta reconocimiento de voz (en el APK sí funciona)."); return; }
    try {
      var rec = new SR();
      rec.lang = lang; rec.interimResults = true;
      rec.onresult = function (ev) {
        var t = "";
        for (var i = ev.resultIndex; i < ev.results.length; i++) t += ev.results[i][0].transcript;
        setTranscript(t);
      };
      rec.onend = function () { setListening(false); };
      rec.onerror = function () { setListening(false); };
      rec.start();
      window.__mockRec = rec;
      setListening(true);
    } catch (e) { setListening(false); }
  }

  function setListening(on) {
    listening = on;
    micBtn.classList.toggle("listening", on);
    micHint.innerHTML = on
      ? "Escuchando… di la palabra o frase"
      : (direction === "es-en"
          ? "Toca el micrófono y pregunta: <b>«¿cómo se dice maestro?»</b>"
          : "Tap the mic and ask: <b>“what does teacher mean?”</b>");
    if (!on) setTimeout(clearTranscriptSoft, 2500);
  }

  function setTranscript(text) {
    transcriptEl.classList.remove("hidden");
    transcriptEl.innerHTML = '<span class="k">Escuché:</span>' + escapeHtml(text);
  }
  function showTranscript(kind, text) {
    transcriptEl.classList.remove("hidden");
    transcriptEl.innerHTML = '<span class="k">' + (kind === "error" ? "Problema:" : "Escuché:") + '</span>' +
      '<span style="color:' + (kind === "error" ? "#DC2626" : "inherit") + '">' + escapeHtml(text) + "</span>";
  }
  function clearTranscriptSoft() {
    if (!listening) transcriptEl.classList.add("hidden");
  }

  /* ============================== render de resultados ============================== */
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function entryCard(e, side, isMain, rank, total) {
    var lessonTitle = (DATA.lessonTitles[e.ch] || "");
    var badge = '<span class="badge">Lección ' + e.ch + (lessonTitle ? " · " + escapeHtml(truncate(lessonTitle, 42)) : "") + "</span>";
    if (!isMain) badge += '<span class="badge multiple">coincidencia ' + rank + "</span>";
    var phon = e.ph ? "(" + escapeHtml(e.ph) + ")" : "";
    return '<article class="card" data-en="' + escapeHtml(e.en) + '">' +
      '<div class="card-badges">' + badge + (isMain && total > 1 ? '<span class="badge">' + total + " coincidencias</span>" : "") + "</div>" +
      '<p class="en">' + escapeHtml(e.en) + "</p>" +
      '<div class="row phonetic"><span class="label">Se pronuncia</span><span class="value">' + phon + "</span></div>" +
      '<div class="row meaning"><span class="label">Significado</span><span class="value">' + escapeHtml(e.es) + "</span></div>" +
      '<div class="actions">' +
        '<button class="btn-audio" data-sp="' + escapeHtml(e.en) + '" data-lg="en">Escuchar</button>' +
        '<button class="btn-audio slow" data-sp="' + escapeHtml(e.en) + '" data-lg="en" data-rate="0.62">Lento</button>' +
        '<button class="btn-audio ghost" data-sp="' + escapeHtml(e.es) + '" data-lg="es">En español</button>' +
      "</div>" +
      "</article>";
  }

  function autoCard(html) {
    return '<article class="card">' +
      '<div class="card-badges"><span class="badge auto">Traducción automática (ML Kit) · no está en el curso</span></div>' +
      html +
      "</article>";
  }

  function truncate(s, n) { return s.length > n ? s.slice(0, n - 1) + "…" : s; }

  function renderQuery(raw) {
    var q = cleanQuery(raw);
    resultsEl.innerHTML = "";
    if (!q) { showTranscript("error", "No capté la palabra o frase. Inténtalo de nuevo."); return; }

    var matches = search(q);
    if (matches.length > 0) {
      var html = "";
      for (var i = 0; i < matches.length; i++) {
        html += entryCard(DATA.entries[matches[i].i], matches[i].side, i === 0, i + 1, matches.length);
      }
      resultsEl.innerHTML = html;
      speak(DATA.entries[matches[0].i].en, "en", 0.9);
      return;
    }

    // sin coincidencias -> traducción automática on-device
    if (hasNative) {
      translateCounter++;
      var id = "tr" + translateCounter;
      var source = direction === "es-en" ? "es" : "en";
      openRequests[id] = { q: q, raw: raw, source: source };
      resultsEl.innerHTML = '<article class="card"><div class="card-badges"><span class="badge">Buscando traducción…</span></div><p class="en">' + escapeHtml(raw) + "</p></article>";
      AndroidBridge.translate(q, id, source);
    } else {
      resultsEl.innerHTML = autoCard(
        '<p class="en">' + escapeHtml(raw) + "</p>" +
        '<div class="row phonetic"><span class="label">Se pronuncia</span><span class="value dim">(no disponible en el simulador)</span></div>' +
        '<div class="row meaning"><span class="label">Significado</span><span class="value dim">(requiere el APK con ML Kit)</span></div>'
      );
    }
  }

  function renderTranslation(id, text, error) {
    var req = openRequests[id];
    delete openRequests[id];
    if (!req) return;
    if (error) {
      resultsEl.innerHTML = autoCard(
        '<p class="en">' + escapeHtml(req.raw) + "</p>" +
        '<div class="row meaning"><span class="label">Traductor</span><span class="value dim">' +
        escapeHtml(error) + " — verifica internet una vez para descargar el modelo, luego funciona offline.</span></div>"
      );
      return;
    }
    var html;
    if (req.source === "es") {
      html =
        '<p class="en">' + escapeHtml(text) + "</p>" +
        '<div class="row phonetic"><span class="label">Se pronuncia</span><span class="value dim">(frase fuera del curso; escúchala con el audio)</span></div>' +
        '<div class="row meaning"><span class="label">Significado</span><span class="value">' + escapeHtml(req.raw) + "</span></div>" +
        '<div class="actions">' +
        '<button class="btn-audio" data-sp="' + escapeHtml(text) + '" data-lg="en">Escuchar</button>' +
        '<button class="btn-audio slow" data-sp="' + escapeHtml(text) + '" data-lg="en" data-rate="0.62">Lento</button>' +
        "</div>";
    } else {
      html =
        '<p class="en">' + escapeHtml(req.raw) + "</p>" +
        '<div class="row phonetic"><span class="label">Se pronuncia</span><span class="value dim">(frase fuera del curso; escúchala con el audio)</span></div>' +
        '<div class="row meaning"><span class="label">Significado</span><span class="value">' + escapeHtml(text) + "</span></div>" +
        '<div class="actions">' +
        '<button class="btn-audio ghost" data-sp="' + escapeHtml(text) + '" data-lg="es">En español</button>' +
        "</div>";
    }
    resultsEl.innerHTML = autoCard(html);
    speak(req.source === "es" ? text : req.raw, "en", 0.9);
  }

  /* ============================== historial ============================== */
  function loadHistory() {
    try { history = JSON.parse(localStorage.getItem("tutor_history") || "[]"); } catch (e) { history = []; }
    renderHistory();
  }
  function pushHistory(q) {
    history = history.filter(function (h) { return h.q !== q; });
    history.unshift({ q: q, dir: direction });
    if (history.length > 8) history.length = 8;
    try { localStorage.setItem("tutor_history", JSON.stringify(history)); } catch (e) {}
    renderHistory();
  }
  function renderHistory() {
    var el = $("historyList");
    if (!history.length) { $("history").classList.add("hidden"); return; }
    $("history").classList.remove("hidden");
    var html = "";
    for (var i = 0; i < history.length; i++) {
      html += '<button class="chip" data-q="' + escapeHtml(history[i].q) + '">' + escapeHtml(truncate(history[i].q, 34)) + "</button>";
    }
    el.innerHTML = html;
  }

  /* ============================== lecciones ============================== */
  function openLessons() {
    var body = $("lessonsBody");
    var html = "";
    for (var i = 0; i < DATA.lessons.length; i++) {
      var l = DATA.lessons[i];
      var cnt = DATA.countPerLesson[l.n] || 0;
      html += '<div class="lesson-item" data-n="' + l.n + '">' +
        '<span class="num">' + l.n + "</span>" +
        '<span class="t">' + escapeHtml(l.title) + "</span>" +
        (cnt ? '<span class="cnt">' + cnt + " términos</span>" : "") +
        "</div>";
    }
    body.innerHTML = html;
    $("lessonsPanel").classList.remove("hidden");
  }

  function openLesson(n) {
    var l = null;
    for (var i = 0; i < DATA.lessons.length; i++) if (DATA.lessons[i].n === n) { l = DATA.lessons[i]; break; }
    if (!l) return;
    var lines = l.body.split("\n");
    var html = '<button class="back-btn" id="lessonBack">← Lista de lecciones</button><div class="lesson-text">';
    var pairRe = /^(.+?)\s*\(([^()]+)\)\s*\(([^()]+)\)\.?$/;
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i].trim();
      if (!ln) { continue; }
      var m = pairRe.exec(ln);
      if (m) {
        html += '<span class="phrase">' + escapeHtml(m[1]) + '</span> <span class="ph">(' + escapeHtml(m[2]) +
          ')</span> <span class="es">(' + escapeHtml(m[3]) + ")</span>\n";
      } else {
        html += escapeHtml(ln) + "\n";
      }
    }
    html += "</div>";
    $("lessonsBody").innerHTML = html;
  }

  /* ============================== callbacks nativos ============================== */
  window.TutorNative = {
    onSttPartial: function (text) { setTranscript(text); },
    onSttResult: function (text) {
      setListening(false);
      if (text) {
        pushHistory(text);
        renderQuery(text);
      }
    },
    onSttError: function (payload) {
      setListening(false);
      showTranscript("error", payload && payload.message ? payload.message : "Error de reconocimiento de voz.");
    },
    onMicPermission: function (granted) {
      if (granted && pendingAfterMic) { var f = pendingAfterMic; pendingAfterMic = null; f(); }
      else if (!granted) { pendingAfterMic = null; showTranscript("error", "Permiso de micrófono denegado."); }
    },
    onTranslateResult: function (payload) {
      if (payload && payload.id) {
        renderTranslation(payload.id, payload.text || "", payload.error || null);
      }
    },
    onTtsStatus: function (status) {
      var pill = $("ttsPill");
      pill.className = "pill " + (status === "listo" ? "ok" : "err");
      pill.textContent = "Voz: " + (status === "listo" ? "lista" : "instala Google TTS (Guía de voz)");
    },
    onTranslatorStatus: function (status) {
      var pill = $("translatorPill");
      if (status === "listo") { pill.className = "pill ok"; pill.textContent = "Traductor: listo (offline)"; }
      else if (status === "descargando") { pill.className = "pill warn"; pill.textContent = "Traductor: descargando modelo…"; }
      else { pill.className = "pill err"; pill.textContent = "Traductor: sin modelo (solo el curso)"; }
    }
  };

  /* ============================== eventos UI ============================== */
  micBtn.addEventListener("click", function () {
    if (listening) {
      if (hasNative) AndroidBridge.stopListening();
      if (window.__mockRec) { try { window.__mockRec.stop(); } catch (e) {} }
      setListening(false);
    } else {
      startListening();
    }
  });

  $("directionSeg").addEventListener("click", function (ev) {
    var btn = ev.target.closest(".seg-btn");
    if (!btn) return;
    direction = btn.getAttribute("data-dir");
    var btns = document.querySelectorAll(".seg-btn");
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle("active", btns[i] === btn);
    setListening(false);
    micHint.innerHTML = direction === "es-en"
      ? "Toca el micrófono y pregunta: <b>«¿cómo se dice maestro?»</b>"
      : "Tap the mic and ask: <b>“what does teacher mean?”</b>";
  });

  function doTypedSearch() {
    var v = $("searchInput").value.trim();
    if (!v) return;
    pushHistory(v);
    renderQuery(v);
    $("searchInput").value = "";
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  $("searchBtn").addEventListener("click", doTypedSearch);
  $("searchInput").addEventListener("keydown", function (ev) { if (ev.key === "Enter") doTypedSearch(); });

  // botones de audio dentro de las tarjetas (delegación)
  document.addEventListener("click", function (ev) {
    var sp = ev.target.closest("[data-sp]");
    if (sp) { speak(sp.getAttribute("data-sp"), sp.getAttribute("data-lg"), parseFloat(sp.getAttribute("data-rate") || "0.9")); return; }
    var chip = ev.target.closest(".chip");
    if (chip) { renderQuery(chip.getAttribute("data-q")); window.scrollTo({ top: 0, behavior: "smooth" }); return; }
    var li = ev.target.closest(".lesson-item");
    if (li) { openLesson(parseInt(li.getAttribute("data-n"), 10)); return; }
    if (ev.target.closest("#lessonBack")) { openLessons(); return; }
  });

  $("lessonsBtn").addEventListener("click", openLessons);
  $("lessonsClose").addEventListener("click", function () { $("lessonsPanel").classList.add("hidden"); });
  $("helpBtn").addEventListener("click", function () { $("helpDialog").classList.remove("hidden"); });
  $("helpClose").addEventListener("click", function () { $("helpDialog").classList.add("hidden"); });

  /* ============================== arranque ============================== */
  fetch("curso.json")
    .then(function (r) { return r.json(); })
    .then(function (data) {
      DATA = data;
      for (var i = 0; i < DATA.entries.length; i++) {
        normEn.push(normalize(DATA.entries[i].en));
        normEs.push(normalize(DATA.entries[i].es));
      }
      DATA.lessonTitles = {};
      DATA.countPerLesson = {};
      for (var j = 0; j < DATA.lessons.length; j++) DATA.lessonTitles[DATA.lessons[j].n] = DATA.lessons[j].title;
      for (var k = 0; k < DATA.entries.length; k++) {
        DATA.countPerLesson[DATA.entries[k].ch] = (DATA.countPerLesson[DATA.entries[k].ch] || 0) + 1;
      }
      loadHistory();
      if (!hasNative) {
        $("ttsPill").className = "pill warn"; $("ttsPill").textContent = "Voz: simulador navegador";
        $("translatorPill").className = "pill warn"; $("translatorPill").textContent = "Traductor: simulador";
      }
    })
    .catch(function () {
      resultsEl.innerHTML = '<article class="card"><p class="en">No se pudo cargar curso.json</p></article>';
    });
})();
