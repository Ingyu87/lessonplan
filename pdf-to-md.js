/**
 * PDF to Markdown - Extract text from a PDF and save as .md
 * Run: node pdf-to-md.js [filename.pdf]
 * Default: 2022 개정 교육과정 적용 교수·학습 과정안(약안 서식).pdf
 */

const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');

const DEFAULT_PDF = '2022 개정 교육과정 적용 교수·학습 과정안(약안 서식).pdf';

/** 파이프로 쪼개진 한글/기호를 한 문장으로 합치기 (PDF 레이아웃 보정) */
function mergePipeFragments(s) {
  return s
    .replace(/\|\s*\|\s*/g, ' | ')
    .replace(/\s*\|\s*/g, (m) => (m.length > 2 ? ' ' : ''));
}

function textToMarkdown(text) {
  if (!text || typeof text !== 'string') return '';

  let md = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\u0000/g, ' ')
    .replace(/\n{3,}/g, '\n\n');

  const lines = md.split('\n');
  const out = [];
  const tableRows = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      if (tableRows.length > 0) {
        out.push('');
        out.push(tableRows.map((row) => '| ' + row.map(mergePipeFragments).join(' | ') + ' |').join('\n'));
        out.push('');
        tableRows.length = 0;
      }
      out.push('');
      continue;
    }

    const looksLikeHeader =
      trimmed.length < 80 &&
      (trimmed.endsWith('안') || trimmed.endsWith('서식') || trimmed.endsWith('계획') || trimmed.endsWith('분석') || trimmed.endsWith('활동') || trimmed.endsWith('의도')) &&
      !trimmed.startsWith('|') &&
      !/^\|\s*-/.test(trimmed);

    if (looksLikeHeader && trimmed.length > 2 && trimmed.length < 60 && !/^\d+$/.test(trimmed)) {
      if (tableRows.length > 0) {
        out.push('');
        out.push(tableRows.map((row) => '| ' + row.map(mergePipeFragments).join(' | ') + ' |').join('\n'));
        out.push('');
        tableRows.length = 0;
      }
      out.push('');
      out.push('## ' + mergePipeFragments(trimmed));
      out.push('');
      continue;
    }

    const cells = trimmed.split(/\t+/).map((c) => c.trim());
    if (cells.length >= 2 && cells.every((c) => c.length < 120)) {
      tableRows.push(cells);
      continue;
    }

    if (tableRows.length > 0) {
      out.push('');
      out.push(tableRows.map((row) => '| ' + row.map(mergePipeFragments).join(' | ') + ' |').join('\n'));
      out.push('');
      tableRows.length = 0;
    }

    out.push(mergePipeFragments(trimmed));
  }

  if (tableRows.length > 0) {
    out.push('');
    out.push(tableRows.map((row) => '| ' + row.map(mergePipeFragments).join(' | ') + ' |').join('\n'));
    out.push('');
  }

  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

async function main() {
  const scriptDir = __dirname;
  const pdfName = process.argv[2] || DEFAULT_PDF;
  const pdfPath = path.isAbsolute(pdfName) ? pdfName : path.join(scriptDir, pdfName);

  if (!fs.existsSync(pdfPath)) {
    console.error('File not found:', pdfPath);
    process.exit(1);
  }

  const baseName = path.basename(pdfPath, path.extname(pdfPath));
  const outPath = path.join(scriptDir, baseName + '.md');

  console.log('Reading:', pdfPath);
  const buffer = fs.readFileSync(pdfPath);
  const parser = new PDFParse({ data: buffer });

  try {
    const result = await parser.getText();
    const text = result?.text ?? '';
    console.log('Extracted text length:', text.length);

    const md = textToMarkdown(text);
    fs.writeFileSync(outPath, md, 'utf8');
    console.log('Written:', outPath);
  } finally {
    await parser.destroy();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
