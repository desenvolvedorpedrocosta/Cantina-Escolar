let eventoInstalacao = null;

export function estaInstalado() {
  const standalone = window.matchMedia?.('(display-mode: standalone)').matches;
  const iosStandalone = window.navigator.standalone === true;
  return Boolean(standalone || iosStandalone);
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

export function tipoInstalacao() {
  if (estaInstalado()) return 'instalado';
  if (ehIOS()) return 'ios';
  if (eventoInstalacao) return /Android/i.test(navigator.userAgent) ? 'android' : 'computador';
  return 'indisponivel';
}

window.addEventListener('beforeinstallprompt', (event) => {
  if (estaInstalado()) return;
  event.preventDefault();
  eventoInstalacao = event;
  document.dispatchEvent(new CustomEvent('cantina:instalavel'));
});

window.addEventListener('appinstalled', () => {
  eventoInstalacao = null;
  document.dispatchEvent(new CustomEvent('cantina:instalado'));
});

export async function instalarAplicativo() {
  if (!eventoInstalacao || estaInstalado()) return false;
  const evento = eventoInstalacao;
  eventoInstalacao = null;
  evento.prompt();
  const escolha = await evento.userChoice;
  document.dispatchEvent(new CustomEvent('cantina:instalacao-atualizada'));
  return escolha?.outcome === 'accepted';
}

export function podeInstalar() {
  return !estaInstalado() && Boolean(eventoInstalacao);
}

export function podeMostrarAjudaIOS() {
  return !estaInstalado() && ehIOS();
}
