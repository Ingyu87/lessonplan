/**
 * PDF to JSON - Extract 연간지도 계획 from Korean PDF files
 * Pattern: 2026학년도_*학기_*학년_*_* 활동 계획.pdf
 * Output: 연간지도_계획.json
 *
 * Run: node pdf-to-json.js
 */

const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');

const OUTPUT_FILE = '연간지도_계획.json';

function cleanText(s) {
  if (typeof s !== 'string') return s;
  return s.replace(/\u0000/g, ' ').replace(/\s+/g, ' ').trim();
}

/** 쪽수(112~115, 150-153 등)인지 판별 - 주요 학습 내용이 아님 */
function isPageNumberOnly(s) {
  if (!s || typeof s !== 'string') return false;
  const t = s.trim();
  return /^\d{1,4}\s*[~\-]\s*\d{1,4}$/.test(t) || /^\d{1,4}\s*$/.test(t);
}

/** 저장할 내용: 쪽수면 빈 문자열, 아니면 정리된 텍스트 */
function storeContent(content) {
  if (isPageNumberOnly(content)) return '';
  return cleanText(content);
}

/** 여러 열 중 실제 학습 내용(• 포함, 한글 문장)을 선택. 쪽수는 제외 */
function pickContentColumn(cells) {
  const candidates = [4, 3, 5].filter(i => cells[i] !== undefined && cells[i] !== null);
  for (const i of candidates) {
    const v = String(cells[i] || '').trim();
    if (!v) continue;
    if (isPageNumberOnly(v)) continue;
    if (v.length < 3) continue;
    return v;
  }
  return '';
}
// 2026학년도_1학기_3학년_국어_국어 활동 계획.pdf 등 다양한 형식 지원
const PDF_PATTERN = /2026[^\d]*학년도[_\s]*([12])학기[_\s]*([1-6])학년[_\s]*([^_\s]+)[_\s].*활동\s*계획\.pdf$/i;

/**
 * 학년 → 학년군
 */
function get학년군(학년) {
  const n = parseInt(학년, 10);
  if (n <= 2) return '1~2학년';
  if (n <= 4) return '3~4학년';
  return '5~6학년';
}

/**
 * Parse filename: 2026년도_1학년 1학기_국어_연간 지도 계획.pdf
 * 또는: 2026학년도_1학기_3학년_국어_국어 활동 계획.pdf
 * Returns { 학기, 학년, 교과 } or null
 */
function parseFilename(filename) {
  const 교과Map = { '국어': '국어', '수학': '수학', '사회': '사회', '과학': '과학', '도덕': '도덕', '실과': '실과', '체육': '체육', '음악': '음악', '미술': '미술', '영어': '영어', '통합교과': '통합교과', '바른생활': '바른 생활', '슬기로운생활': '슬기로운 생활', '즐거운생활': '즐거운 생활' };

  // 형식1: 2026년도_N학년 N학기_교과 또는 N학년_1학기_교과
  let m = filename.match(/([1-6])학년[_\s]*([12])학기[_\s]*([^_\s.]+)/);
  if (m) {
    return {
      학기: m[2],
      학년: m[1],
      교과: 교과Map[m[3].trim()] || m[3].trim(),
    };
  }

  // 형식2: 2026학년도_N학기_N학년_교과_...
  m = filename.match(/([12])학기[_\s]*([1-6])학년[_\s]*([^_\s.]+)/);
  if (m) {
    return {
      학기: m[1],
      학년: m[2],
      교과: 교과Map[m[3].trim()] || m[3].trim(),
    };
  }

  return null;
}

/**
 * Parse PDF text to extract 단원, 차시, 주요 학습 내용
 * Table columns: 단원, 차시, 소요시간, 주요 학습 내용 및 활동, 비고
 * PDF text often comes as lines - we try to detect table rows
 */
