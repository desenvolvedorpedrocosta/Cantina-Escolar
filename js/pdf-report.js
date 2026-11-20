function formatarDataRelatorio(data) {
  const partes = String(data || '').split('-');
  return partes.length === 3 ? `${partes[2]}/${partes[1]}/${partes[0]}` : String(data || '');
}

function moedaPdf(valor) {
  return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(valor || 0));
}

function horaPdf(valor) {
  if (!valor) return '—';
  const texto = String(valor);
  const match = texto.match(/T(\d{2}:\d{2})/);
  if (match) return match[1];
  const data = new Date(valor);
  return Number.isNaN(data.getTime()) ? texto : data.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

let pdfLibraryPromise = null;

function carregarScriptPDF(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = src;
    script.onload = resolve;
    script.onerror = () => reject(new Error('Não foi possível carregar a biblioteca de PDF. Verifique a conexão com a internet.'));
    document.head.appendChild(script);
  });
}

async function garantirBibliotecasPDF() {
  if (window.jspdf?.jsPDF && window.jspdf.jsPDF.API?.autoTable) return;
  if (!pdfLibraryPromise) {
    pdfLibraryPromise = (async () => {
      if (!window.jspdf?.jsPDF) {
        await carregarScriptPDF('https://cdn.jsdelivr.net/npm/jspdf@4.2.1/dist/jspdf.umd.min.js');
      }
      if (window.jspdf?.jsPDF && !window.jspdf.jsPDF.API?.autoTable) {
        await carregarScriptPDF('https://cdn.jsdelivr.net/npm/jspdf-autotable@5.0.9/dist/jspdf.plugin.autotable.min.js');
      }
    })().catch((error) => {
      pdfLibraryPromise = null;
      throw error;
    });
  }
  await pdfLibraryPromise;
}

