/**
 * PDF 전체 분석 → 자료 JSON 생성
 * - 연간지도 계획 PDF → 연간지도_계획.json
 * - 약안 서식 PDF → 약안_서식_구조.json
 *
 * Run: node pdf-all-to-data.js
 */

const fs = require('fs');
const path = require('path');
const { PDFParse } = require('pdf-parse');

const BASE_DIR = __dirname;

// ========== 연간지도 계획 (기존 pdf-to-json 로직) ==========
async function runAnnualPlanConversion() {
  const { execSync } = require('child_process');
  execSync('node pdf-to-json.js', { cwd: BASE_DIR, stdio: 'inherit' });
}

// ========== 약안 서식 PDF 분석 ==========
function findYakanFormatPdf(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    if (e.isDirectory() && !e.name.startsWith('node_modules')) {
      const found = findYakanFormatPdf(path.join(dir, e.name));
      if (found) return found;
    } else if (e.isFile() && e.name.toLowerCase().endsWith('.pdf')) {
      if (/약안|교수.*학습.*과정안|서식/.test(e.name)) {
        return path.join(dir, e.name);
      }
    }
  }
  return null;
}

async function extractYakanFormatStructure(filePath) {
  const buffer = fs.readFileSync(filePath);
  const parser = new PDFParse({ data: buffer });

  try {
    const textResult = await parser.getText();
    const text = textResult?.text || '';

    // 2022 개정 교육과정 약안 서식 구조 추출
    const structure = {
      출처: path.basename(filePath),
      추출일시: new Date().toISOString(),
      섹션목록: [
        { id: 'header', name: '헤더', 항목: ['단원', '대상', '학급', '일시'] },
        { id: '차시', name: '차시', 항목: ['차시', '교과서 쪽수', '교수·학습 모형'] },
        { id: '교육과정분석', name: '교육과정 분석', 항목: ['교과 역량', '영역', '핵심 아이디어', '성취기준', '탐구 질문'] },
        { id: '학습목표', name: '학습 목표', 항목: ['학습 목표', '학습 주제', '수업자 의도', '평가 계획'] },
        { id: '교수학습활동', name: '교수·학습 활동', 항목: ['학습 단계', '학습형태', '교수·학습 활동', '시간(분)', '자료', '유의점', '평가'] },
      ],
      평가범주: ['지식·이해', '과정·기능', '가치·태도'],
      유의사항: [],
    };

    // 텍스트에서 유의사항/안내 문구 추출
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const keywords = ['탐구 질문', '평가 계획', '학습 형태', '자료', '유의'];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.length > 20 && keywords.some((k) => line.includes(k))) {
        const excerpt = line.substring(0, 200).replace(/\s+/g, ' ');
        if (!structure.유의사항.includes(excerpt)) {
          structure.유의사항.push(excerpt);
        }
      }
    }
    structure.유의사항 = structure.유의사항.slice(0, 15);

    return structure;
  } finally {
    await parser.destroy();
  }
}

// ========== 자료 목록 생성 (모든 JSON 통합 인덱스) ==========
function createDataIndex() {
  const index = {
    생성일시: new Date().toISOString(),
    자료목록: [],
  };

  const files = [
    { path: '연간지도_계획.json', 설명: '교과·학년별 단원, 차시, 주요 학습 내용' },
    { path: '약안_서식_구조.json', 설명: '2022 개정 약안 서식 구조 및 섹션' },
    { path: '2022개정교육과정 성취기준 및 해설.json', 설명: '성취기준 및 해설' },
    { path: '★(초)2022개정교육과정에따른성취수준(1~2학년군).json', 설명: '1~2학년군 성취수준' },
    { path: '★(초)2022개정교육과정에따른성취수준(3~4학년군).json', 설명: '3~4학년군 성취수준' },
    { path: '★(초)2022개정교육과정에따른성취수준(5~6학년군).json', 설명: '5~6학년군 성취수준' },
  ];

  for (const f of files) {
    const fullPath = path.join(BASE_DIR, f.path);
    if (fs.existsSync(fullPath)) {
      const stat = fs.statSync(fullPath);
      index.자료목록.push({
        파일: f.path,
        설명: f.설명,
        크기: stat.size,
        수정일시: stat.mtime.toISOString(),
      });
    }
  }

  return index;
}

async function main() {
  console.log('=== PDF 전체 분석 → 자료 생성 ===\n');

  // 1. 연간지도 계획 PDF → 연간지도_계획.json
  console.log('[1/3] 연간지도 계획 PDF 변환...');
  await runAnnualPlanConversion();
  console.log('');

  // 2. 약안 서식 PDF → 약안_서식_구조.json
  console.log('[2/3] 약안 서식 PDF 분석...');
  const yakanPdf = findYakanFormatPdf(BASE_DIR);
  if (yakanPdf) {
    console.log('  발견:', path.basename(yakanPdf));
    try {
      const structure = await extractYakanFormatStructure(yakanPdf);
      const outPath = path.join(BASE_DIR, '약안_서식_구조.json');
      fs.writeFileSync(outPath, JSON.stringify(structure, null, 2), 'utf8');
      console.log('  → 약안_서식_구조.json 생성 완료');
    } catch (err) {
      console.error('  오류:', err.message);
    }
  } else {
    console.log('  약안 서식 PDF 없음 (교수·학습 과정안, 서식 포함 파일명)');
  }
  console.log('');

  // 3. 자료 인덱스 생성
  console.log('[3/3] 자료 인덱스 생성...');
  const index = createDataIndex();
  fs.writeFileSync(
    path.join(BASE_DIR, '자료_인덱스.json'),
    JSON.stringify(index, null, 2),
    'utf8'
  );
  console.log(`  → 자료_인덱스.json (${index.자료목록.length}개 자료)`);
  console.log('');

  console.log('=== 완료 ===');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
