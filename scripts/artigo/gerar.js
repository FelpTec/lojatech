// Gera entrega/Artigo_LojaTech.docx a partir de ARTIGO.md (ABNT + identidade UCB).
// Uso: npm run artigo   (gera o .docx e exporta o PDF pelo Word)
// Gera o artigo em .docx (ABNT + identidade UCB) a partir de ARTIGO.md
const fs = require('fs');
const path = require('path');
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, Table, TableRow, TableCell,
  WidthType, BorderStyle, ShadingType, ImageRun, Header, PageNumber, TabStopType, LevelFormat,
  FootnoteReferenceRun, VerticalAlign,
} = require('docx');

const RAIZ = process.argv[2];
const SAIDA = process.argv[3];
const md = fs.readFileSync(path.join(RAIZ, 'ARTIGO.md'), 'utf8').replace(/\r\n/g, '\n');

// ---------------- Identidade e medidas ----------------
const AZUL = '27348B';
const AZUL_ESCURO = '1A2560';
const CINZA = '5B6180';
const FONTE = 'Arial';
const LARGURA = 9071;                 // A4 (11906) − 3 cm (1701) − 2 cm (1134)
const PT = (n) => n * 2;              // pontos → meios-pontos

const AUTORES = ['Fellipe Timbó Martins Rodrigues', 'Lucas Barcelos', 'Ângelo Prado'];
const NOTA_AUTOR = 'Graduando(a) em Engenharia de Software pela Universidade Católica de Brasília (UCB).';

// ---------------- Inline: **negrito**, *itálico*, `código` ----------------
function inline(texto, base = {}) {
  const runs = [];
  const re = /(`[^`]+`)|(\*\*[^*]+(?:\*(?!\*)[^*]*)*\*\*)|(\*[^*\s][^*]*\*)/g;
  let pos = 0;
  let m;
  while ((m = re.exec(texto))) {
    if (m.index > pos) runs.push(new TextRun({ text: texto.slice(pos, m.index), ...base }));
    if (m[1]) {
      runs.push(new TextRun({ text: m[1].slice(1, -1), ...base, font: 'Consolas', size: base.size ? base.size - 2 : PT(10.5), color: AZUL_ESCURO }));
    } else if (m[2]) {
      runs.push(...inline(m[2].slice(2, -2), { ...base, bold: true }));
    } else if (m[3]) {
      runs.push(...inline(m[3].slice(1, -1), { ...base, italics: true }));
    }
    pos = m.index + m[0].length;
  }
  if (pos < texto.length) runs.push(new TextRun({ text: texto.slice(pos), ...base }));
  return runs;
}

// ---------------- Blocos ----------------
const corpo = [];
let secao = '';                       // controla estilo de Resumo / Abstract / Referências
let instanciaLista = 0;
const configsLista = [];               // uma definição de numeração por lista (evita reinícios no Word)
const niveis = (numerada) => [
  numerada
    ? { level: 0, format: LevelFormat.DECIMAL, text: '%1.', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 709, hanging: 360 } } } }
    : { level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 709, hanging: 284 } } } },
  { level: 1, format: LevelFormat.BULLET, text: '–', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 1276, hanging: 284 } } } },
];

const paragrafoTexto = (texto) => {
  const resumo = secao === 'resumo';
  const refs = secao === 'refs';
  const palavras = /^\*\*(Palavras-chave|Keywords):\*\*/.test(texto);
  return new Paragraph({
    children: inline(texto),
    alignment: refs ? AlignmentType.LEFT : AlignmentType.JUSTIFIED,
    indent: resumo || refs || palavras ? undefined : { firstLine: 709 },
    spacing: refs ? { line: 240, after: 240 } : resumo ? { line: 240, after: palavras ? 360 : 200, before: palavras ? 160 : 0 } : { line: 360, after: 120 },
  });
};

function titulo(texto, nivel) {
  const semNumero = !/^\d/.test(texto);
  if (nivel === 2) {
    const m = texto.match(/^(\d+)\.\s+(.*)$/);
    const rotulo = m ? `${m[1]} ${m[2].toUpperCase()}` : texto.toUpperCase();
    return new Paragraph({
      heading: HeadingLevel.HEADING_1,
      alignment: semNumero ? AlignmentType.CENTER : AlignmentType.LEFT,
      children: inline(rotulo, { bold: true, color: AZUL, size: PT(12), font: FONTE }),
    });
  }
  return new Paragraph({ heading: HeadingLevel.HEADING_2, children: inline(texto, { bold: true, color: AZUL, size: PT(12), font: FONTE }) });
}

function legenda(texto) {
  return new Paragraph({
    keepNext: true,
    spacing: { before: 240, after: 80, line: 240 },
    children: inline(texto, { size: PT(10) }),
  });
}

function fonteNota(texto) {
  return new Paragraph({ spacing: { before: 60, after: 240, line: 240 }, children: inline(texto, { size: PT(10), color: CINZA }) });
}

function dimensoesPng(arquivo) {
  const b = fs.readFileSync(arquivo);
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20), dados: b };
}

function imagem(rel) {
  const { w, h, dados } = dimensoesPng(path.join(RAIZ, rel));
  const largura = rel.includes('telas') ? 520 : 600;          // telas ~13,8 cm; DER ~15,9 cm
  const altura = Math.round((h / w) * largura);
  const maxAltura = 780;                                     // não estoura a página
  const escala = altura > maxAltura ? maxAltura / altura : 1;
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    keepNext: true,
    spacing: { after: 0, line: 240 },
    children: [new ImageRun({ type: 'png', data: dados, transformation: { width: Math.round(largura * escala), height: Math.round(altura * escala) } })],
  });
}

function lista(itens) {
  instanciaLista += 1;
  const ref = `lista-${instanciaLista}`;
  configsLista.push({ reference: ref, levels: niveis(itens[0].numerada) });
  return itens.map(({ texto, nivel }) => new Paragraph({
    numbering: { reference: ref, level: nivel },
    alignment: AlignmentType.JUSTIFIED,
    spacing: { line: secao === 'resumo' ? 240 : 360, after: 60 },
    children: inline(texto),
  }));
}

const borda = { style: BorderStyle.SINGLE, size: 4, color: 'C9CDDD' };
const bordas = { top: borda, bottom: borda, left: borda, right: borda };

function tabela(linhas) {
  const celulas = (l) => l.replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
  const cab = celulas(linhas[0]);
  const dados = linhas.slice(2).map(celulas);
  const n = cab.length;
  // largura proporcional ao conteúdo (com mínimo), somando LARGURA
  const peso = cab.map((_, i) => Math.max(12, Math.min(90, Math.max(...[cab[i], ...dados.map((d) => d[i] || '')].map((t) => t.replace(/[`*]/g, '').length)))));
  const total = peso.reduce((a, b) => a + b, 0);
  let larguras = peso.map((p) => Math.max(1400, Math.round((p / total) * LARGURA)));
  const ajuste = LARGURA - larguras.reduce((a, b) => a + b, 0);
  larguras[larguras.indexOf(Math.max(...larguras))] += ajuste;

  const linha = (cels, cabecalho) => new TableRow({
    tableHeader: cabecalho,
    cantSplit: true,
    children: cels.map((t, i) => new TableCell({
      width: { size: larguras[i], type: WidthType.DXA },
      borders: bordas,
      verticalAlign: VerticalAlign.CENTER,
      shading: cabecalho ? { type: ShadingType.CLEAR, fill: 'E8EBF6', color: 'auto' } : undefined,
      margins: { top: 60, bottom: 60, left: 100, right: 100 },
      children: [new Paragraph({ spacing: { line: 240, after: 0 }, children: inline(t, { size: PT(10), ...(cabecalho ? { bold: true, color: AZUL } : {}) }) })],
    })),
  });
  return new Table({
    width: { size: LARGURA, type: WidthType.DXA },
    columnWidths: larguras,
    rows: [linha(cab, true), ...dados.map((d) => linha(d.concat(Array(n - d.length).fill('')).slice(0, n), false))],
  });
}

