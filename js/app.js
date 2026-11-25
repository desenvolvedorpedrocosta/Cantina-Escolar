import { entrar, sessaoAtual, sair } from './auth.js';
import { abrirCaixa, registrarVenda, registrarAjuste, parseMoneyToCents } from './cash.js';
import { consultarStatus, fecharCaixa, alterarPin, consultarRelatorioGestao, consultarHistoricoFechamentos } from './admin.js';
import { formatarMoeda, formatarDataHora, formatarTipo } from './reports.js';
import { sincronizarFila, quantidadePendente, detalhesFila } from './offline.js';
import { obterSessao, prefereLembrarLogin } from './storage.js';
import { urlConfigurada } from './api.js';
import { instalarAplicativo, podeMostrarAjudaIOS, podeInstalar, ehChromium, tipoInstalacao, estaInstalado } from './install.js';
import { criarRelatorioPDF, criarRelatorioPeriodoPDF } from './pdf-report.js';

const root = document.getElementById('app-root');
const connection = document.getElementById('connection-status');
const logoutButton = document.getElementById('logout-button');
const installButton = document.getElementById('install-button');
const toastRegion = document.getElementById('toast-region');
const appDialog = document.getElementById('app-dialog');
const appDialogContent = document.getElementById('app-dialog-content');
let qrcodeLibraryPromise = null;

const state = {
  perfilLogin: 'OPERADORA',
  sessao: null,
  status: null,
  ultimaConsulta: null,
  busy: false,
  statusError: null,
  historico: null,
  historicoInicio: '',
  historicoFim: '',
  historicoAutoIniciado: false,
  historicoConsultaEmCurso: false,
  fechamentoSelecionado: null,
  relatorioFechamentoSelecionado: null,
  pdfDiario: null,
  pdfPeriodo: null,
  pdfFechamento: null
};

let historicoCharts = [];
let chartLibraryPromise = null;

const STORAGE_STATUS = 'cantina_status_cache';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

/**
 * Formata os campos monetários usando apenas os dígitos digitados.
 * Exemplo: 1 -> 0,01; 15 -> 0,15; 150 -> 1,50.
 * O valor continua como texto pt-BR e é convertido em centavos
 * por parseMoneyToCents() no envio dos formulários.
 */
function formatarCampoMonetario(input) {
  const valorAnterior = String(input.value || '');
  const posicaoAnterior = typeof input.selectionStart === 'number'
    ? input.selectionStart
    : valorAnterior.length;
  const digitosAntesDoCursor = valorAnterior
    .slice(0, posicaoAnterior)
    .replace(/\D/g, '').length;
  const digitos = valorAnterior.replace(/\D/g, '').slice(0, 11);

  const valorFormatado = digitos
    ? (Number(digitos) / 100).toLocaleString('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      })
    : '';

  input.value = valorFormatado;

  // Mantém o cursor próximo da posição em que o usuário estava digitando.
  let novaPosicao = 0;
  let digitosPercorridos = 0;
  while (novaPosicao < valorFormatado.length && digitosPercorridos < digitosAntesDoCursor) {
    if (/\d/.test(valorFormatado.charAt(novaPosicao))) digitosPercorridos++;
    novaPosicao++;
  }
  if (digitosAntesDoCursor >= digitos.length) novaPosicao = valorFormatado.length;

  try {
    input.setSelectionRange(novaPosicao, novaPosicao);
  } catch (_) {
    // Alguns teclados/navegadores não permitem alterar seleção neste momento.
  }
}

// Captura antes dos eventos dos campos para que cálculos como o troco
// sempre recebam o valor já formatado (ex.: 1,50), nunca os dígitos crus.
root.addEventListener('input', (event) => {
  const campo = event.target.closest('[data-money-input]');
  if (campo) formatarCampoMonetario(campo);
}, true);

// No campo de abertura, o valor inicial 0,00 fica selecionado ao tocar,
// para que a digitação comece diretamente pelos centavos desejados.
root.addEventListener('focusin', (event) => {
  const campo = event.target.closest('[data-money-input]');
  if (campo && campo.value === '0,00') campo.select();
}, true);

function mostrarToast(message, type = '') {
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.textContent = message;
  toastRegion.appendChild(toast);
  window.setTimeout(() => toast.remove(), 4800);
}

function definirConexao() {
  const online = navigator.onLine;
  connection.classList.toggle('online', online);
  connection.classList.toggle('offline', !online);
  connection.querySelector('span').textContent = online ? 'Conectado' : 'Sem internet';
}

function setBusy(busy) {
  state.busy = busy;
  root.querySelectorAll('button, input, select, textarea').forEach((element) => {
    if (!element.dataset.keepEnabled) element.disabled = busy;
  });
}

function obterStatusCache() {
  try { return JSON.parse(localStorage.getItem(STORAGE_STATUS) || 'null'); }
  catch { return null; }
}

function salvarStatusCache(status) {
  localStorage.setItem(STORAGE_STATUS, JSON.stringify({ ...status, cacheAtualizadoEm: Date.now() }));
}

function dataHojePt() {
  return new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
  }).format(new Date());
}


function atualizarBotaoInstalacao() {
  if (!installButton) return;
  if (estaInstalado() || tipoInstalacao() === 'instalado') {
    installButton.classList.add('hidden');
    return;
  }

  // O botão permanece disponível mesmo antes do beforeinstallprompt.
  // Quando o navegador entrega o prompt nativo, o texto muda para Instalar app.
  installButton.textContent = podeInstalar() ? 'Instalar app' : 'Como instalar';
  installButton.setAttribute('aria-haspopup', 'dialog');
  installButton.setAttribute('aria-controls', 'install-help-overlay');
  installButton.classList.remove('hidden');
}

function abrirDialogo(html) {
  appDialogContent.innerHTML = html;
  if (!appDialog.open) appDialog.showModal();
}

function fecharDialogo() {
  if (appDialog.open) appDialog.close();
  appDialogContent.innerHTML = '';
}

function linkCompartilhamento() {
  const url = new URL(window.location.href);
  url.hash = '';
  url.search = '';
  return url.href;
}

async function copiarTexto(texto) {
  if (navigator.clipboard?.writeText && window.isSecureContext) {
    await navigator.clipboard.writeText(texto);
    return;
  }
  const area = document.createElement('textarea');
  area.value = texto;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand('copy');
  area.remove();
  if (!ok) throw new Error('Não foi possível copiar o link neste navegador.');
}

async function mostrarModalCompartilharApp() {
  const link = linkCompartilhamento();
  abrirDialogo(`
    <div class="dialog-body">
      <div class="dialog-head"><div><p class="eyebrow">Acesso rápido</p><h2 id="app-dialog-title">Compartilhar App</h2><p class="subtle">Envie este link para abrir a Cantina da Escola em outro aparelho.</p></div><button class="dialog-close" type="button" data-dialog-close aria-label="Fechar">×</button></div>
      <div class="share-link" id="share-app-url">${escapeHtml(link)}</div>
      <div class="qr-wrap"><div id="share-app-qr"></div><span class="qr-caption">Aponte a câmera do celular para o QR Code.</span></div>
      <button type="button" class="button button-primary button-block" id="copy-app-link">Copiar Link</button>
      <p class="copy-feedback" id="copy-app-feedback" aria-live="polite"></p>
    </div>`);
  const qrHost = document.getElementById('share-app-qr');
  if (qrHost) qrHost.textContent = 'Gerando QR Code…';
  try {
    if (!window.QRCode) {
      if (!qrcodeLibraryPromise) {
        qrcodeLibraryPromise = new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js';
          script.integrity = 'sha512-CNgIRecGo7nphbeZ04Sc13ka07paqdeTu0WR1IM4kNcpmBAUSHSQX0FslNhTDadL4O5SAGapGt4FodqL8My0mA==';
          script.crossOrigin = 'anonymous';
          script.referrerPolicy = 'no-referrer';
          script.onload = resolve;
          script.onerror = () => reject(new Error('Não foi possível carregar o gerador de QR Code.'));
          document.head.appendChild(script);
        });
      }
      await qrcodeLibraryPromise;
    }
    if (qrHost?.isConnected && window.QRCode) {
      qrHost.textContent = '';
      new window.QRCode(qrHost, {
        text: link,
        width: 180,
        height: 180,
        colorDark: '#102b46',
        colorLight: '#ffffff',
        correctLevel: window.QRCode.CorrectLevel.M
      });
    }
  } catch (error) {
    qrcodeLibraryPromise = null;
    if (qrHost?.isConnected) qrHost.textContent = 'QR Code indisponível agora. Use o link acima ou tente novamente com internet.';
  }
  document.getElementById('copy-app-link')?.addEventListener('click', async () => {
    const feedback = document.getElementById('copy-app-feedback');
    const button = document.getElementById('copy-app-link');
    try {
      await copiarTexto(link);
      button.textContent = 'Copiado!';
      if (feedback) feedback.textContent = 'Link copiado com sucesso.';
      window.setTimeout(() => { if (button.isConnected) button.textContent = 'Copiar Link'; }, 2200);
    } catch (error) {
      if (feedback) feedback.textContent = error.message;
    }
  });
}