function parsePdfText(text) {
  const units = [];
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);

  // Try to find table header and data rows
  // Common patterns: "1", "바른 말을 사용해요", "9", "인사말과 바른 말..."
  // Or: 단원번호/단원명/차시/내용 in various orders

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    // Skip header-like lines
    if (
      /^단원\s*$|^차시\s*$|^소요시간\s*$|^주요\s*학습\s*내용\s*및\s*활동\s*$|^비고\s*$/.test(
        line
      ) ||
      /^번호\s*$|^학습\s*내용\s*$/.test(line)
    ) {
      i++;
      continue;
    }

    // Match row: number (단원번호), text (단원명), number (차시), rest (내용)
    // Pattern 1: "1  바른 말을 사용해요  9  인사말과..."
    const rowMatch = line.match(
      /^(\d+)\s+(.+?)\s+(\d+)\s+(.+)$/
    );
    if (rowMatch) {
      const [, numStr, unitName, lessonStr, content] = rowMatch;
      const unitNum = parseInt(numStr, 10);
      const lessonCount = parseInt(lessonStr, 10);
      if (unitNum >= 1 && unitNum <= 99 && lessonCount >= 1 && lessonCount <= 200) {
        units.push({
          단원번호: unitNum,
          단원명: cleanText(unitName.trim()),
          차시수: lessonCount,
          주요_학습_내용_및_활동: storeContent(content),
        });
        i++;
        continue;
      }
    }

    // Pattern 2: "(1) 단원명  차시  내용" - parenthesized unit number
    const parenMatch = line.match(
      /^\((\d+)\)\s+(.+?)\s+(\d+)\s+(.+)$/
    );
    if (parenMatch) {
      const [, numStr, unitName, lessonStr, content] = parenMatch;
      const unitNum = parseInt(numStr, 10);
      const lessonCount = parseInt(lessonStr, 10);
      if (unitNum >= 1 && unitNum <= 99 && lessonCount >= 1 && lessonCount <= 200) {
        units.push({
          단원번호: unitNum,
          단원명: cleanText(`(${numStr}) ${unitName.trim()}`),
          차시수: lessonCount,
          주요_학습_내용_및_활동: storeContent(content),
        });
        i++;
        continue;
      }
    }

    // Pattern 3: Multi-line unit - "1" on one line, "단원명" on next, "9" "내용" etc
    if (/^\d+$/.test(line) && i + 3 < lines.length) {
      const unitNum = parseInt(line, 10);
      const next1 = lines[i + 1];
      const next2 = lines[i + 2];
      const next3 = lines[i + 3];
      const lessonMatch = next2.match(/^(\d+)$/);
      if (
        unitNum >= 1 &&
        unitNum <= 99 &&
        lessonMatch &&
        parseInt(lessonMatch[1], 10) >= 1 &&
        parseInt(lessonMatch[1], 10) <= 200
      ) {
        units.push({
          단원번호: unitNum,
          단원명: cleanText(next1),
          차시수: parseInt(lessonMatch[1], 10),
          주요_학습_내용_및_활동: storeContent(next3 || ''),
        });
        i += 4;
        continue;
      }
    }

    // Pattern 4: Tab or multi-space separated: "1\t단원명\t9\t내용"
    const tabParts = line.split(/\t+/);
    if (tabParts.length >= 4) {
      const numStr = tabParts[0].trim();
      const unitName = tabParts[1].trim();
      const lessonStr = tabParts[2].trim();
      const content = tabParts.slice(3).join('\t').trim();
      const unitNum = parseInt(numStr, 10);
      const lessonCount = parseInt(lessonStr, 10);
      if (
        !isNaN(unitNum) &&
        unitNum >= 1 &&
        unitNum <= 99 &&
        !isNaN(lessonCount) &&
        lessonCount >= 1 &&
        lessonCount <= 200 &&
        unitName.length > 0
      ) {
        units.push({
          단원번호: unitNum,
          단원명: cleanText(unitName),
          차시수: lessonCount,
          주요_학습_내용_및_활동: storeContent(content),
        });
        i++;
        continue;
      }
    }

    // Pattern 5: Two or more spaces as separator
    const spaceParts = line.split(/\s{2,}/);
    if (spaceParts.length >= 4) {
      const numStr = spaceParts[0].trim();
      const unitName = spaceParts[1].trim();
      const lessonStr = spaceParts[2].trim();
      const content = spaceParts.slice(3).join(' ').trim();
      const unitNum = parseInt(numStr, 10);
      const lessonCount = parseInt(lessonStr, 10);
      if (
        !isNaN(unitNum) &&
        unitNum >= 1 &&
        unitNum <= 99 &&
        !isNaN(lessonCount) &&
        lessonCount >= 1 &&
        lessonCount <= 200 &&
        unitName.length > 0 &&
        !/^단원|^차시|^소요|^주요|^비고/.test(unitName)
      ) {
        units.push({
          단원번호: unitNum,
          단원명: cleanText(unitName),
          차시수: lessonCount,
          주요_학습_내용_및_활동: storeContent(content),
        });
        i++;
        continue;
      }
    }

    i++;
  }

  return units;
}

/**
 * Try getTable() first - if tables exist, parse them
 */
