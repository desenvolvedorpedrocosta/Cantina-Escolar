import { apiRequest } from './api.js';

export function consultarStatus(token) {
  return apiRequest({ acao: 'statusCaixa', token });
}

export function consultarResumo(token) {
  return apiRequest({ acao: 'resumo', token });
}

export function fecharCaixa({ token, dinheiroContadoCentavos, confirmouSincronizacao, observacao = '' }) {
  return apiRequest({
    acao: 'fecharCaixa',
    token,
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