function fecharAjudaInstalacao() {
  const overlay = document.getElementById('install-help-overlay');
  if (overlay) overlay.remove();
  document.body.classList.remove('install-help-open');
  if (fecharAjudaInstalacao._keydown) {
    document.removeEventListener('keydown', fecharAjudaInstalacao._keydown, true);
    fecharAjudaInstalacao._keydown = null;
  }
}

function abrirPainelAjudaInstalacao({ titulo, descricao, passos, nota = '' }) {
  fecharAjudaInstalacao();

  const overlay = document.createElement('div');
  overlay.id = 'install-help-overlay';
  overlay.className = 'install-help-overlay';
  overlay.innerHTML = `
    <section class="install-help-card" role="dialog" aria-modal="true" aria-labelledby="install-help-title" tabindex="-1">
      <div class="install-help-head">
        <div>
          <p class="eyebrow">Cantina da Escola</p>
          <h2 id="install-help-title">${escapeHtml(titulo)}</h2>
        </div>
        <button class="install-help-close" type="button" data-install-help-close aria-label="Fechar instruções">×</button>
      </div>
      <p class="install-help-description">${escapeHtml(descricao)}</p>
      <ol class="install-help-steps">
        ${passos.map((passo, index) => `<li><span class="install-help-number">${index + 1}</span><span>${passo}</span></li>`).join('')}
      </ol>
      ${nota ? `<p class="install-help-note">${escapeHtml(nota)}</p>` : ''}
      <button type="button" class="button button-primary button-block" data-install-help-close>Entendi</button>
    </section>`;

  document.body.appendChild(overlay);
  document.body.classList.add('install-help-open');

  overlay.addEventListener('click', (event) => {
    // Fechamento pelo botão ou toque na área escura, sem cancelar o clique.
    if (event.target === overlay || event.target.closest('[data-install-help-close]')) {
      fecharAjudaInstalacao();
    }
  });

  fecharAjudaInstalacao._keydown = (event) => {
    if (event.key === 'Escape') fecharAjudaInstalacao();
  };
  document.addEventListener('keydown', fecharAjudaInstalacao._keydown, true);

  requestAnimationFrame(() => overlay.querySelector('.install-help-close')?.focus());
}

function mostrarAjudaInstalacao() {
  abrirPainelAjudaInstalacao({
    titulo: 'Adicionar à Tela de Início',
    descricao: 'Para instalar no iPhone: 1. Abra este link no Safari → 2. Toque no ícone de Compartilhar (quadrado com seta pra cima) → 3. Role e toque em Adicionar à Tela de Início.',
    passos: [
      'Abra este link no <strong>Safari</strong>. Se estiver em outro navegador, copie o endereço e abra-o no Safari.',
      'Toque no ícone de <strong>Compartilhar</strong> (quadrado com seta pra cima).',
      'Role as opções e toque em <strong>Adicionar à Tela de Início</strong>. Depois confirme em <strong>Adicionar</strong>.'
    ],
    nota: 'No iPad, siga os mesmos passos pelo Safari.'
  });
}

function mostrarAjudaInstalacaoNaoIOS() {
  const chromium = ehChromium();
  abrirPainelAjudaInstalacao({
    titulo: 'Instalar Cantina da Escola',
    descricao: chromium
      ? 'O navegador ainda não apresentou o botão automático de instalação. Você pode instalar pelo menu do navegador.'
      : 'Este navegador não apresentou o comando automático de instalação. Procure a opção de instalar no menu do navegador.',
    passos: chromium ? [
      'Abra o menu do navegador (⋮ ou …), no canto superior.',
      'Procure <strong>Aplicativos / Apps</strong> ou <strong>Instalar aplicativo</strong>.',
      'No Microsoft Edge, abra <strong>Menu ⋯ → Mais ferramentas → Aplicativos → Instalar este site como um aplicativo</strong>. No Chrome ou Brave, procure <strong>Instalar página como app</strong> ou <strong>Instalar aplicativo</strong>.',
      'Confirme em <strong>Instalar</strong> ou <strong>Adicionar</strong>.'
    ] : [
      'Abra o menu do navegador.',
      'Procure <strong>Instalar aplicativo</strong>, <strong>Adicionar à tela inicial</strong> ou opção equivalente.',
      'Confirme a instalação, se o navegador oferecer essa opção.'
    ],
    nota: 'Se o botão “Instalar app” aparecer depois, toque nele para abrir a instalação nativa do navegador.'
  });
}


function renderLogin(message = '') {
  logoutButton.classList.add('hidden');
  root.innerHTML = `
    <section class="login-wrap">
      <div class="login-card">
        <p class="eyebrow">Cantina da Escola</p>
        <h1>Bem-vindo à cantina</h1>
        <p class="subtle">Entre para registrar as vendas e movimentações do caixa.</p>
        ${message ? `<div class="notice warning" style="margin-top:16px">${escapeHtml(message)}</div>` : ''}
        ${!urlConfigurada() ? '<div class="notice error" style="margin-top:16px"><strong>Configuração necessária</strong>Informe o endereço do Web App no arquivo <code>js/config.js</code> antes de publicar.</div>' : ''}
        <div class="role-switch" role="group" aria-label="Tipo de acesso">
          <button type="button" data-role="OPERADORA" class="${state.perfilLogin === 'OPERADORA' ? 'active' : ''}">Operadora</button>
          <button type="button" data-role="ADMIN" class="${state.perfilLogin === 'ADMIN' ? 'active' : ''}">Gestão</button>
        </div>
        <form id="login-form" class="form-stack">
          ${state.perfilLogin === 'OPERADORA' ? '<div class="field"><label for="login-name">Seu nome</label><input id="login-name" name="nome" type="text" maxlength="60" autocomplete="name" placeholder="Digite seu nome" required></div>' : ''}
          <div class="field"><label for="login-pin">PIN de 4 números</label><input id="login-pin" name="pin" class="pin-input" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="current-password" placeholder="••••" required></div>
          <label class="remember-login"><input type="checkbox" name="lembrarLogin" ${prefereLembrarLogin() ? 'checked' : ''}><span>Salvar meu login neste aparelho</span></label>
          <button class="button button-primary button-block" type="submit" ${!urlConfigurada() ? 'disabled' : ''}>Entrar no sistema</button>
        </form>
        <div class="login-extra-actions">
          <button class="button button-outline button-block" type="button" data-action="share-app">Compartilhar App</button>
        </div>
      </div>
    </section>`;
  atualizarBotaoInstalacao();
}

function statusLabel(status) {
  if (status?.fechado) return '<span class="status-badge closed">Caixa fechado</span>';
  if (status?.aberto) return '<span class="status-badge">Caixa aberto</span>';
  return '<span class="status-badge pending">Abertura pendente</span>';
}

function metric(label, value, emphasis = false) {
  return `<div class="metric ${emphasis ? 'emphasis' : ''}"><span>${escapeHtml(label)}</span><strong>${formatarMoeda(value)}</strong></div>`;
}

function renderMovements(items = []) {
  if (!items.length) return '<div class="empty-state">Nenhuma movimentação confirmada hoje.</div>';
  return `
    <div class="table-wrap">
      <table class="movements">
        <thead><tr><th>Horário</th><th>Movimentação</th><th>Operadora</th><th>Pagamento</th><th>Valor</th></tr></thead>
        <tbody>
          ${items.map((item) => {
            const negative = item.tipo === 'SAIDA';
            const payment = item.pagamento === 'DINHEIRO' ? 'Dinheiro' : item.pagamento === 'PIX' ? 'Pix' : '—';
            return `<tr>
              <td>${escapeHtml(formatarDataHora(item.dataHora))}</td>
              <td><strong>${escapeHtml(formatarTipo(item.tipo))}</strong>${item.observacao ? `<br><span class="subtle">${escapeHtml(item.observacao)}</span>` : ''}</td>
              <td>${escapeHtml(item.operador)}</td>
              <td>${payment}</td>
              <td class="${negative ? 'amount-negative' : 'amount-positive'}">${negative ? '− ' : ''}${formatarMoeda(item.valor)}</td>
            </tr>`;
          }).join('')}
        </tbody>
      </table>
    </div>`;
}

