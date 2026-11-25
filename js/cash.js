import { apiRequest } from './api.js';
import { enviarMovimentacao } from './offline.js';

export function parseMoneyToCents(value) {
  const texto = String(value ?? '').trim();

  // Campo vazio não pode ser interpretado como R$ 0,00.
  if (!texto) return NaN;

  const normalized = texto
    .replace(/\s/g, '')
    .replace(/^R\$/i, '')
    .replace(/\./g, '')
    .replace(',', '.');

  // Também rejeita conteúdos como "R$" sem valor numérico.
  if (!normalized) return NaN;

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
    dataDispositivo: new Date().toISOString()
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
    dataDispositivo: new Date().toISOString()
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
    dataDispositivo: new Date().toISOString()
  });
}
