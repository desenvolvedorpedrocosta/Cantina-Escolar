let eventoInstalacao = null;

function emitirAtualizacao(nome) {
  document.dispatchEvent(new CustomEvent(nome));
}

export function estaInstalado() {
  const standalone = window.matchMedia?.('(display-mode: standalone)')?.matches;
  const fullscreen = window.matchMedia?.('(display-mode: fullscreen)')?.matches;
  const iosStandalone = window.navigator.standalone === true;
  return Boolean(standalone || fullscreen || iosStandalone);
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
 * Detecção informativa de navegadores Chromium.
 * A captura do beforeinstallprompt NÃO depende deste teste:
 * Chrome, Edge, Brave e outros Chromium são tratados igualmente.
 */
export function ehChromium() {
  const brands = navigator.userAgentData?.brands || [];
  const informadoPelasBrands = brands.some(({ brand }) =>
    /Chromium|Google Chrome|Microsoft Edge|Opera/i.test(String(brand || ''))
  );
  const ua = navigator.userAgent || '';
  const informadoPeloUA = /(?:Chrome|Chromium|Edg|Edge|OPR|Brave)\//i.test(ua);
  return Boolean(informadoPelasBrands || informadoPeloUA);
}

export function tipoInstalacao() {
  if (estaInstalado()) return 'instalado';
  if (ehIOS()) return 'ios';
  if (eventoInstalacao) return 'nativo';
  if (ehChromium()) return 'chromium-manual';
  // Sempre oferecemos uma orientação manual quando ainda não há prompt nativo.
  return 'manual';
}

/**
 * Captura o evento em fase de captura e sem qualquer filtro por Chrome.
 * preventDefault aqui apenas guarda o prompt para exibi-lo após o toque
 * explícito no botão do aplicativo; não bloqueia o clique do usuário.
 */
window.addEventListener('beforeinstallprompt', (event) => {
  if (estaInstalado()) return;
  event.preventDefault();
  eventoInstalacao = event;
  emitirAtualizacao('cantina:instalavel');
}, true);

window.addEventListener('appinstalled', () => {
  eventoInstalacao = null;
  emitirAtualizacao('cantina:instalado');
});

// Atualiza a interface se o navegador mudar para o modo standalone.
try {
  const mediaStandalone = window.matchMedia('(display-mode: standalone)');
  const atualizarModo = () => emitirAtualizacao('cantina:instalacao-atualizada');
  if (mediaStandalone.addEventListener) mediaStandalone.addEventListener('change', atualizarModo);
  else if (mediaStandalone.addListener) mediaStandalone.addListener(atualizarModo);
} catch (_) {
  // Alguns navegadores antigos não oferecem matchMedia compatível.
}

export async function instalarAplicativo() {
  if (!eventoInstalacao || estaInstalado()) return false;

  const evento = eventoInstalacao;
  eventoInstalacao = null; // beforeinstallprompt só pode ser utilizado uma vez.

  try {
    await evento.prompt();
    const escolha = await evento.userChoice;
    emitirAtualizacao('cantina:instalacao-atualizada');
    return escolha?.outcome === 'accepted';
  } catch (error) {
    emitirAtualizacao('cantina:instalacao-atualizada');
    throw error;
  }
}

export function podeInstalar() {
  return !estaInstalado() && Boolean(eventoInstalacao);
}

export function podeMostrarAjudaIOS() {
  return !estaInstalado() && ehIOS();
}