async function renderPendingPanel() {
  const queue = await detalhesFila();
  if (!queue.length) return '';
  return `
    <section class="panel" style="margin-bottom:16px">
      <div class="panel-head"><div><h3>Movimentações aguardando sincronização</h3><p class="subtle">Elas permanecem salvas neste aparelho e serão reenviadas com o mesmo identificador.</p></div><span class="status-badge pending">${queue.length} pendente(s)</span></div>
      <div class="pending-list">${queue.map((item) => `
        <div class="pending-item"><strong>${escapeHtml(item.payload.tipo)} · ${formatarMoeda((item.payload.valorCentavos || 0) / 100)}</strong>
        ${escapeHtml(new Date(item.criadoEm).toLocaleString('pt-BR'))}${item.ultimoErro ? `<br><span>${escapeHtml(item.ultimoErro)}</span>` : ''}</div>`).join('')}</div>
      <div class="form-actions"><button type="button" class="button button-outline" data-action="sync">Sincronizar agora</button></div>
    </section>`;
}

function renderAnalytics(indicadores = {}) {
  const quantidade = Number(indicadores.quantidadeVendas || 0);
  const media = Number(indicadores.ticketMedio || 0);
  const cash = Number(indicadores.totalDinheiro || 0);
  const pix = Number(indicadores.totalPix || 0);
  const total = cash + pix;
  const cashPct = total > 0 ? Math.round((cash / total) * 100) : 0;
  const pixPct = total > 0 ? 100 - cashPct : 0;
  const operadores = Array.isArray(indicadores.operadores) ? indicadores.operadores : [];
  const ranking = operadores.length ? operadores.slice(0, 5).map((item) => `
    <div class="analytics-row"><strong>${escapeHtml(item.nome)}</strong><div class="analytics-bar"><span style="width:${Math.max(0, Math.min(100, Number(item.percentual || 0)))}%"></span></div><span>${formatarMoeda(item.totalVendido)}</span></div>`).join('') : '<div class="empty-state">Ainda não há vendas por operadora.</div>';
  return `<section class="panel"><div class="panel-head"><div><p class="eyebrow">Acompanhamento</p><h2>Indicadores do dia</h2><p class="subtle">Números calculados com todas as movimentações confirmadas de hoje.</p></div></div>
    <div class="analytics-grid">
      <div class="metric"><span>Quantidade de vendas</span><strong>${quantidade}</strong></div>
      <div class="metric"><span>Valor médio por venda</span><strong>${formatarMoeda(media)}</strong></div>
      <div class="metric"><span>Movimentações registradas</span><strong>${Number(indicadores.quantidadeMovimentacoes || 0)}</strong></div>
      <div class="metric"><span>Entradas registradas</span><strong>${Number(indicadores.quantidadeEntradas || 0)}</strong></div>
      <div class="metric"><span>Saídas registradas</span><strong>${Number(indicadores.quantidadeSaidas || 0)}</strong></div>
      <div class="metric"><span>Vendas em dinheiro</span><strong>${Number(indicadores.quantidadeDinheiro || 0)}</strong></div>
      <div class="metric"><span>Vendas por Pix</span><strong>${Number(indicadores.quantidadePix || 0)}</strong></div>
    </div>
    <div class="grid-two" style="margin-top:15px">
      <div><h3>Vendas por forma de pagamento</h3><div class="analytics-list">
        <div class="analytics-row"><strong>Dinheiro</strong><div class="analytics-bar"><span style="width:${cashPct}%"></span></div><span>${cashPct}%</span></div>
        <div class="analytics-row"><strong>Pix</strong><div class="analytics-bar"><span style="width:${pixPct}%"></span></div><span>${pixPct}%</span></div>
      </div><p class="subtle" style="margin-top:8px">Dinheiro: ${formatarMoeda(cash)} · Pix: ${formatarMoeda(pix)}</p></div>
      <div><h3>Vendas por operadora</h3><div class="analytics-list">${ranking}</div></div>
    </div>
  </section>`;
}

function dataISOlocal(data = new Date()) {
  const partes = new Intl.DateTimeFormat('en-CA', {
    year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(data);
  const valores = Object.fromEntries(partes.map((item) => [item.type, item.value]));
  return `${valores.year}-${valores.month}-${valores.day}`;
}

function subtrairDiasISO(dataIso, quantidade) {
  const [ano, mes, dia] = dataIso.split('-').map(Number);
  const data = new Date(ano, mes - 1, dia, 12);
  data.setDate(data.getDate() - quantidade);
  return dataISOlocal(data);
}

function dataPtCurta(valor) {
  const partes = String(valor || '').split('-');
  return partes.length === 3 ? `${partes[2]}/${partes[1]}/${partes[0]}` : String(valor || '—');
}

function statusFechamentoLabel(status) {
  const valor = String(status || '').toUpperCase();
  if (valor === 'CONFERIDO' || valor === 'BATEU') return 'BATEU';
  if (valor === 'SOBRA') return 'SOBRA';
  if (valor === 'FALTA') return 'FALTA';
  return valor || '—';
}

function renderAcoesPDF(scope, texto = '') {
  return `<div class="pdf-action-row">
    ${texto ? `<p class="subtle pdf-ready-label">${escapeHtml(texto)}</p>` : ''}
    <div class="form-actions pdf-action-buttons">
      <button type="button" class="button button-primary" data-action="save-pdf" data-pdf-scope="${scope}">Salvar PDF</button>
      <button type="button" class="button button-outline" data-action="share-pdf" data-pdf-scope="${scope}">Compartilhar PDF</button>
    </div>
  </div>`;
}

function renderHistoricoFechamentos() {
  if (!state.historicoInicio || !state.historicoFim) {
    const hoje = dataISOlocal();
    state.historicoFim = hoje;
    state.historicoInicio = subtrairDiasISO(hoje, 1095);
  }

  const historico = state.historico;
  let resultados = '<div class="empty-state">O histórico será carregado automaticamente ao entrar na Gestão. Você também pode escolher outro período e tocar em “Consultar fechamentos”.</div>'; 

  if (historico) {
    const c = historico.consolidado || {};
    const fechamentos = (Array.isArray(historico.fechamentos) ? historico.fechamentos : [])
      .slice()
      .sort((a, b) => String(a.data).localeCompare(String(b.data)) || String(a.dataHora || '').localeCompare(String(b.dataHora || '')));
    const diagnostico = historico.diagnostico || {};
    let mensagemSemFechamento = 'Nenhum fechamento foi encontrado entre as datas selecionadas. A consulta inclui a data inicial e a final.';
    if (Number(diagnostico.linhasLidas || 0) === 0) {
      mensagemSemFechamento += ' A aba FECHAMENTOS não possui registros abaixo do cabeçalho.';
    } else if (Number(diagnostico.datasReconhecidas || 0) === 0) {
      mensagemSemFechamento += ` A aba FECHAMENTOS possui ${Number(diagnostico.linhasLidas)} linha(s), mas nenhuma data pôde ser reconhecida na coluna B.`;
    } else if (diagnostico.dataMaisAntiga && diagnostico.dataMaisRecente) {
      mensagemSemFechamento += ` As datas registradas na planilha vão de ${dataPtCurta(diagnostico.dataMaisAntiga)} até ${dataPtCurta(diagnostico.dataMaisRecente)}.`;
    }
    const linhas = fechamentos.length ? fechamentos.map((item) => `
      <tr class="${state.fechamentoSelecionado?.id === item.id ? 'is-selected' : ''}">
        <td>${dataPtCurta(item.data)}</td>
        <td>${escapeHtml(item.responsavel || '—')}</td>
        <td>${formatarMoeda(item.totalVendido)}</td>
        <td>${formatarMoeda(item.saldoEsperado)}</td>
        <td>${formatarMoeda(item.dinheiroContado)}</td>
        <td>${formatarMoeda(item.diferenca)}</td>
        <td><span class="closure-status ${String(item.statusExibicao || '').toLowerCase()}">${statusFechamentoLabel(item.statusExibicao || item.status)}</span></td>
        <td><button type="button" class="button button-outline button-small" data-action="history-detail" data-close-id="${escapeHtml(item.id)}" data-close-date="${escapeHtml(item.data)}">Detalhar</button></td>
      </tr>`).join('') : `<tr><td colspan="8"><div class="empty-state">${escapeHtml(mensagemSemFechamento)}</div></td></tr>`;

    const periodoResumo = historico.periodo || { inicio: state.historicoInicio, fim: state.historicoFim };
    const avisoPeriodo = `<p class="subtle history-period-note">Período consultado: ${dataPtCurta(periodoResumo.inicio)} até ${dataPtCurta(periodoResumo.fim)} · ${fechamentos.length} fechamento(s). A data inicial e a data final são incluídas na consulta.</p>`;

    let detalhe = '';
    if (state.fechamentoSelecionado && state.relatorioFechamentoSelecionado) {
      const f = state.fechamentoSelecionado;
      const rel = state.relatorioFechamentoSelecionado;
      const resumo = rel.resumo || {};
      const movimentoHtml = renderMovements(rel.movimentacoes || []);
      detalhe = `<section class="history-detail-panel" id="history-selected-detail">
        <div class="panel-head"><div><p class="eyebrow">Fechamento selecionado</p><h3>${dataPtCurta(f.data)} · ${statusFechamentoLabel(f.statusExibicao || f.status)}</h3><p class="subtle">Responsável: ${escapeHtml(f.responsavel || '—')}</p></div><button type="button" class="button button-quiet button-small" data-action="history-clear-detail">Fechar detalhe</button></div>
        <div class="metric-grid history-detail-metrics">
          ${metric('Total vendido', resumo.totalVendido)}
          ${metric('Dinheiro', resumo.dinheiro)}
          ${metric('Pix', resumo.pix)}
          ${metric('Entradas', resumo.entradas)}
          ${metric('Saídas', resumo.saidas)}
          ${metric('Saldo esperado', resumo.saldoEsperado, true)}
          ${metric('Dinheiro contado', f.dinheiroContado)}
          ${metric('Diferença', f.diferenca)}
        </div>
        <div class="history-actions">${state.pdfFechamento ? renderAcoesPDF('closure', `PDF do fechamento de ${dataPtCurta(f.data)} pronto.`) : '<p class="subtle">Preparando o PDF deste fechamento…</p>'}</div>
        <h4>Movimentações do dia</h4>${movimentoHtml}
      </section>`;
    }

    resultados = `${avisoPeriodo}<div class="history-summary">
        <div class="metric-grid history-period-metrics">
          ${metric('Total vendido no período', c.totalVendido, true)}
          ${metric('Dinheiro', c.dinheiro)}
          ${metric('Pix', c.pix)}
          ${metric('Entradas/suprimentos', c.entradas)}
          ${metric('Saídas/sangrias', c.saidas)}
          ${metric('Saldo esperado nos fechamentos', c.saldoEsperado)}
          ${metric('Dinheiro contado', c.dinheiroContado)}
          ${metric('Diferença acumulada', c.diferenca)}
        </div>
        <div class="history-status-counts">
          <span class="closure-status bateu">BATEU: ${Number(c.bateu || 0)}</span>
          <span class="closure-status sobra">SOBRA: ${Number(c.sobras || 0)}</span>
          <span class="closure-status falta">FALTA: ${Number(c.faltas || 0)}</span>
          <span class="subtle">${Number(c.quantidadeFechamentos || 0)} fechamento(s)</span>
        </div>
      </div>
      <div class="history-charts">
        <section class="history-chart-card"><h3>Evolução diária das vendas</h3><p class="subtle">Comparação entre dinheiro e Pix.</p><div class="history-chart-canvas"><canvas id="history-sales-chart" aria-label="Gráfico de vendas por dia, dinheiro e Pix"></canvas></div></section>
        <section class="history-chart-card"><h3>Saldo esperado x dinheiro contado</h3><p class="subtle">Comparação nos dias em que houve fechamento.</p><div class="history-chart-canvas"><canvas id="history-closing-chart" aria-label="Gráfico de saldo esperado e dinheiro contado nos fechamentos"></canvas></div></section>
      </div>
      <div class="history-period-pdf">
        <button type="button" class="button button-primary" data-action="prepare-period-pdf" ${!navigator.onLine ? 'disabled' : ''}>Preparar PDF consolidado do período</button>
        <div id="history-period-pdf-actions">${state.pdfPeriodo ? renderAcoesPDF('period', 'PDF consolidado do período pronto.') : ''}</div>
      </div>
      <h3 class="history-list-title">Fechamentos encontrados</h3>
      <div class="table-wrap"><table class="movements history-table"><thead><tr><th>Data</th><th>Responsável</th><th>Vendido</th><th>Esperado</th><th>Contado</th><th>Diferença</th><th>Status</th><th></th></tr></thead><tbody>${linhas}</tbody></table></div>
      ${detalhe}`;
  }

  return `<section class="panel history-panel" id="history-panel">
    <div class="panel-head"><div><p class="eyebrow">Gestão · histórico</p><h2>Histórico de fechamentos</h2><p class="subtle">Consulte fechamentos anteriores, compare resultados e gere relatórios.</p></div></div>
    <div class="history-filter">
      <div class="field"><label for="history-start">Data inicial</label><input id="history-start" type="date" value="${escapeHtml(state.historicoInicio)}" max="${escapeHtml(dataISOlocal())}"></div>
      <div class="field"><label for="history-end">Data final</label><input id="history-end" type="date" value="${escapeHtml(state.historicoFim)}" max="${escapeHtml(dataISOlocal())}"></div>
      <button type="button" class="button button-dark" data-action="history-search" ${!navigator.onLine ? 'disabled' : ''}>Consultar fechamentos</button>
    </div>
    <div id="history-results">${resultados}</div>
  </section>`;
}

function destruirGraficosHistorico() {
  historicoCharts.forEach((chart) => {
    try { chart.destroy(); } catch (_) {}
  });
  historicoCharts = [];
}

function garantirChartJs() {
  if (window.Chart) return Promise.resolve(window.Chart);
  if (!chartLibraryPromise) {
    chartLibraryPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/chart.js@4.6.2/dist/chart.umd.min.js';
      script.async = true;
      script.onload = () => window.Chart ? resolve(window.Chart) : reject(new Error('A biblioteca dos gráficos não ficou disponível.'));
      script.onerror = () => reject(new Error('Não foi possível carregar os gráficos. Verifique a conexão.'));
      document.head.appendChild(script);
    }).catch((error) => {
      chartLibraryPromise = null;
      throw error;
    });
  }
  return chartLibraryPromise;
}

