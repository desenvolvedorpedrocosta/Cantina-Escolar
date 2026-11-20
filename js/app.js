import { entrar, sessaoAtual, sair } from './auth.js';
import { abrirCaixa, registrarVenda, registrarAjuste, parseMoneyToCents } from './cash.js';
import { consultarStatus, fecharCaixa, alterarPin } from './admin.js';
import { formatarMoeda, formatarDataHora, formatarTipo } from './reports.js';
import { sincronizarFila, quantidadePendente, detalhesFila } from './offline.js';
import { obterSessao } from './storage.js';
import { urlConfigurada } from './api.js';
import { instalarAplicativo, podeInstalar } from './install.js';

const root = document.getElementById('app-root');
const connection = document.getElementById('connection-status');
const logoutButton = document.getElementById('logout-button');
const installButton = document.getElementById('install-button');
const toastRegion = document.getElementById('toast-region');

const state = {
  perfilLogin: 'OPERADORA',
  sessao: null,
  status: null,
  ultimaConsulta: null,
  busy: false,
  statusError: null
};

const STORAGE_STATUS = 'cantina_status_cache';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[char]);
}

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

function renderLogin(message = '') {
  logoutButton.classList.add('hidden');
  root.innerHTML = `
    <section class="login-wrap">
      <div class="login-card">
        <h1>Bem-vindo à cantina</h1>
        <p class="subtle">Entre para registrar as movimentações e acompanhar o caixa do dia.</p>
        ${message ? `<div class="notice warning" style="margin-top:16px">${escapeHtml(message)}</div>` : ''}
        ${!urlConfigurada() ? '<div class="notice error" style="margin-top:16px"><strong>Configuração necessária</strong>Informe o endereço do Web App no arquivo <code>js/config.js</code> antes de publicar.</div>' : ''}
        <div class="role-switch" role="group" aria-label="Tipo de acesso">
          <button type="button" data-role="OPERADORA" class="${state.perfilLogin === 'OPERADORA' ? 'active' : ''}">Operadora</button>
          <button type="button" data-role="ADMIN" class="${state.perfilLogin === 'ADMIN' ? 'active' : ''}">Gestão</button>
        </div>
        <form id="login-form" class="form-stack">
          ${state.perfilLogin === 'OPERADORA' ? '<div class="field"><label for="login-name">Seu nome</label><input id="login-name" name="nome" type="text" maxlength="60" autocomplete="name" placeholder="Digite seu nome" required></div>' : '<div class="notice">Acesso administrativo com o PIN compartilhado da gestão.</div>'}
          <div class="field"><label for="login-pin">PIN de 4 números</label><input id="login-pin" name="pin" class="pin-input" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="current-password" placeholder="••••" required></div>
          <button class="button button-primary button-block" type="submit" ${!urlConfigurada() ? 'disabled' : ''}>Entrar no sistema</button>
        </form>
        <p class="subtle" style="margin:17px 0 0;font-size:11px">As movimentações pendentes ficam armazenadas neste aparelho até a sincronização.</p>
      </div>
    </section>`;
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
        <form id="opening-form" class="form-stack"><div class="field"><label for="opening-value">Dinheiro inicial na gaveta</label><input id="opening-value" name="valor" inputmode="decimal" value="0,00" required><small>Informe o valor físico disponível no início. Use 0,00 quando não houver fundo.</small></div><button class="button button-primary" type="submit" ${!online ? 'disabled' : ''}>Abrir caixa</button></form></section>`
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
  if (sessao.perfil === 'ADMIN' && status?.resumo) {
    const r = status.resumo;
    adminPanel = `<section class="panel"><div class="panel-head"><div><p class="eyebrow">Visão da gestão</p><h2>Resumo financeiro de hoje</h2></div><button class="button button-outline button-small" type="button" data-action="refresh">Atualizar</button></div>
      <div class="metric-grid">
        ${metric('Total vendido', r.totalVendido, true)}
        ${metric('Vendas em dinheiro', r.dinheiro)}
        ${metric('Vendas por Pix', r.pix)}
        ${metric('Saldo esperado na gaveta', r.saldoEsperado, true)}
        ${metric('Entradas', r.entradas)}
        ${metric('Saídas', r.saidas)}
      </div>
      <div class="admin-tools"><button class="button button-dark" type="button" data-action="close-cash" ${status.fechado || !online || pendentes ? 'disabled' : ''}>Fechar caixa</button><button class="button button-outline" type="button" data-action="pin-tools">Alterar PINs</button></div>
      <div id="admin-form-slot"></div>
      ${pendentes ? '<p class="subtle" style="margin:12px 0 0">O fechamento ficará disponível depois que todas as movimentações forem sincronizadas.</p>' : ''}
    </section>`;
  }

  const movements = status?.movimentacoes || [];
  const refreshTime = state.ultimaConsulta ? new Date(state.ultimaConsulta).toLocaleTimeString('pt-BR', {hour:'2-digit',minute:'2-digit'}) : '—';

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
    <section class="panel"><div class="panel-head"><div><p class="eyebrow">Registro compartilhado</p><h2>Movimentações de hoje</h2><p class="subtle">Últimos lançamentos confirmados no servidor.</p></div><button class="button button-outline button-small" type="button" data-action="refresh">Atualizar</button></div>
      ${renderMovements(movements)}
    </section>
    ${pendentes ? await renderPendingPanel() : ''}`;

  logoutButton.classList.remove('hidden');
  if (podeInstalar()) installButton.classList.remove('hidden');
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
        <div class="field"><label for="movement-value">${isEntry ? 'Valor da entrada' : isSaleCash || isSalePix ? 'Total da compra' : 'Valor da saída'}</label><input id="movement-value" name="valor" inputmode="decimal" placeholder="0,00" required>${isSaleCash || isSalePix ? '<small>Some os produtos e informe o preço final da compra.</small>' : ''}</div>
        ${isSaleCash ? '<div class="field"><label for="movement-received">Quanto a pessoa entregou?</label><input id="movement-received" name="recebido" inputmode="decimal" placeholder="0,00" required><small>Digite quanto a pessoa deu em dinheiro para pagar.</small></div>' : ''}
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
  slot.innerHTML = `<div class="panel form-panel"><div class="panel-head"><div><h3>Conferir e fechar o caixa</h3><p class="subtle">Saldo esperado na gaveta: <strong>${formatarMoeda(esperado)}</strong>. Conte o dinheiro físico antes de confirmar.</p></div></div>
    <form id="close-form" class="form-stack"><div class="field"><label for="counted-value">Dinheiro contado na gaveta</label><input id="counted-value" name="contado" inputmode="decimal" placeholder="0,00" required></div>
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
  if (!/^\d{4}$/.test(pin)) throw new Error('Digite um PIN de quatro números.');
  if (state.perfilLogin === 'OPERADORA' && nome.length < 2) throw new Error('Informe seu nome.');

  setBusy(true);
  try {
    state.sessao = await entrar({ perfil: state.perfilLogin, nome, pin });
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

installButton.addEventListener('click', async () => {
  const installed = await instalarAplicativo();
  if (installed) mostrarToast('Aplicativo instalado.', 'success');
});

document.addEventListener('cantina:instalavel', () => installButton.classList.remove('hidden'));

window.addEventListener('online', async () => {
  definirConexao();
  if (state.sessao) await sincronizarEAtualizar();
});
window.addEventListener('offline', async () => {
  definirConexao();
  if (state.sessao) await atualizarStatus({ silencioso: true });
});

async function iniciar() {
  document.getElementById('year').textContent = new Date().getFullYear();
  definirConexao();

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
}

iniciar().catch((error) => {
  console.error(error);
  renderLogin(error.message || 'Não foi possível iniciar o aplicativo.');
});