export async function criarRelatorioPDF(relatorio) {
  await garantirBibliotecasPDF();
  const JsPDF = window.jspdf?.jsPDF;
  if (!JsPDF) throw new Error('A biblioteca de PDF não carregou. Verifique a conexão com a internet e tente novamente.');

  const doc = new JsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const resumo = relatorio.resumo || {};
  const indicadores = relatorio.indicadores || {};
  const movimentos = Array.isArray(relatorio.movimentacoes) ? relatorio.movimentacoes : [];
  const dataLabel = formatarDataRelatorio(relatorio.data);
  const largura = doc.internal.pageSize.getWidth();

  doc.setProperties({
    title: `Relatório da Cantina da Escola - ${dataLabel}`,
    subject: 'Resumo financeiro e movimentações da cantina',
    author: 'Cantina da Escola',
    creator: 'Cantina da Escola'
  });

  doc.setFillColor(16, 43, 70);
  doc.rect(0, 0, largura, 35, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(18);
  doc.text('Cantina da Escola', 14, 15);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(10);
  doc.text(`Relatório financeiro diário · ${dataLabel}`, 14, 23);
  doc.text(`Gerado em ${new Date().toLocaleString('pt-BR')}`, 14, 29);

  doc.setTextColor(25, 50, 71);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Resumo financeiro', 14, 45);

  const cards = [
    ['Total vendido', moedaPdf(resumo.totalVendido)],
    ['Dinheiro', moedaPdf(resumo.dinheiro)],
    ['Pix', moedaPdf(resumo.pix)],
    ['Saldo esperado', moedaPdf(resumo.saldoEsperado)],
    ['Entradas', moedaPdf(resumo.entradas)],
    ['Saídas', moedaPdf(resumo.saidas)]
  ];
  const cardW = (largura - 28 - 10) / 3;
  cards.forEach((card, index) => {
    const col = index % 3;
    const row = Math.floor(index / 3);
    const x = 14 + col * (cardW + 5);
    const y = 51 + row * 19;
    doc.setDrawColor(218, 229, 235);
    doc.setFillColor(247, 250, 251);
    doc.roundedRect(x, y, cardW, 15, 2, 2, 'FD');
    doc.setTextColor(102, 120, 135);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.text(card[0], x + 3, y + 5);
    doc.setTextColor(16, 43, 70);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.text(card[1], x + 3, y + 11.5);
  });

  const infoY = 94;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(25, 50, 71);
  doc.text('Indicadores operacionais', 14, infoY);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.text(`Quantidade de vendas: ${Number(indicadores.quantidadeVendas || 0)}`, 14, infoY + 7);
  doc.text(`Valor médio por venda: ${moedaPdf(indicadores.ticketMedio)}`, 82, infoY + 7);
  doc.text(`Movimentações confirmadas: ${Number(indicadores.quantidadeMovimentacoes || movimentos.length)}`, 14, infoY + 13);
  doc.text(`Operadores com vendas: ${Array.isArray(indicadores.operadores) ? indicadores.operadores.length : 0}`, 108, infoY + 13);

  const fechamento = relatorio.fechamento;
  if (fechamento) {
    doc.setFont('helvetica', 'bold');
    doc.text(`Fechamento: ${fechamento.status || 'Registrado'}`, 14, infoY + 21);
    doc.setFont('helvetica', 'normal');
    doc.text(`Dinheiro contado: ${moedaPdf(fechamento.contado)} · Diferença: ${moedaPdf(fechamento.diferenca)}`, 14, infoY + 27);
  } else {
    doc.setFont('helvetica', 'normal');
    doc.text('Fechamento: não registrado para esta data.', 14, infoY + 21);
  }

  const tableStart = fechamento ? infoY + 34 : infoY + 28;
  const body = movimentos.map((item) => [
    horaPdf(item.dataHora),
    item.tipo === 'VENDA' ? `Venda (${item.pagamento === 'PIX' ? 'Pix' : 'Dinheiro'})` : item.tipo === 'ABERTURA' ? 'Abertura' : item.tipo === 'ENTRADA' ? 'Entrada' : item.tipo === 'SAIDA' ? 'Saída' : String(item.tipo || ''),
    String(item.operador || '—'),
    moedaPdf(item.valor),
    item.tipo === 'VENDA' && item.pagamento === 'DINHEIRO' ? moedaPdf(item.troco) : '—',
    String(item.observacao || '—').slice(0, 90)
  ]);

  if (typeof doc.autoTable === 'function') {
    doc.autoTable({
      startY: tableStart,
      head: [['Hora', 'Movimentação', 'Operador', 'Valor', 'Troco', 'Observação']],
      body,
      theme: 'grid',
      styles: { font: 'helvetica', fontSize: 7, cellPadding: 2.2, textColor: [35, 54, 68], overflow: 'linebreak' },
      headStyles: { fillColor: [16, 43, 70], textColor: [255, 255, 255], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [246, 249, 250] },
      columnStyles: {
        0: { cellWidth: 14 },
        1: { cellWidth: 31 },
        2: { cellWidth: 29 },
        3: { cellWidth: 23, halign: 'right' },
        4: { cellWidth: 19, halign: 'right' },
        5: { cellWidth: 'auto' }
      },
      margin: { left: 14, right: 14, bottom: 17 },
      didDrawPage: () => {
        const page = doc.internal.getNumberOfPages();
        doc.setFontSize(8);
        doc.setTextColor(120, 133, 143);
        doc.text(`Cantina da Escola · Página ${page}`, largura - 14, doc.internal.pageSize.getHeight() - 7, { align: 'right' });
      }
    });
  } else {
    let y = tableStart + 3;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text('Hora    Movimentação / Operadora                         Valor        Troco', 14, y);
    y += 6;
    doc.setFont('helvetica', 'normal');
    body.forEach((linha) => {
      if (y > doc.internal.pageSize.getHeight() - 22) {
        doc.addPage();
        y = 18;
      }
      const texto = `${linha[0]}  ${linha[1]} · ${linha[2]}  ${linha[3]}  ${linha[4]}`;
      doc.text(texto.slice(0, 112), 14, y);
      y += 5;
      if (linha[5] && linha[5] !== '—') {
        doc.setTextColor(110, 120, 130);
        doc.text(`Obs.: ${linha[5]}`.slice(0, 120), 18, y);
        doc.setTextColor(35, 54, 68);
        y += 5;
      }
    });
  }

  if (!movimentos.length) {
    const y = doc.lastAutoTable?.finalY || tableStart;
    doc.setFontSize(9);
    doc.setTextColor(100, 115, 127);
    doc.text('Nenhuma movimentação confirmada nesta data.', 14, y + 8);
  }

  const blob = doc.output('blob');
  const filename = `relatorio-cantina-da-escola-${relatorio.data || 'diario'}.pdf`;
  return { blob, filename };
}