function parseTableResult(tableResult) {
  const units = [];
  if (!tableResult || !tableResult.pages) return units;

  for (const page of tableResult.pages) {
    if (!page.tables || !Array.isArray(page.tables)) continue;
    for (const table of page.tables) {
      if (!Array.isArray(table)) continue;
      // table is array of rows; each row is array of cells
      for (let r = 1; r < table.length; r++) {
        const row = table[r];
        if (!Array.isArray(row) || row.length < 4) continue;
        const numStr = String(row[0] || '').trim();
        const unitName = String(row[1] || '').trim();
        const lessonStr = String(row[2] || '').trim();
        const content = pickContentColumn(row);
        const unitNum = parseInt(numStr, 10);
        const lessonCount = parseInt(lessonStr, 10);
        if (
          !isNaN(unitNum) &&
          unitNum >= 1 &&
          unitNum <= 99 &&
          !isNaN(lessonCount) &&
          lessonCount >= 1 &&
          lessonCount <= 200 &&
          unitName.length > 0
        ) {
          units.push({
            단원번호: unitNum,
            단원명: cleanText(unitName),
            차시수: lessonCount,
            주요_학습_내용_및_활동: storeContent(content),
          });
        }
      }
    }
  }
  return units;
}

/**
 * Extract text from PDF and parse units
 */
async function extractFromPdf(filePath) {
  const buffer = fs.readFileSync(filePath);
  const parser = new PDFParse({ data: buffer });

  try {
    // Try getTable first for structured table data
    let units = [];
    try {
      const tableResult = await parser.getTable();
      units = parseTableResult(tableResult);
    } catch (_) {
      // getTable may fail for some PDFs
    }

    // Fall back to getText if no units from table
    if (units.length === 0) {
      const textResult = await parser.getText();
      const text = textResult?.text || '';
      units = parsePdfText(text);
    }

    return units;
  } finally {
    await parser.destroy();
  }
}

/**
 * Find all PDF files matching pattern in directory (and subdirs)
 */
function findPdfFiles(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory() && !e.name.startsWith('node_modules')) {
      results.push(...findPdfFiles(full));
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.pdf')) {
      // 연간지도 계획 PDF: 학년도, 학기, 학년, 교과, 활동 계획 포함
      if (/학년도|학기|학년/.test(e.name) && /활동\s*계획|연간/.test(e.name)) {
        results.push(full);
      }
    }
  }
  return results;
}

/**
 * Merge entries: same 교과+학년 from multiple files (e.g. 1학기, 2학기) into one
 */
function mergeEntries(entries) {
  const byKey = new Map();
  for (const e of entries) {
    const key = `${e.교과}|${e.학년}`;
    const existing = byKey.get(key);
    if (existing) {
      // Merge 단원목록 - avoid duplicates by 단원번호
      const seen = new Set(existing.단원목록.map((u) => u.단원번호));
      for (const u of e.단원목록) {
        if (!seen.has(u.단원번호)) {
          seen.add(u.단원번호);
          existing.단원목록.push(u);
        }
      }
      existing.단원목록.sort((a, b) => a.단원번호 - b.단원번호);
    } else {
      byKey.set(key, { ...e });
    }
  }
  return Array.from(byKey.values());
}

async function main() {
  const scriptDir = __dirname;
  const pdfFiles = findPdfFiles(scriptDir);

  if (pdfFiles.length === 0) {
    console.log(
      'No PDF files found matching: 2026학년도_*학기_*학년_*_* 활동 계획.pdf'
    );
    console.log('Place PDF files in:', scriptDir);
    fs.writeFileSync(
      path.join(scriptDir, OUTPUT_FILE),
      JSON.stringify([], null, 2),
      'utf8'
    );
    console.log('Created empty', OUTPUT_FILE);
    return;
  }

  console.log(`Found ${pdfFiles.length} PDF file(s):`);
  pdfFiles.forEach((f) => console.log('  -', path.basename(f)));

  const entries = [];

  for (const filePath of pdfFiles) {
    const filename = path.basename(filePath);
    const meta = parseFilename(filename);
    if (!meta) {
      console.warn('Skip (filename parse failed):', filename);
      continue;
    }

    console.log(`Processing: ${filename} (${meta.교과} ${meta.학년}학년)`);
    try {
      const 단원목록 = await extractFromPdf(filePath);
      if (단원목록.length === 0) {
        console.warn('  No units extracted - check PDF structure');
      } else {
        console.log(`  Extracted ${단원목록.length} unit(s)`);
      }

      entries.push({
        교과: meta.교과,
        학년: meta.학년,
        학년군: get학년군(meta.학년),
        단원목록,
      });
    } catch (err) {
      console.error(`  Error:`, err.message);
    }
  }

  const merged = mergeEntries(entries);
  const outputPath = path.join(scriptDir, OUTPUT_FILE);
  fs.writeFileSync(outputPath, JSON.stringify(merged, null, 2), 'utf8');
  console.log(`\nWritten to ${OUTPUT_FILE}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
