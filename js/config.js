
/**
 * CANTINA DA ESCOLA
 * CONFIGURAÇÕES PRINCIPAIS
 * Compatível com Code.gs 1.3.1
 */

const CANTINA = {
  NOME: 'Cantina da Escola',
  VERSAO: '1.3.1',

  TIMEZONE: 'America/Sao_Paulo',

  SESSAO_HORAS: 6,

  ABAS: {
    MOVIMENTACOES: 'MOVIMENTACOES',
    RESUMO: 'RESUMO_DIARIO',
    CONFIGURACAO: 'CONFIGURACAO',
    FECHAMENTOS: 'FECHAMENTOS'
  },

  CABECALHOS: {
    MOVIMENTACOES: [
      'ID',
      'DATA_HORA',
      'DATA_DISPOSITIVO',
      'OPERADOR',
      'TIPO',
      'PAGAMENTO',
      'VALOR',
      'RECEBIDO',
      'TROCO',
      'IMPACTO_CAIXA',
      'OBSERVACAO',
      'ID_REQUISICAO',
      'ID_ESTORNO',
      'STATUS'
    ],

    FECHAMENTOS: [
      'ID',
      'DATA',
      'DATA_HORA',
      'RESPONSAVEL',
      'TOTAL_VENDIDO',
      'DINHEIRO',
      'PIX',
      'ENTRADAS',
      'SAIDAS',
      'SALDO_ESPERADO',
      'DINHEIRO_CONTADO',
      'DIFERENCA',
      'OBSERVACAO',
      'STATUS'
    ],

    RESUMO: [
      'DATA',
      'TOTAL_VENDIDO',
      'DINHEIRO',
      'PIX',
      'ENTRADAS',
      'SAIDAS',
      'SALDO_ESPERADO',
      'DINHEIRO_CONTADO',
      'DIFERENCA',
      'RESPONSAVEL',
      'STATUS'
    ],

    CONFIGURACAO: [
      'CHAVE',
      'VALOR'
    ]
  }
};


/**
 * Lê os PINs e demais configurações
 * armazenados na aba CONFIGURACAO.
 *
 * A primeira coluna contém a chave.
 * A segunda coluna contém o valor.
 */
function obterConfiguracoes_() {
  const planilha = SpreadsheetApp.getActiveSpreadsheet();

  const aba = planilha.getSheetByName(
    CANTINA.ABAS.CONFIGURACAO
  );

  if (!aba) {
    throw new Error(
      'A aba CONFIGURACAO não foi encontrada.'
    );
  }

  const ultimaLinha = aba.getLastRow();

  if (ultimaLinha < 2) {
    throw new Error(
      'Configure os PINs na aba CONFIGURACAO.'
    );
  }

  const registros = aba.getRange(
    2,
    1,
    ultimaLinha - 1,
    2
  ).getDisplayValues();

  const configuracoes = {};

  registros.forEach(function(linha) {
    const chave = String(linha[0] || '').trim();

    if (chave) {
      configuracoes[chave] = String(
        linha[1] || ''
      ).trim();
    }
  });

  if (!configuracoes.PIN_OPERADORA) {
    throw new Error(
      'PIN_OPERADORA não configurado.'
    );
  }

  if (!configuracoes.PIN_ADMIN) {
    throw new Error(
      'PIN_ADMIN não configurado.'
    );
  }

  return configuracoes;
}


/**
 * Atualiza uma configuração existente
 * ou acrescenta uma nova chave.
 *
 * Não apaga outras configurações.
 */
function atualizarConfiguracao_(chave, valor) {
  const planilha = SpreadsheetApp.getActiveSpreadsheet();

  const aba = planilha.getSheetByName(
    CANTINA.ABAS.CONFIGURACAO
  );

  if (!aba) {
    throw new Error(
      'A aba CONFIGURACAO não foi encontrada.'
    );
  }

  const chaveNormalizada = String(chave || '').trim();

  if (!chaveNormalizada) {
    throw new Error('Chave de configuração inválida.');
  }

  const ultimaLinha = aba.getLastRow();

  if (ultimaLinha >= 2) {
    const chaves = aba.getRange(
      2,
      1,
      ultimaLinha - 1,
      1
    ).getDisplayValues();

    for (let i = 0; i < chaves.length; i++) {
      if (
        String(chaves[i][0]).trim() === chaveNormalizada
      ) {
        aba.getRange(i + 2, 2).setNumberFormat('@');
        aba.getRange(i + 2, 2).setValue(String(valor));

        SpreadsheetApp.flush();

        return true;
      }
    }
  }

  const novaLinha = Math.max(2, ultimaLinha + 1);

  aba.getRange(novaLinha, 1, 1, 2).setValues([[
    chaveNormalizada,
    String(valor)
  ]]);

  SpreadsheetApp.flush();

  return true;
}
