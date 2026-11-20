import { apiRequest } from './api.js';
import { listarFila, salvarNaFila, removerDaFila, atualizarFila } from './storage.js';

function criarId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'cantina-' + Date.now() + '-' + Math.random().toString(16).slice(2);
}

export async function quantidadePendente() {
  return (await listarFila()).length;
}

export async function enviarMovimentacao(payload) {
  const item = {
    idRequisicao: payload.idRequisicao || criarId(),
    payload: { ...payload },
    criadoEm: new Date().toISOString(),
    tentativas: 0,
    ultimoErro: ''
  };
  item.payload.idRequisicao = item.idRequisicao;

  // Guardar primeiro garante que a movimentação sobreviva a queda de energia,
  // fechamento da aba ou perda de conexão durante a requisição.
  await salvarNaFila(item);

  if (!navigator.onLine) {
    return { pendente: true, idRequisicao: item.idRequisicao };
  }

  try {
    const resultado = await sincronizarItem(item);
    return { pendente: false, resultado, idRequisicao: item.idRequisicao };
  } catch (error) {
    if (error.name === 'NetworkError') {
      return { pendente: true, idRequisicao: item.idRequisicao };
    }
    // Erro de validação/negócio permanece na fila para não perder a operação.
    await atualizarFila({ ...item, ultimoErro: error.message, tentativas: item.tentativas + 1 });
    throw error;
  }
}

async function sincronizarItem(item) {
  const sessao = JSON.parse(localStorage.getItem('cantina_sessao') || 'null');
  if (!sessao?.token) {
    throw new Error('Entre novamente para sincronizar as movimentações pendentes.');
  }

  const payload = { ...item.payload, token: sessao.token };
  try {
    const resultado = await apiRequest(payload, { timeout: 30000 });
    // O backend confirma duplicidade quando o mesmo ID já foi processado.
    await removerDaFila(item.idRequisicao);
    return resultado;
  } catch (error) {
    await atualizarFila({ ...item, tentativas: item.tentativas + 1, ultimoErro: error.message });
    throw error;
  }
}

export async function sincronizarFila() {
  if (!navigator.onLine) return { sincronizadas: 0, pendentes: await quantidadePendente() };

  const fila = await listarFila();
  let sincronizadas = 0;

  for (const item of fila) {
    try {
      await sincronizarItem(item);
      sincronizadas++;
    } catch (error) {
      // Preserva a ordem da fila: uma falha interrompe os próximos envios.
      // O item mantém o mesmo idRequisicao para que o retry não duplique a venda.
      break;
    }
  }

  return { sincronizadas, pendentes: await quantidadePendente() };
}

export async function detalhesFila() {
  return listarFila();
}
