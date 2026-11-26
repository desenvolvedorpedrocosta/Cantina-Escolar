import { apiRequest } from './api.js';
import { enviarMovimentacao } from './offline.js';


/** Captura a data/hora do evento no aparelho antes de qualquer envio.
 * Os campos são mantidos dentro da fila offline e não são recalculados no retry.
 */
function metadadosDataEvento() {
  const agora = new Date();
  const pad = (valor) => String(valor).padStart(2, '0');
  const dataCompetencia = [
    agora.getFullYear(),
    pad(agora.getMonth() + 1),
    pad(agora.getDate())
  ].join('-');
  const dataHoraOriginal = agora.toISOString();

  return {
    dataCompetencia,
    dataHoraOriginal,
    // Mantido por compatibilidade com as filas e o backend anteriores.
    dataDispositivo: dataHoraOriginal
  };
}

export function parseMoneyToCents(value) {
  const normalized = String(value ?? '')
    .trim()
    .replace(/\s/g, '')
    .replace(/^R\$/i, '')
    .replace(/\./g, '')
    .replace(',', '.');
  const number = Number(normalized);
  if (!Number.isFinite(number) || number < 0) return NaN;
  return Math.round(number * 100);
}

export async function abrirCaixa(token, valorCentavos) {
  return apiRequest({
    acao: 'abrirCaixa',
    token,
    valorCentavos,
    idRequisicao: 'ABERTURA-' + crypto.randomUUID(),
    ...metadadosDataEvento()
  });
}

export async function registrarVenda({ token, forma, valorCentavos, recebidoCentavos }) {
  const payload = {
    acao: 'registrarMovimentacao',
    token,
    tipo: 'VENDA',
    pagamento: forma,
    valorCentavos,
    observacao: 'Venda da cantina',
    idRequisicao: crypto.randomUUID(),
    ...metadadosDataEvento()
  };
  if (forma === 'DINHEIRO') payload.recebidoCentavos = recebidoCentavos;
  return enviarMovimentacao(payload);
}

export async function registrarAjuste({ token, tipo, valorCentavos, observacao }) {
  return enviarMovimentacao({
    acao: 'registrarMovimentacao',
    token,
    tipo,
    pagamento: 'DINHEIRO',
    valorCentavos,
    observacao,
    idRequisicao: crypto.randomUUID(),
    ...metadadosDataEvento()
  });
}