async function montarGraficosHistorico(historico) {
  if (!historico) return;
  const canvasVendas = document.getElementById('history-sales-chart');
  const canvasFechamentos = document.getElementById('history-closing-chart');
  if (!canvasVendas || !canvasFechamentos) return;

  const referencia = historico;
  try {
    const Chart = await garantirChartJs();
    if (state.historico !== referencia || !canvasVendas.isConnected || !canvasFechamentos.isConnected) return;
    destruirGraficosHistorico();

    const dias = Array.isArray(historico.dias) ? historico.dias : [];
    const fechamentos = (historico.fechamentos || []).slice().sort((a, b) => a.data.localeCompare(b.data));
    const labels = dias.map((dia) => dataPtCurta(dia.data));
    const moedaTooltip = (valor) => formatarMoeda(valor);

    historicoCharts.push(new Chart(canvasVendas, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Dinheiro', data: dias.map((dia) => Number(dia.dinheiro || 0)), backgroundColor: '#168b79', borderRadius: 4 },
          { label: 'Pix', data: dias.map((dia) => Number(dia.pix || 0)), backgroundColor: '#4b83c3', borderRadius: 4 }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${moedaTooltip(ctx.parsed.y)}` } } },
        scales: { x: { stacked: true, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } }, y: { stacked: true, beginAtZero: true, ticks: { callback: (value) => moedaTooltip(value) } } }
      }
    }));

    historicoCharts.push(new Chart(canvasFechamentos, {
      type: 'line',
      data: {
        labels: fechamentos.map((item) => dataPtCurta(item.data)),
        datasets: [
          { label: 'Saldo esperado', data: fechamentos.map((item) => Number(item.saldoEsperado || 0)), borderColor: '#168b79', backgroundColor: 'rgba(22,139,121,.12)', tension: .25, fill: false },
          { label: 'Dinheiro contado', data: fechamentos.map((item) => Number(item.dinheiroContado || 0)), borderColor: '#4b83c3', backgroundColor: 'rgba(75,131,195,.12)', tension: .25, fill: false }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${moedaTooltip(ctx.parsed.y)}` } } },
        scales: { x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 10 } }, y: { beginAtZero: true, ticks: { callback: (value) => moedaTooltip(value) } } }
      }
    }));
  } catch (error) {
    const host = canvasVendas?.closest('.history-chart-card');
    if (host) {
      const notice = document.createElement('p');
      notice.className = 'subtle chart-error';
      notice.textContent = error.message;
      host.appendChild(notice);
    }
  }
}

function obterPDFPreparado(scope) {
  if (scope === 'daily') return state.pdfDiario;
  if (scope === 'period') return state.pdfPeriodo;
  if (scope === 'closure') return state.pdfFechamento;
  return null;
}

function baixarPDF(blob, nome) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = nome;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function salvarPDFPreparado(scope) {
  const arquivo = obterPDFPreparado(scope);
  if (!arquivo?.blob) throw new Error('Prepare o PDF antes de salvá-lo.');

  // O seletor é aberto imediatamente no gesto de clique, antes de qualquer await.
  let seletor = null;
  if (window.isSecureContext && typeof window.showSaveFilePicker === 'function') {
    try {
      seletor = window.showSaveFilePicker({
        suggestedName: arquivo.filename,
        types: [{ description: 'Documento PDF', accept: { 'application/pdf': ['.pdf'] } }],
        excludeAcceptAllOption: true
      });
    } catch (error) {
      if (error?.name === 'AbortError') return;
      console.warn('Seletor de arquivos indisponível; será usado o download padrão.', error);
    }
  }

  if (!seletor) {
    baixarPDF(arquivo.blob, arquivo.filename);
    mostrarToast('PDF baixado. A pasta de destino segue a configuração de downloads do navegador.', 'success');
    return;
  }

  try {
    const handle = await seletor;
    const gravador = await handle.createWritable();
    await gravador.write(arquivo.blob);
    await gravador.close();
    mostrarToast('PDF salvo no local escolhido.', 'success');
  } catch (error) {
    if (error?.name === 'AbortError') return;
    console.warn('Não foi possível usar o seletor de destino; usando download padrão.', error);
    baixarPDF(arquivo.blob, arquivo.filename);
    mostrarToast('O navegador não permitiu escolher a pasta. O PDF foi baixado pelo método padrão.', 'success');
  }
}

