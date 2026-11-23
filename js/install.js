const CHAVE_ESTADO = '__CANTINA_PWA_INSTALL_BRIDGE__';

// O script clássico install-bridge.js cria este estado no <head>, antes dos módulos.
// O fallback mantém compatibilidade caso o script clássico não esteja disponível.
const estadoInstalacao = window[CHAVE_ESTADO] || (window[CHAVE_ESTADO] = {
  evento: null,
  instalado: false,
  capturadoEm: 0,
  inicializado: false
});

function emitirAtualizacao(nome) {
  document.dispatchEvent(new CustomEvent(nome));
}

function capturarEventoInstalacao(event) {
  if (estaInstalado()) return;
  if (typeof event.preventDefault === 'function') event.preventDefault();
  estadoInstalacao.evento = event;
  estadoInstalacao.capturadoEm = Date.now();
  emitirAtualizacao('cantina:instalavel');
}

// Fallback: não duplica o listener quando o bridge antecipado já foi carregado.
if (!estadoInstalacao.inicializado) {
  estadoInstalacao.inicializado = true;
  window.addEventListener('beforeinstallprompt', capturarEventoInstalacao, true);
  window.addEventListener('appinstalled', () => {
    estadoInstalacao.evento = null;
    estadoInstalacao.instalado = true;
    emitirAtualizacao('cantina:instalado');
    emitirAtualizacao('cantina:instalacao-atualizada');
  });
}

export function estaInstalado() {
  let standalone = false;
  let fullscreen = false;

  try {
    standalone = Boolean(window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
    fullscreen = Boolean(window.matchMedia && window.matchMedia('(display-mode: fullscreen)').matches);
  } catch (_) {
    // Alguns navegadores antigos não oferecem matchMedia completo.
  }

  const iosStandalone = window.navigator && window.navigator.standalone === true;
  return Boolean(standalone || fullscreen || iosStandalone || estadoInstalacao.instalado);
}

export function ehIOS() {
  const ua = navigator.userAgent || '';
  const ipadOS = /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  return /iPad|iPhone|iPod/.test(ua) || ipadOS;
}

export function ehSafariIOS() {
  const ua = navigator.userAgent || '';
  return ehIOS() && /Safari/i.test(ua) && !/(CriOS|FxiOS|EdgiOS|OPiOS|DuckDuckGo)/i.test(ua);
}

/**
 * Detecção apenas informativa. A captura do beforeinstallprompt não depende
 * do nome do navegador nem do userAgent.
 */
export function ehChromium() {
  const brands = navigator.userAgentData?.brands || [];
  const informadoPelasBrands = brands.some(({ brand }) =>
    /Chromium|Google Chrome|Microsoft Edge|Opera|Brave/i.test(String(brand || ''))
  );
  const ua = navigator.userAgent || '';
  const informadoPeloUA = /(?:Chrome|Chromium|Edg|Edge|OPR|Brave)\//i.test(ua);
  return Boolean(informadoPelasBrands || informadoPeloUA);
}

export function tipoInstalacao() {
  if (estaInstalado()) return 'instalado';
  if (ehIOS()) return 'ios';
  if (podeInstalar()) return 'nativo';
  if (ehChromium()) return 'chromium-manual';
  return 'manual';
}

export async function instalarAplicativo() {
  if (estaInstalado()) return false;

  const evento = estadoInstalacao.evento;
  if (!evento || typeof evento.prompt !== 'function') return false;

  // O navegador permite usar cada evento de instalação uma única vez.
  // Limpamos antes da chamada para bloquear duplo clique/reutilização.
  estadoInstalacao.evento = null;

  try {
    // prompt() é chamado diretamente a partir do clique do usuário.
    const respostaPrompt = await evento.prompt();
    let escolha = respostaPrompt;

    // Compatibilidade com implementações que retornam o resultado por userChoice.
    if (!escolha || !escolha.outcome) {
      try {
        escolha = await evento.userChoice;
      } catch (_) {
        escolha = respostaPrompt;
      }
    }

    if (escolha?.outcome === 'accepted') {
      estadoInstalacao.instalado = true;
    }

    return escolha?.outcome === 'accepted';
  } finally {
    emitirAtualizacao('cantina:instalacao-atualizada');
  }
}

export function podeInstalar() {
  return !estaInstalado() && Boolean(estadoInstalacao.evento && typeof estadoInstalacao.evento.prompt === 'function');
}

export function podeMostrarAjudaIOS() {
  return !estaInstalado() && ehIOS();
}
