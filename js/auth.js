import { apiRequest } from './api.js';
import { salvarSessao, obterSessao, limparSessao } from './storage.js';

export async function entrar({ perfil, nome, pin }) {
  const dados = await apiRequest({
    acao: 'login',
    perfil,
    nome: nome || '',
    pin
  });

  const sessao = {
    token: dados.token,
    nome: dados.nome,
    perfil: dados.perfil,
    validadeHoras: dados.validadeHoras,
    salvoEm: Date.now()
  };

  salvarSessao(sessao);
  return sessao;
}

export function sessaoAtual() {
  return obterSessao();
}

export function sair() {
  limparSessao();
}