function compartilharPDFPreparado(scope) {
  const arquivo = obterPDFPreparado(scope);
  if (!arquivo?.blob) {
    mostrarToast('Prepare o PDF antes de compartilhar.', 'error');
    return;
  }
  const file = new File([arquivo.blob], arquivo.filename, { type: 'application/pdf' });

  // navigator.share é chamado sem await anterior, preservando o gesto do usuário.
  if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      const promessa = navigator.share({ files: [file], title: 'Relatório da Cantina da Escola', text: 'Relatório financeiro da Cantina da Escola.' });
      promessa.then(() => mostrarToast('PDF compartilhado.', 'success'))
        .catch((error) => {
          if (error?.name !== 'AbortError') {
            console.warn('Compartilhamento cancelado ou indisponível:', error);
            baixarPDF(arquivo.blob, arquivo.filename);
            mostrarToast('Não foi possível compartilhar diretamente. O PDF foi baixado para compartilhamento manual.', 'success');
          }
        });
      return;
    } catch (error) {
      console.warn('Compartilhamento nativo indisponível:', error);
    }
  }

  baixarPDF(arquivo.blob, arquivo.filename);
  mostrarToast('Este navegador não compartilha arquivos PDF diretamente. O arquivo foi baixado para você compartilhá-lo pelo aparelho.', 'success');
}

async function prepararRelatorioDiarioPDF() {
  if (!navigator.onLine) throw new Error('Conecte-se à internet para buscar o relatório atualizado.');
  const campoData = document.getElementById('report-date');
  const data = campoData?.value || state.status?.data;
  if (!data || !/^\d{4}-\d{2}-\d{2}$/.test(data)) throw new Error('Selecione uma data válida para o relatório.');

  setBusy(true);
  try {
    const relatorio = await consultarRelatorioGestao(state.sessao.token, data);
    state.pdfDiario = { ...(await criarRelatorioPDF(relatorio)), data };
    const host = document.getElementById('daily-pdf-actions');
    if (host) host.innerHTML = renderAcoesPDF('daily', `Relatório diário de ${dataPtCurta(data)} pronto.`);
    mostrarToast('Relatório diário preparado. Escolha salvar ou compartilhar.', 'success');
  } finally {
    setBusy(false);
  }
}

async function consultarHistoricoPeriodo() {
  if (!navigator.onLine) throw new Error('Conecte-se à internet para consultar os fechamentos.');
  if (state.historicoConsultaEmCurso) return;

  const inicio = document.getElementById('history-start')?.value || state.historicoInicio;
  const fim = document.getElementById('history-end')?.value || state.historicoFim;
  if (!inicio || !fim) throw new Error('Informe as duas datas do período.');
  if (inicio > fim) throw new Error('A data inicial não pode ser posterior à data final.');

  state.historicoConsultaEmCurso = true;
  setBusy(true);
  try {
    state.historicoInicio = inicio;
    state.historicoFim = fim;
    state.historico = await consultarHistoricoFechamentos(state.sessao.token, inicio, fim);
    state.fechamentoSelecionado = null;
    state.relatorioFechamentoSelecionado = null;
    state.pdfPeriodo = null;
    state.pdfFechamento = null;
    await renderDashboard();
    const quantidade = Number(state.historico.quantidadeEncontrada ?? state.historico.fechamentos?.length ?? 0);
    mostrarToast(
      quantidade
        ? `${quantidade} fechamento(s) encontrado(s), da data inicial à data final.`
        : `Nenhum fechamento encontrado entre ${dataPtCurta(inicio)} e ${dataPtCurta(fim)}.`,
      quantidade ? 'success' : ''
    );
  } finally {
    state.historicoConsultaEmCurso = false;
    setBusy(false);
  }
}

