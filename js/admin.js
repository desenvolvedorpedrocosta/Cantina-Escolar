import { apiRequest } from './api.js';

export function consultarStatus(token) {
  return apiRequest({ acao: 'statusCaixa', token });
}

export function consultarResumo(token) {
  return apiRequest({ acao: 'resumo', token });
}

export function fecharCaixa({ token, data, dinheiroContadoCentavos, confirmouSincronizacao, observacao = '' }) {
  return apiRequest({
    acao: 'fecharCaixa',
    token,
    data,
    dinheiroContadoCentavos,
    confirmouSincronizacao,
    observacao
  });
}

export function alterarPin({ token, tipo, novoPin }) {
  return apiRequest({
    acao: 'alterarPin',
    token,
    tipo,
    novoPin
  });
}

export function consultarRelatorioGestao(token, data) {
  return apiRequest({ acao: 'relatorioGestao', token, data });
}

export function consultarHistoricoFechamentos(token, inicio, fim) {
  return apiRequest({ acao: 'historicoFechamentos', token, inicio, fim });
}
