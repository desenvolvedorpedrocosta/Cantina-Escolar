/*
 * CANTINA DA ESCOLA — PWA INSTALL BRIDGE
 * Script clássico carregado no <head>, antes do manifest e dos módulos ES.
 * Sua única responsabilidade é capturar cedo o beforeinstallprompt,
 * evitando que o evento seja perdido enquanto app.js e suas importações carregam.
 */
(function (window, document) {
  'use strict';

  var CHAVE = '__CANTINA_PWA_INSTALL_BRIDGE__';
  var estado = window[CHAVE];

  if (estado && estado.inicializado) return;

  estado = estado || {
    evento: null,
    instalado: false,
    capturadoEm: 0,
    inicializado: false
  };

  estado.inicializado = true;
  window[CHAVE] = estado;

  function estaEmModoInstalado() {
    try {
      var standalone = window.matchMedia && window.matchMedia('(display-mode: standalone)').matches;
      var fullscreen = window.matchMedia && window.matchMedia('(display-mode: fullscreen)').matches;
      var iosStandalone = window.navigator && window.navigator.standalone === true;
      return Boolean(standalone || fullscreen || iosStandalone || estado.instalado);
    } catch (_) {
      return Boolean(window.navigator && window.navigator.standalone === true || estado.instalado);
    }
  }

  function avisar(nome) {
    try {
      document.dispatchEvent(new CustomEvent(nome));
    } catch (_) {
      // A captura do evento não depende da atualização imediata da interface.
    }
  }

  // Registrado imediatamente, sem aguardar o carregamento de app.js/imports.
  // Não há filtro por userAgent: Chrome, Edge, Brave e Chromium são tratados igualmente.
  window.addEventListener('beforeinstallprompt', function (event) {
    if (estaEmModoInstalado()) return;

    // Impede que o navegador consuma o prompt antes do botão personalizado.
    if (typeof event.preventDefault === 'function') event.preventDefault();

    estado.evento = event;
    estado.capturadoEm = Date.now();
    avisar('cantina:instalavel');
  }, true);

  window.addEventListener('appinstalled', function () {
    estado.evento = null;
    estado.instalado = true;
    avisar('cantina:instalado');
    avisar('cantina:instalacao-atualizada');
  });

  // Reavalia o estado se a janela mudar para standalone/fullscreen.
  try {
    var media = window.matchMedia('(display-mode: standalone)');
    var aoMudarModo = function () {
      avisar('cantina:instalacao-atualizada');
    };
    if (media.addEventListener) media.addEventListener('change', aoMudarModo);
    else if (media.addListener) media.addListener(aoMudarModo);
  } catch (_) {
    // Compatibilidade com navegadores sem listener de media query.
  }
})(window, document);
