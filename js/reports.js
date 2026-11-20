export function formatarMoeda(valor) {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL'
  }).format(Number(valor || 0));
}

export function formatarDataHora(valor) {
  if (!valor) return '—';
  const data = new Date(valor);
  if (Number.isNaN(data.getTime())) return String(valor);
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit', month: '2-digit',
    hour: '2-digit', minute: '2-digit'
  }).format(data);
}

export function formatarTipo(tipo) {
  const nomes = {
    ABERTURA: 'Abertura',
    VENDA: 'Venda',
    ENTRADA: 'Entrada',
    SAIDA: 'Saída'
  };
  return nomes[tipo] || tipo || 'Movimentação';
}