function codigo(linhas) {
  return linhas.map((l, i) => new Paragraph({
    spacing: { line: 240, after: 0, before: 0 },
    shading: { type: ShadingType.CLEAR, fill: 'F4F5FA', color: 'auto' },
    border: { left: { style: BorderStyle.SINGLE, size: 18, color: AZUL, space: 8 } },
    indent: { left: 200 },
    keepNext: i < linhas.length - 1,
    children: [new TextRun({ text: l || ' ', font: 'Consolas', size: PT(8.5), color: l.trim().startsWith('//') ? CINZA : '171A33' })],
  }));
}

// ---------------- Parser de blocos ----------------
const linhas = md.split('\n');
const titulo1 = linhas.find((l) => l.startsWith('# ')).slice(2);
let i = linhas.findIndex((l) => l.startsWith('## Resumo'));

while (i < linhas.length) {
  const l = linhas[i];
  if (!l.trim() || l.trim() === '---') { i += 1; continue; }

  if (l.startsWith('## ')) {
    const t = l.slice(3).trim();
    secao = /^(Resumo|Abstract)$/.test(t) ? 'resumo' : t === 'Referências' ? 'refs' : '';
    corpo.push(titulo(t, 2));
    i += 1; continue;
  }
  if (l.startsWith('### ')) { corpo.push(titulo(l.slice(4).trim(), 3)); i += 1; continue; }

  if (l.startsWith('```')) {
    const bloco = [];
    i += 1;
    while (i < linhas.length && !linhas[i].startsWith('```')) bloco.push(linhas[i++]);
    i += 1;
    corpo.push(...codigo(bloco));
    continue;
  }
  if (l.startsWith('|')) {
    const bloco = [];
    while (i < linhas.length && linhas[i].startsWith('|')) bloco.push(linhas[i++]);
    corpo.push(tabela(bloco));
    continue;
  }
  const img = l.match(/^!\[[^\]]*\]\(([^)]+)\)/);
  if (img) { corpo.push(imagem(img[1])); i += 1; continue; }

  if (/^\*\*(Quadro|Figura) \d+\*\*/.test(l)) { corpo.push(legenda(l)); i += 1; continue; }
  if (l.startsWith('Fonte:')) { corpo.push(fonteNota(l)); i += 1; continue; }

  if (/^(\s*)([-*]|\d+\.)\s+/.test(l)) {
    const itens = [];
    while (i < linhas.length && /^(\s*)([-*]|\d+\.)\s+/.test(linhas[i])) {
      const m = linhas[i].match(/^(\s*)([-*]|\d+\.)\s+(.*)$/);
      itens.push({ texto: m[3], nivel: m[1].length >= 2 ? 1 : 0, numerada: /\d/.test(m[2]) });
      i += 1;
    }
    corpo.push(...lista(itens));
    continue;
  }
  corpo.push(paragrafoTexto(l.trim()));
  i += 1;
}