async function selecionarFechamentoHistorico(id, data) {
  if (!navigator.onLine) throw new Error('Conecte-se à internet para carregar o detalhe do fechamento.');
  const fechamento = (state.historico?.fechamentos || []).find((item) => item.id === id);
  if (!fechamento) throw new Error('O fechamento selecionado não está mais na consulta.');

  setBusy(true);
  try {
    const relatorio = await consultarRelatorioGestao(state.sessao.token, data);
    state.fechamentoSelecionado = fechamento;
    state.relatorioFechamentoSelecionado = relatorio;
    state.pdfFechamento = await criarRelatorioPDF(relatorio);
    await renderDashboard();
    document.getElementById('history-selected-detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } finally {
    setBusy(false);
  }
}

async function prepararPDFPeriodo() {
  if (!state.historico) throw new Error('Consulte um período antes de preparar o PDF.');
  setBusy(true);
  try {
    state.pdfPeriodo = await criarRelatorioPeriodoPDF(state.historico);
    const host = document.getElementById('history-period-pdf-actions');
    if (host) host.innerHTML = renderAcoesPDF('period', 'Relatório consolidado pronto.');
    mostrarToast('Relatório consolidado preparado.', 'success');
  } finally {
    setBusy(false);
  }
}

async function renderDashboard() {
  const sessao = state.sessao;
  const status = state.status;
  const pendentes = await quantidadePendente();
  const online = navigator.onLine;
  const cacheTime = status?.cacheAtualizadoEm;
  let cacheWarning = '';
  if (!online) {
    cacheWarning = `<div class="notice warning" style="margin-bottom:16px"><div><strong>Sem conexão com a internet</strong>${cacheTime ? `Exibindo os dados da última consulta, feita às ${escapeHtml(new Date(cacheTime).toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'}))}. Novos lançamentos ficarão guardados neste aparelho até a conexão voltar.` : 'Este aparelho ainda não carregou o caixa. Conecte-se à internet antes de abrir ou movimentar o caixa.'}</div></div>`;
  } else if (state.statusError) {
    cacheWarning = `<div class="notice warning" style="margin-bottom:16px"><div><strong>Não foi possível atualizar o caixa</strong>Os dados abaixo podem estar desatualizados. Detalhe: ${escapeHtml(state.statusError)}</div></div>`;
  }

  const openPanel = !status?.aberturaRealizada && !status?.fechado
    ? `<section class="panel"><div class="panel-head"><div><p class="eyebrow">Início do expediente</p><h2>Abrir o caixa</h2><p class="subtle">A abertura pode ser feita com R$ 0,00. O fundo para troco pode ser registrado como entrada.</p></div></div>
        <form id="opening-form" class="form-stack"><div class="field"><label for="opening-value">Dinheiro inicial na gaveta</label><input id="opening-value" name="valor" type="text" inputmode="numeric" data-money-input autocomplete="off" value="0,00" placeholder="0,00" required><small>A gaveta começa com R$ 0,00 se não houver dinheiro em espécie. Informe o fundo inicial ou registre-o depois como entrada. Pix não entra no dinheiro da gaveta.</small></div><button class="button button-primary" type="submit" ${!online ? 'disabled' : ''}>Abrir caixa</button></form></section>`
    : '';

  const closedPanel = status?.fechado
    ? `<section class="panel"><div class="notice warning"><div><strong>Caixa fechado</strong>O fechamento de hoje já foi registrado. Novas movimentações estão bloqueadas.</div></div></section>`
    : '';

  const actionPanel = status?.aberto
    ? `<section class="panel">
        <div class="panel-head"><div><p class="eyebrow">Operação do caixa</p><h2>Ações rápidas</h2><p class="subtle">Registre cada venda ou movimentação conforme o recebimento.</p></div></div>
        <div class="action-grid">
          <button class="action-tile" type="button" data-action="sale-pix"><span class="action-icon">P</span><strong>Venda por Pix</strong><small>Pagamento recebido por Pix</small></button>
          <button class="action-tile" type="button" data-action="sale-cash"><span class="action-icon">R$</span><strong>Venda em dinheiro</strong><small>Com cálculo automático de troco</small></button>
          <button class="action-tile" type="button" data-action="entry"><span class="action-icon">＋</span><strong>Entrada</strong><small>Fundo para troco ou reforço</small></button>
          <button class="action-tile" type="button" data-action="exit"><span class="action-icon">−</span><strong>Saída</strong><small>Retirada ou despesa do caixa</small></button>
        </div>
        <div id="operation-form-slot"></div>
      </section>`
    : '';

  let adminPanel = '';
  let adminAnalytics = '';
  if (sessao.perfil === 'ADMIN' && status?.resumo) {
    const r = status.resumo;
    const dataRelatorio = status.data || new Date().toISOString().slice(0, 10);
    adminPanel = `<section class="panel"><div class="panel-head"><div><p class="eyebrow">Visão da gestão</p><h2>Resumo financeiro de hoje</h2></div><button class="button button-outline button-small" type="button" data-action="refresh">Atualizar</button></div>
      <div class="metric-grid">
        ${metric('Total vendido', r.totalVendido, true)}
        ${metric('Vendas em dinheiro', r.dinheiro)}
        ${metric('Vendas por Pix', r.pix)}
        ${metric('Dinheiro que deve estar na gaveta', r.saldoEsperado, true)}
        ${metric('Entradas', r.entradas)}
        ${metric('Saídas', r.saidas)}
      </div>
      <div class="cash-balance-help">
        <strong>O que esse valor representa?</strong>
        <p>É quanto dinheiro em papel e moeda deve estar na gaveta agora. Considera o dinheiro inicial + entradas + vendas em dinheiro − saídas. <strong>Não inclui pagamentos por Pix.</strong></p>
        ${Number(r.saldoEsperado || 0) === 0 ? '<p class="cash-balance-zero">O dinheiro na gaveta está começando em R$ 0,00. O valor aumenta quando você registra um fundo para troco, outra entrada ou uma venda em dinheiro.</p>' : ''}
      </div>
      <div class="admin-tools"><button class="button button-dark" type="button" data-action="close-cash" ${status.fechado || !online || pendentes ? 'disabled' : ''}>Fechar caixa</button><button class="button button-outline" type="button" data-action="pin-tools">Alterar PINs</button></div>
      <div class="report-controls">
        <div class="field"><label for="report-date">Data do relatório</label><input id="report-date" type="date" value="${escapeHtml(dataRelatorio)}" max="${escapeHtml(dataRelatorio)}"></div>
        <button class="button button-primary" type="button" data-action="report-pdf" ${!online ? 'disabled' : ''}>Preparar PDF diário</button>
      </div>
      <div id="daily-pdf-actions">${state.pdfDiario?.data === dataRelatorio ? renderAcoesPDF('daily', `Relatório diário de ${dataPtCurta(state.pdfDiario.data)} pronto.`) : ''}</div>
      <p class="subtle" style="margin:9px 0 0">Depois de preparar, escolha “Salvar PDF” ou “Compartilhar PDF”.</p>
      <div id="admin-form-slot"></div>
      ${pendentes ? '<p class="subtle" style="margin:12px 0 0">O fechamento ficará disponível depois que todas as movimentações forem sincronizadas.</p>' : ''}
    </section>`;
    adminAnalytics = renderAnalytics(status.indicadores || {});
  }

  const movements = status?.movimentacoes || [];
  const refreshTime = state.ultimaConsulta ? new Date(state.ultimaConsulta).toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'}) : '—';

  destruirGraficosHistorico();
  root.innerHTML = `
    <div class="dashboard-head">
      <div><p class="eyebrow">Painel da cantina</p><h1>Olá, ${escapeHtml(sessao.nome.split(' ')[0])}!</h1><div class="dashboard-meta"><span>${escapeHtml(dataHojePt())}</span><span>Acesso: ${sessao.perfil === 'ADMIN' ? 'Gestão' : 'Operadora'}</span></div></div>
      <div>${statusLabel(status)}<p class="subtle" style="text-align:right;margin:8px 0 0;font-size:11px">Atualizado às ${refreshTime}</p></div>
    </div>
    ${cacheWarning}
    ${pendentes ? `<div class="notice warning" style="margin-bottom:16px"><div><strong>${pendentes} movimentação(ões) pendente(s)</strong>Não feche o caixa enquanto houver movimentações aguardando sincronização.</div></div>` : ''}
    ${openPanel}
    ${closedPanel}
    ${actionPanel}
    ${adminPanel}
    ${adminAnalytics}
    ${sessao.perfil === 'ADMIN' ? renderHistoricoFechamentos() : ''}
    <section class="panel"><div class="panel-head"><div><p class="eyebrow">Registro compartilhado</p><h2>Movimentações de hoje</h2><p class="subtle">Últimos lançamentos confirmados no servidor.</p></div><button class="button button-outline button-small" type="button" data-action="refresh">Atualizar</button></div>
      ${renderMovements(movements)}
    </section>
    ${pendentes ? await renderPendingPanel() : ''}`;

  logoutButton.classList.remove('hidden');
  atualizarBotaoInstalacao();
  if (sessao.perfil === 'ADMIN' && state.historico) montarGraficosHistorico(state.historico);

  // Ao entrar na Gestão, consulta automaticamente os fechamentos do período padrão.
  // A flag evita chamadas repetidas em cada atualização do painel.
  if (
    sessao.perfil === 'ADMIN' &&
    navigator.onLine &&
    !state.historico &&
    !state.historicoAutoIniciado
  ) {
    state.historicoAutoIniciado = true;
    Promise.resolve().then(() => consultarHistoricoPeriodo()).catch((error) => {
      state.historicoAutoIniciado = false;
      mostrarToast(`Não foi possível carregar o histórico de fechamentos: ${error.message}`, 'error');
    });
  }
}

async function atualizarStatus({ silencioso = false } = {}) {
  if (!state.sessao) return;
  if (!navigator.onLine) {
    const cached = obterStatusCache();
    if (cached) {
      state.status = cached;
      state.ultimaConsulta = cached.cacheAtualizadoEm || null;
    }
    await renderDashboard();
    return;
  }

  try {
    const status = await consultarStatus(state.sessao.token);
    state.status = status;
    state.statusError = null;
    state.ultimaConsulta = Date.now();
    salvarStatusCache(status);
    await renderDashboard();
  } catch (error) {
    if (/sessão expirada|entre novamente|sessão não identificada/i.test(error.message)) {
      sair();
      state.sessao = null;
      state.status = null;
      state.historico = null;
      state.historicoAutoIniciado = false;
      state.historicoConsultaEmCurso = false;
      renderLogin('Sua sessão expirou. Entre novamente; as movimentações pendentes continuam guardadas neste aparelho.');
      return;
    }
    const cached = obterStatusCache();
    state.statusError = error.message || 'Falha de comunicação com o servidor.';
    logoutButton.classList.remove('hidden');

    if (cached) {
      state.status = cached;
      state.ultimaConsulta = cached.cacheAtualizadoEm || null;
      await renderDashboard();
    } else {
      state.status = null;
      const versaoAntiga = /operação não reconhecida/i.test(state.statusError);
      const orientacao = versaoAntiga
        ? 'O Web App publicado ainda não reconhece a consulta do caixa. Atualize o Code.gs na cópia de homologação e publique uma Nova versão da implantação.'
        : 'Confira se o endereço /exec configurado pertence à cópia de homologação e se a implantação dessa cópia está atualizada.';
      root.innerHTML = `<section class="panel"><div class="notice warning"><div><strong>O login funcionou, mas não foi possível carregar o caixa</strong>${escapeHtml(orientacao)}</div></div><div class="diagnostic-box"><strong>Detalhe recebido do servidor</strong><code>${escapeHtml(state.statusError)}</code></div><p class="subtle">Você pode tentar novamente ou sair e voltar para a tela de acesso. Nenhuma venda foi registrada por esta consulta.</p><div class="form-actions"><button class="button button-primary" type="button" id="retry-status">Tentar novamente</button><button class="button button-outline" type="button" data-action="logout">Sair e voltar ao login</button></div></section>`;
    }
    if (!silencioso) mostrarToast(error.message, 'error');
  }
}

async function sincronizarEAtualizar() {
  if (!navigator.onLine) {
    mostrarToast('Sem internet. As movimentações continuam salvas neste aparelho.', 'error');
    return;
  }
  setBusy(true);
  try {
    const resultado = await sincronizarFila();
    await atualizarStatus({ silencioso: true });
    mostrarToast(`${resultado.sincronizadas} sincronizada(s); ${resultado.pendentes} pendente(s).`, resultado.pendentes ? '' : 'success');
  } catch (error) {
    mostrarToast(error.message, 'error');
  } finally {
    setBusy(false);
  }
}

function mostrarFormularioOperacao(tipo) {
  const slot = document.getElementById('operation-form-slot');
  if (!slot) return;

  const isSalePix = tipo === 'sale-pix';
  const isSaleCash = tipo === 'sale-cash';
  const isEntry = tipo === 'entry';
  const titulo = isSalePix ? 'Registrar venda por Pix'
    : isSaleCash ? 'Registrar venda em dinheiro'
    : isEntry ? 'Registrar entrada de dinheiro' : 'Registrar saída de dinheiro';

  slot.innerHTML = `<div class="panel form-panel"><div class="panel-head"><div><h3>${titulo}</h3><p class="subtle">${isSaleCash ? 'Informe o total da compra e o dinheiro entregue. O troco será calculado automaticamente.' : isSalePix ? 'Informe o total da compra pago por Pix.' : 'Informe o valor e o motivo da movimentação.'}</p></div></div>
    <form id="movement-form" data-kind="${tipo}" class="form-stack">
      <div class="inline-fields">
        <div class="field"><label for="movement-value">${isEntry ? 'Valor da entrada' : isSaleCash || isSalePix ? 'Total da compra' : 'Valor da saída'}</label><input id="movement-value" name="valor" type="text" inputmode="numeric" data-money-input autocomplete="off" placeholder="0,00" required>${isSaleCash || isSalePix ? '<small>Some os produtos e informe o preço final da compra.</small>' : ''}</div>
        ${isSaleCash ? '<div class="field"><label for="movement-received">Quanto a pessoa entregou?</label><input id="movement-received" name="recebido" type="text" inputmode="numeric" data-money-input autocomplete="off" placeholder="0,00" required><small>Digite quanto a pessoa deu em dinheiro para pagar.</small></div>' : ''}
      </div>
      ${isEntry || (!isSaleCash && !isSalePix) ? '<div class="field"><label for="movement-note">Motivo</label><input id="movement-note" name="observacao" maxlength="180" placeholder="Ex.: fundo para troco" required></div>' : ''}
      <div id="change-preview" class="notice hidden"></div>
      <div class="form-actions"><button class="button button-primary" type="submit">${isSaleCash || isSalePix ? 'Confirmar venda' : 'Registrar movimentação'}</button><button class="button button-outline" type="button" data-action="cancel-operation">Cancelar</button></div>
    </form></div>`;

  const valueInput = document.getElementById('movement-value');
  const receivedInput = document.getElementById('movement-received');
  const preview = document.getElementById('change-preview');
  if (receivedInput) {
    const updateChange = () => {
      const value = parseMoneyToCents(valueInput.value);
      const received = parseMoneyToCents(receivedInput.value);
      if (Number.isFinite(value) && Number.isFinite(received) && received >= value) {
        preview.classList.remove('hidden');
        preview.innerHTML = `<div><strong>Troco a devolver: ${formatarMoeda((received - value) / 100)}</strong>O servidor ainda validará se há dinheiro suficiente na gaveta.</div>`;
      } else {
        preview.classList.add('hidden');
      }
    };
    valueInput.addEventListener('input', updateChange);
    receivedInput.addEventListener('input', updateChange);
  }
  valueInput.focus();
}

function mostrarFormularioFechamento() {
  const slot = document.getElementById('admin-form-slot');
  if (!slot) return;
  const esperado = state.status?.resumo?.saldoEsperado ?? 0;
  slot.innerHTML = `<div class="panel form-panel"><div class="panel-head"><div><h3>Conferir e fechar o caixa</h3><p class="subtle">Dinheiro que deve estar na gaveta: <strong>${formatarMoeda(esperado)}</strong>. Conte somente as notas e moedas; pagamentos por Pix não entram nessa conferência.</p></div></div>
    <form id="close-form" class="form-stack"><div class="field"><label for="counted-value">Dinheiro contado na gaveta</label><input id="counted-value" name="contado" type="text" inputmode="numeric" data-money-input autocomplete="off" placeholder="0,00" required></div>
    <div class="field"><label for="close-note">Observação (opcional)</label><input id="close-note" name="observacao" maxlength="180" placeholder="Observação do fechamento"></div>
    <div class="notice warning"><div><strong>Confirmação de sincronização</strong>O fechamento só será permitido depois de sincronizar todas as movimentações pendentes.</div></div>
    <div class="form-actions"><button class="button button-primary" type="submit" ${!navigator.onLine ? 'disabled' : ''}>Confirmar fechamento</button><button class="button button-outline" type="button" data-action="cancel-admin">Cancelar</button></div></form></div>`;
}

function mostrarFormularioPins() {
  const slot = document.getElementById('admin-form-slot');
  if (!slot) return;
  slot.innerHTML = `<div class="panel form-panel"><div class="panel-head"><div><h3>Alterar PIN compartilhado</h3><p class="subtle">Os PINs têm quatro números e precisam ser diferentes.</p></div></div>
    <form id="pin-form" class="form-stack"><div class="field"><label for="pin-type">PIN que será alterado</label><select id="pin-type" name="tipo"><option value="OPERADORA">Operadoras</option><option value="ADMIN">Gestão</option></select></div>
    <div class="field"><label for="new-pin">Novo PIN</label><input id="new-pin" class="pin-input" name="pin" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" required></div>
    <div class="form-actions"><button class="button button-primary" type="submit">Salvar novo PIN</button><button class="button button-outline" type="button" data-action="cancel-admin">Cancelar</button></div></form></div>`;
}

async function tratarLogin(form) {
  const formData = new FormData(form);
  const nome = String(formData.get('nome') || '').trim();
  const pin = String(formData.get('pin') || '').trim();
  const lembrarNesteAparelho = formData.get('lembrarLogin') === 'on';
  if (!/^\d{4}$/.test(pin)) throw new Error('Digite um PIN de quatro números.');
  if (state.perfilLogin === 'OPERADORA' && nome.length < 2) throw new Error('Informe seu nome.');

  setBusy(true);
  try {
    state.sessao = await entrar({ perfil: state.perfilLogin, nome, pin, lembrarNesteAparelho });
    state.statusError = null;
    logoutButton.classList.remove('hidden');
    const pending = await quantidadePendente();
    if (pending && navigator.onLine) {
      try { await sincronizarFila(); } catch (error) { /* a fila é preservada se a sessão/conexão falhar */ }
    }
    await atualizarStatus();
  } finally {
    setBusy(false);
  }
}

async function tratarAbertura(form) {
  if (!navigator.onLine) throw new Error('A abertura do caixa exige conexão com a internet.');
  const value = parseMoneyToCents(new FormData(form).get('valor'));
  if (!Number.isSafeInteger(value)) throw new Error('Informe um valor inicial válido.');
  setBusy(true);
  try {
    await abrirCaixa(state.sessao.token, value);
    mostrarToast('Caixa aberto com sucesso.', 'success');
    await atualizarStatus({ silencioso: true });
  } finally { setBusy(false); }
}

async function tratarMovimentacao(form) {
  const formData = new FormData(form);
  const kind = form.dataset.kind;
  const valor = parseMoneyToCents(formData.get('valor'));
  if (!Number.isSafeInteger(valor) || valor <= 0) throw new Error('Informe um valor maior que zero.');

  setBusy(true);
  try {
    let result;
    if (kind === 'sale-pix') {
      result = await registrarVenda({ token: state.sessao.token, forma: 'PIX', valorCentavos: valor });
    } else if (kind === 'sale-cash') {
      const recebido = parseMoneyToCents(formData.get('recebido'));
      if (!Number.isSafeInteger(recebido) || recebido < valor) throw new Error('O valor recebido deve ser igual ou maior que o valor da venda.');
      result = await registrarVenda({ token: state.sessao.token, forma: 'DINHEIRO', valorCentavos: valor, recebidoCentavos: recebido });
    } else {
      const tipo = kind === 'entry' ? 'ENTRADA' : 'SAIDA';
      const observacao = String(formData.get('observacao') || '').trim();
      if (observacao.length < 2) throw new Error('Informe o motivo da movimentação.');
      result = await registrarAjuste({ token: state.sessao.token, tipo, valorCentavos: valor, observacao });
    }

    if (result.pendente) {
      mostrarToast('Movimentação salva neste aparelho e aguardando sincronização. Não registre novamente.', 'success');
    } else {
      mostrarToast('Movimentação registrada com sucesso.', 'success');
    }
    await atualizarStatus({ silencioso: true });
  } finally { setBusy(false); }
}

async function tratarFechamento(form) {
  if (!navigator.onLine) throw new Error('O fechamento exige conexão com a internet.');
  setBusy(true);
  try {
    const sync = await sincronizarFila();
    if (sync.pendentes > 0) {
      throw new Error(`Ainda existem ${sync.pendentes} movimentação(ões) pendente(s). Resolva a sincronização antes do fechamento.`);
    }
    const formData = new FormData(form);
    const contado = parseMoneyToCents(formData.get('contado'));
    if (!Number.isSafeInteger(contado)) throw new Error('Informe o dinheiro contado corretamente.');
    const resultado = await fecharCaixa({
      token: state.sessao.token,
      dinheiroContadoCentavos: contado,
      confirmouSincronizacao: true,
      observacao: String(formData.get('observacao') || '').trim()
    });
    mostrarToast(`Caixa fechado: ${resultado.status}. Diferença: ${formatarMoeda(resultado.diferenca)}.`, resultado.status === 'CONFERIDO' ? 'success' : '');
    await atualizarStatus({ silencioso: true });
  } finally { setBusy(false); }
}

async function tratarAlteracaoPin(form) {
  const data = new FormData(form);
  const novoPin = String(data.get('pin') || '');
  if (!/^\d{4}$/.test(novoPin)) throw new Error('O novo PIN precisa ter quatro números.');
  setBusy(true);
  try {
    await alterarPin({ token: state.sessao.token, tipo: data.get('tipo'), novoPin });
    mostrarToast('PIN alterado com sucesso.', 'success');
    form.reset();
  } finally { setBusy(false); }
}

async function executarLogout() {
  const pendentes = await quantidadePendente().catch(() => 0);
  if (pendentes > 0) {
    const confirmar = window.confirm(
      `Há ${pendentes} movimentação(ões) aguardando envio. Elas continuarão guardadas neste aparelho e poderão ser sincronizadas depois que alguém entrar novamente. Deseja sair?`
    );
    if (!confirmar) return;
  }

  sair();
  localStorage.removeItem(STORAGE_STATUS);
  state.sessao = null;
  state.status = null;
  state.statusError = null;
  state.ultimaConsulta = null;
  state.historico = null;
  state.historicoAutoIniciado = false;
  state.historicoConsultaEmCurso = false;
  state.fechamentoSelecionado = null;
  state.relatorioFechamentoSelecionado = null;
  state.pdfDiario = null;
  state.pdfPeriodo = null;
  state.pdfFechamento = null;
  destruirGraficosHistorico();
  logoutButton.classList.add('hidden');
  renderLogin(pendentes > 0
    ? `${pendentes} movimentação(ões) continuam salvas neste aparelho. Entre novamente para sincronizá-las.`
    : 'Você saiu do sistema.');
}

root.addEventListener('click', async (event) => {
  const roleButton = event.target.closest('[data-role]');
  if (roleButton) {
    state.perfilLogin = roleButton.dataset.role;
    renderLogin();
    return;
  }

  const button = event.target.closest('[data-action]');
  if (!button) return;
  const action = button.dataset.action;

  try {
    if (action === 'logout') {
      await executarLogout();
    } else if (action === 'share-app') {
      await mostrarModalCompartilharApp();
    } else if (action === 'report-pdf') {
      await prepararRelatorioDiarioPDF();
    } else if (action === 'history-search') {
      await consultarHistoricoPeriodo();
    } else if (action === 'history-detail') {
      await selecionarFechamentoHistorico(button.dataset.closeId, button.dataset.closeDate);
    } else if (action === 'history-clear-detail') {
      state.fechamentoSelecionado = null;
      state.relatorioFechamentoSelecionado = null;
      state.pdfFechamento = null;
      await renderDashboard();
    } else if (action === 'prepare-period-pdf') {
      await prepararPDFPeriodo();
    } else if (action === 'save-pdf') {
      await salvarPDFPreparado(button.dataset.pdfScope);
    } else if (action === 'share-pdf') {
      compartilharPDFPreparado(button.dataset.pdfScope);
    } else if (action === 'sale-pix' || action === 'sale-cash' || action === 'entry' || action === 'exit') {
      mostrarFormularioOperacao(action);
    } else if (action === 'cancel-operation') {
      document.getElementById('operation-form-slot').innerHTML = '';
    } else if (action === 'retry-status' || action === 'refresh') {
      await atualizarStatus();
    } else if (action === 'sync') {
      await sincronizarEAtualizar();
    } else if (action === 'close-cash') {
      if (await quantidadePendente()) throw new Error('Sincronize todas as movimentações antes de fechar o caixa.');
      mostrarFormularioFechamento();
    } else if (action === 'pin-tools') {
      mostrarFormularioPins();
    } else if (action === 'cancel-admin') {
      document.getElementById('admin-form-slot').innerHTML = '';
    }
  } catch (error) {
    mostrarToast(error.message, 'error');
  }
});


root.addEventListener('change', (event) => {
  if (event.target?.id === 'report-date') {
    state.pdfDiario = null;
    const host = document.getElementById('daily-pdf-actions');
    if (host) host.innerHTML = '';
  }

  if (event.target?.id === 'history-start' || event.target?.id === 'history-end') {
    state.historicoInicio = document.getElementById('history-start')?.value || state.historicoInicio;
    state.historicoFim = document.getElementById('history-end')?.value || state.historicoFim;
    state.historico = null;
    state.fechamentoSelecionado = null;
    state.relatorioFechamentoSelecionado = null;
    state.pdfPeriodo = null;
    state.pdfFechamento = null;
    destruirGraficosHistorico();
    const host = document.getElementById('history-results');
    if (host) host.innerHTML = '<div class="empty-state">Período alterado. Toque em “Consultar fechamentos” para atualizar os resultados.</div>';
  }
});

root.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.target;
  try {
    if (form.id === 'login-form') await tratarLogin(form);
    else if (form.id === 'opening-form') await tratarAbertura(form);
    else if (form.id === 'movement-form') await tratarMovimentacao(form);
    else if (form.id === 'close-form') await tratarFechamento(form);
    else if (form.id === 'pin-form') await tratarAlteracaoPin(form);
  } catch (error) {
    mostrarToast(error.message || 'Não foi possível concluir a operação.', 'error');
  }
});

logoutButton.addEventListener('click', executarLogout);

// Captura o clique em fase de captura para que nenhum manipulador da página
// impeça a abertura do guia no iPhone/iPad. Não usa preventDefault nem bloqueia
// a propagação do evento de clique.
document.addEventListener('click', async (event) => {
  const button = event.target?.closest?.('#install-button');
  if (!button) return;

  if (estaInstalado()) {
    atualizarBotaoInstalacao();
    return;
  }

  if (podeMostrarAjudaIOS()) {
    mostrarAjudaInstalacao();
    return;
  }

  if (podeInstalar()) {
    try {
      const installed = await instalarAplicativo();
      if (installed) mostrarToast('Aplicativo instalado.', 'success');
      else mostrarAjudaInstalacaoNaoIOS();
    } catch (error) {
      mostrarToast(error.message || 'Não foi possível abrir a instalação automática.', 'error');
      mostrarAjudaInstalacaoNaoIOS();
    }
  } else {
    mostrarAjudaInstalacaoNaoIOS();
  }

  atualizarBotaoInstalacao();
}, true);

document.addEventListener('cantina:instalavel', atualizarBotaoInstalacao);
document.addEventListener('cantina:instalacao-atualizada', atualizarBotaoInstalacao);
document.addEventListener('cantina:instalado', atualizarBotaoInstalacao);
appDialog.addEventListener('click', (event) => {
  if (event.target.closest('[data-dialog-close]')) fecharDialogo();
});
appDialog.addEventListener('click', (event) => {
  if (event.target === appDialog) fecharDialogo();
});

window.addEventListener('online', async () => {
  definirConexao();
  if (state.sessao) await sincronizarEAtualizar();
});
window.addEventListener('offline', async () => {
  definirConexao();
  if (state.sessao) await atualizarStatus({ silencioso: true });
});

async function iniciar() {
  const splash = document.getElementById('splash-screen');
  const splashMinimo = new Promise((resolve) => window.setTimeout(() => {
    splash?.classList.add('is-hidden');
    window.setTimeout(() => splash?.remove(), 380);
    resolve();
  }, 1800));
  try {
    document.getElementById('year').textContent = new Date().getFullYear();
    definirConexao();
    atualizarBotaoInstalacao();

    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
      try { await navigator.serviceWorker.register('./sw.js'); }
      catch (error) { console.warn('Service Worker não foi registrado:', error); }
    }

    state.sessao = sessaoAtual();
    if (!state.sessao) {
      renderLogin();
      return;
    }

    logoutButton.classList.remove('hidden');
    state.status = obterStatusCache();
    if (state.status) {
      await renderDashboard();
    }
    if (!navigator.onLine && !state.status) {
      root.innerHTML = '<section class="panel"><div class="notice warning"><div><strong>Sem conexão e sem dados do caixa neste aparelho</strong>Conecte-se à internet para carregar o caixa compartilhado pela primeira vez.</div></div><div class="form-actions"><button class="button button-outline" id="retry-status" type="button">Tentar novamente</button><button class="button button-outline" type="button" data-action="logout">Sair e voltar ao login</button></div></section>';
      document.getElementById('retry-status').addEventListener('click', () => atualizarStatus());
      return;
    }

    if (navigator.onLine) {
      await atualizarStatus({ silencioso: true });
      const pendentes = await quantidadePendente();
      if (pendentes) await sincronizarEAtualizar();
    } else {
      await renderDashboard();
    }
  } finally {
    await splashMinimo;
  }
}
iniciar().catch((error) => {
  console.error(error);
  renderLogin(error.message || 'Não foi possível iniciar o aplicativo.');
});
