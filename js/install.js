let eventoInstalacao = null;

window.addEventListener('beforeinstallprompt', (event) => {
  event.preventDefault();
  eventoInstalacao = event;
  document.dispatchEvent(new CustomEvent('cantina:instalavel'));
});

export async function instalarAplicativo() {
  if (!eventoInstalacao) return false;
  eventoInstalacao.prompt();
  const escolha = await eventoInstalacao.userChoice;
  eventoInstalacao = null;
  return escolha?.outcome === 'accepted';
}

export function podeInstalar() {
  return Boolean(eventoInstalacao);
}