// ---------------- Abertura (título, autores, dados da disciplina) ----------------
const abertura = [
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 0, after: 480, line: 300 },
    children: (() => {
      const [principal, ...resto] = titulo1.split(':');
      return [
        new TextRun({ text: principal.toUpperCase(), bold: true, size: PT(14), color: AZUL, font: FONTE }),
        new TextRun({ text: resto.length ? `: ${resto.join(':').trim()}` : '', bold: true, size: PT(14), color: AZUL, font: FONTE }),
      ];
    })(),
  }),
  ...AUTORES.map((a, k) => new Paragraph({
    alignment: AlignmentType.RIGHT,
    spacing: { after: 0, line: 276 },
    children: [new TextRun({ text: a, size: PT(12) }), new FootnoteReferenceRun(k + 1)],
  })),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { before: 360, after: 0, line: 240 },
    border: { top: { style: BorderStyle.SINGLE, size: 6, color: AZUL, space: 8 } },
    children: [new TextRun({ text: 'Universidade Católica de Brasília · Engenharia de Software', size: PT(10), color: CINZA })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 0, line: 240 },
    children: [new TextRun({ text: 'Laboratório de Banco de Dados (GPE17N40158) · Prof. Jefferson Salomão Rodrigues', size: PT(10), color: CINZA })],
  }),
  new Paragraph({
    alignment: AlignmentType.CENTER,
    spacing: { after: 480, line: 240 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: AZUL, space: 8 } },
    children: [new TextRun({ text: 'Repositório: https://github.com/FelpTec/lojatech · Brasília, novembro de 2026', size: PT(10), color: CINZA })],
  }),
];

const notas = {};
AUTORES.forEach((_, k) => { notas[k + 1] = { children: [new Paragraph({ spacing: { line: 240 }, children: [new TextRun({ text: NOTA_AUTOR, size: PT(10) })] })] }; });

// ---------------- Documento ----------------
const doc = new Document({
  creator: AUTORES.join('; '),
  title: titulo1,
  description: 'Artigo técnico — Laboratório de Banco de Dados (UCB)',
  styles: {
    default: {
      document: { run: { font: FONTE, size: PT(12) }, paragraph: { spacing: { line: 360 } } },
      heading1: { run: { font: FONTE, size: PT(12), bold: true, color: AZUL }, paragraph: { spacing: { before: 360, after: 200, line: 360 }, keepNext: true, keepLines: true } },
      heading2: { run: { font: FONTE, size: PT(12), bold: true, color: AZUL }, paragraph: { spacing: { before: 280, after: 120, line: 360 }, keepNext: true, keepLines: true } },
    },
  },
  numbering: { config: configsLista },
  footnotes: notas,
  sections: [{
    properties: {
      page: {
        size: { width: 11906, height: 16838 },
        margin: { top: 1701, left: 1701, bottom: 1134, right: 1134, header: 709, footer: 567 },
      },
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          tabStops: [{ type: TabStopType.RIGHT, position: LARGURA }],
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: AZUL, space: 4 } },
          children: [
            new TextRun({ text: 'LojaTech · Laboratório de Banco de Dados · UCB', size: PT(9), color: CINZA }),
            new TextRun({ children: ['\t', PageNumber.CURRENT], size: PT(10), color: AZUL, bold: true }),
          ],
        })],
      }),
    },
    children: [...abertura, ...corpo],
  }],
});

Packer.toBuffer(doc).then((buf) => { fs.writeFileSync(SAIDA, buf); console.log('docx gerado:', SAIDA, buf.length, 'bytes'); });
