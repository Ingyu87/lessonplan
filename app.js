/**
 * 2022 개정 교육과정 수업 설계 전문가 - app.js
 * 결과물: 약안 서식 양식 그대로 출력
 */

const API_BASE = (typeof window !== 'undefined' && (window.location.protocol === 'file:' || !window.location.origin))
    ? 'http://localhost:3000'
    : '';

let lastGeneratedData = null;
let unitList = [];
let unitsFetchController = null;

const elements = {
    generateBtn: document.getElementById('generate-btn'),
    resultSection: document.getElementById('result-section'),
    yakanOutput: document.getElementById('yakan-output'),
    inputs: {
        grade: document.getElementById('grade'),
        semester: document.getElementById('semester'),
        subject: document.getElementById('subject'),
        unit: document.getElementById('unit'),
        unitFallback: document.getElementById('unit-fallback'),
        lesson: document.getElementById('lesson'),
        target: document.getElementById('target'),
        date: document.getElementById('date'),
        model: document.getElementById('model'),
    },
    downloadBtn: document.getElementById('download-docx'),
    downloadPdfBtn: document.getElementById('download-pdf'),
    learningSheetBtn: document.getElementById('learning-sheet-btn'),
    learningSheetSection: document.getElementById('learning-sheet-section'),
    learningSheetIframe: document.getElementById('learning-sheet-iframe'),
    learningSheetAnswerIframe: document.getElementById('learning-sheet-answer-iframe'),
    learningSheetPrint: document.getElementById('learning-sheet-print'),
    learningSheetAnswerPrint: document.getElementById('learning-sheet-answer-print'),
    learningSheetClose: document.getElementById('learning-sheet-close'),
    learningSheetTabs: document.querySelectorAll('.learning-sheet-tab'),
    toast: document.getElementById('toast'),
};

document.addEventListener('DOMContentLoaded', () => {
    elements.generateBtn?.addEventListener('click', handleGenerate);
    elements.downloadBtn?.addEventListener('click', handleDownload);
    elements.downloadPdfBtn?.addEventListener('click', handlePrintPdf);
    elements.learningSheetBtn?.addEventListener('click', handleLearningSheet);
    elements.learningSheetPrint?.addEventListener('click', handleLearningSheetPrint);
    elements.learningSheetAnswerPrint?.addEventListener('click', handleLearningSheetAnswerPrint);
    elements.learningSheetClose?.addEventListener('click', handleLearningSheetClose);
    elements.learningSheetTabs?.forEach((tab) => tab.addEventListener('click', handleLearningSheetTab));

    elements.inputs.grade?.addEventListener('change', fetchUnits);
    elements.inputs.subject?.addEventListener('change', fetchUnits);
    // 페이지 로드 시 교과·학년 선택 → 단원 자동 로드
    setTimeout(() => {
        if (elements.inputs.subject?.value && elements.inputs.grade?.value) fetchUnits();
    }, 300);

    elements.inputs.unit?.addEventListener('change', () => {
        const isDirect = elements.inputs.unit.value === '__direct__';
        if (elements.inputs.unitFallback) {
            elements.inputs.unitFallback.classList.toggle('hidden', !isDirect);
            if (isDirect) elements.inputs.unitFallback.focus();
        }
        const sel = unitList.find(u => u.단원명 === elements.inputs.unit.value);
        if (sel?.차시수 && elements.inputs.lesson) {
            elements.inputs.lesson.max = sel.차시수;
            elements.inputs.lesson.placeholder = `1~${sel.차시수}차시`;
        }
    });

    // 칸 클릭 시 클립보드 복사
    elements.yakanOutput?.addEventListener('click', async (e) => {
        const cell = e.target.closest('td, th');
        if (!cell) return;
        const text = cell.innerText?.trim();
        if (!text) return;
        try {
            await navigator.clipboard.writeText(text);
            showToast('복사됨');
        } catch (err) {
            showToast('복사 실패');
        }
    });
});

function setUnitSelectEmpty(message) {
    const sel = elements.inputs.unit;
    if (!sel) return;
    sel.innerHTML = '';
    const opt = document.createElement('option');
    opt.value = '';
    opt.textContent = message || '교과·학년 선택 후 단원 로드';
    sel.appendChild(opt);
    const directOpt = document.createElement('option');
    directOpt.value = '__direct__';
    directOpt.textContent = '직접 입력';
    sel.appendChild(directOpt);
    unitList = [];
}

function getGradeBand(grade) {
    const g = parseInt(grade, 10);
    if (g <= 2) return '1~2학년';
    if (g <= 4) return '3~4학년';
    return '5~6학년';
}

/** 교수·학습 모형은 AI가 차시별로 추천 (생성 완료 후 자동 입력) */

function fillUnitSelect(units) {
    const sel = elements.inputs.unit;
    if (!sel) return;
    unitList = Array.isArray(units) ? units : [];
    sel.innerHTML = '';
    if (unitList.length > 0) {
        unitList.forEach(u => {
            const opt = document.createElement('option');
            opt.value = u.단원명 || u.단원;
            opt.textContent = `${u.단원명 || u.단원}${u.차시수 ? ` (${u.차시수}차시)` : ''}`;
            sel.appendChild(opt);
        });
        const directOpt = document.createElement('option');
        directOpt.value = '__direct__';
        directOpt.textContent = '직접 입력';
        sel.appendChild(directOpt);
    } else {
        setUnitSelectEmpty('연간지도 계획에 해당 교과·학년 데이터 없음');
    }
    if (elements.inputs.unitFallback) elements.inputs.unitFallback.classList.add('hidden');
}

/** API 실패 시 연간지도 JSON을 직접 불러와 단원 목록 채우기 */
async function fetchUnitsFromPlanJson(subject, grade) {
    const gradeBand = getGradeBand(grade);
    try {
        const res = await fetch(`${API_BASE}/연간지도_계획.json`);
        if (!res.ok) return null;
        const plan = await res.json();
        if (!Array.isArray(plan)) return null;
        let entry = plan.find(p => p.교과 === subject && p.학년 === String(grade));
        if (!entry) entry = plan.find(p => p.교과 === subject && p.학년군 === gradeBand);
        if (!entry || !entry.단원목록 || entry.단원목록.length === 0) return null;
        return entry.단원목록.map(u => ({
            단원번호: u.단원번호,
            단원명: u.단원명,
            차시수: u.차시수,
            주요_학습_내용_및_활동: u.주요_학습_내용_및_활동
        }));
    } catch (_) {
        return null;
    }
}

async function fetchUnits() {
    const subject = elements.inputs.subject?.value?.trim();
    const grade = elements.inputs.grade?.value;
    if (!subject || !grade) {
        setUnitSelectEmpty('교과와 학년을 선택하세요');
        return;
    }

    if (unitsFetchController) unitsFetchController.abort();
    unitsFetchController = new AbortController();
    const signal = unitsFetchController.signal;

    const sel = elements.inputs.unit;
    sel.innerHTML = '<option value="">단원 불러오는 중...</option>';

    const applyUnits = (units) => {
        if (elements.inputs.subject?.value !== subject || elements.inputs.grade?.value !== grade) return;
        fillUnitSelect(units);
        if (units.length > 0) showToast(`단원 ${units.length}개 불러왔습니다.`);
    };

    try {
        const url = `${API_BASE}/api/units?subject=${encodeURIComponent(subject)}&grade=${encodeURIComponent(grade)}`;
        const res = await fetch(url, { signal });
        if (elements.inputs.subject?.value !== subject || elements.inputs.grade?.value !== grade) return;
        if (res.ok) {
            const data = await res.json();
            const units = Array.isArray(data.units) ? data.units : [];
            applyUnits(units);
            return;
        }
        const units = await fetchUnitsFromPlanJson(subject, grade);
        if (units && units.length > 0) {
            applyUnits(units);
            return;
        }
        let msg = '단원 목록을 불러올 수 없습니다.';
        try {
            const err = await res.json().catch(() => ({}));
            if (err.error) msg = err.error;
        } catch (_) {}
        setUnitSelectEmpty(msg);
        showToast('서버에 연결되지 않았습니다. 주소창에 http://localhost:3000 을 입력한 뒤 새로고침하고 [단원 불러오기]를 다시 클릭해보세요.');
    } catch (e) {
        if (e.name === 'AbortError') return;
        console.warn('단원 목록 조회 실패:', e);
        if (elements.inputs.subject?.value !== subject || elements.inputs.grade?.value !== grade) return;
        const units = await fetchUnitsFromPlanJson(subject, grade);
        if (units && units.length > 0) {
            applyUnits(units);
            return;
        }
        setUnitSelectEmpty('서버 연결 실패');
        showToast('주소창에 http://localhost:3000 을 입력해 열고, 터미널에서 npm start 실행 후 [단원 불러오기]를 클릭해주세요.');
    }
}

async function handleGenerate() {
    let unitVal = elements.inputs.unit?.value;
    const unitName = unitVal === '__direct__' ? (elements.inputs.unitFallback?.value?.trim() || '') : unitVal;

    const inputData = {
        grade: elements.inputs.grade.value,
        semester: elements.inputs.semester.value,
        subject: elements.inputs.subject.value,
        unit: unitName || elements.inputs.unit?.value,
        lesson: elements.inputs.lesson.value,
        unitName: unitName || unitVal,
    };

    if (!inputData.subject || !inputData.lesson) {
        showToast('교과목과 차시를 입력해주세요.');
        return;
    }
    if (!unitName) {
        showToast('단원을 선택하거나 직접 입력해주세요.');
        return;
    }

    elements.generateBtn.innerText = '생성 중...';
    elements.generateBtn.disabled = true;

    try {
        const response = await fetch(`${API_BASE}/api/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(inputData),
        });

        if (!response.ok) {
            const errData = await response.json().catch(() => ({}));
            throw new Error(errData.details || errData.error || `API 호출 실패 (${response.status})`);
        }

        const result = await response.json();
        lastGeneratedData = result;
        if (result.model && elements.inputs.model) elements.inputs.model.value = result.model;
        renderYakanFormat(result);

        elements.resultSection.classList.remove('hidden');
        elements.resultSection.scrollIntoView({ behavior: 'smooth' });
    } catch (error) {
        console.error(error);
        const msg = error.message || '과정안 생성 중 오류가 발생했습니다.';
        if (msg.includes('Failed to fetch') || msg.includes('NetworkError') || msg.includes('ERR_CONNECTION')) {
            showToast('서버에 연결할 수 없습니다. "npm start"로 로컬 서버를 실행한 뒤 http://localhost:3000 으로 접속해주세요.');
        } else {
            showToast(msg);
        }
    } finally {
        elements.generateBtn.innerText = '과정안 생성 시작';
        elements.generateBtn.disabled = false;
    }
}

function toDisplayText(value) {
    if (value == null || value === '') return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(v => typeof v === 'string' ? v : toDisplayText(v)).join('\n');
    if (typeof value === 'object') {
        if (value.text) return value.text;
        if (value.content) return value.content;
        return Object.entries(value).map(([k, v]) => `${k}: ${toDisplayText(v)}`).join('\n');
    }
    return String(value);
}

function escapeHtml(s) {
    if (!s) return '';
    const div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
}

/** 교사·학생 내용에 기호(●, ○, -)가 없으면 문장별로 - 붙임. 문장은 줄바꿈 또는 . ? ! 로 구분 */
function formatWithSymbols(text) {
    if (!text || typeof text !== 'string') return text;
    const hasSymbol = (s) => /^(●|○|[-–—]\s?)/.test((s || '').trim());
    let parts = text.split(/\n/).filter((s) => s.trim());
    if (parts.length <= 1 && parts[0]) {
        const s = parts[0];
        if (!hasSymbol(s)) {
            const sentences = s.split(/(?<=[.?!])\s+/).filter((x) => x.trim());
            parts = sentences.length > 1 ? sentences : [s];
        }
    }
    if (parts.length === 0) return text;
    return parts.map((line) => (hasSymbol(line) ? line : `- ${line.trim()}`)).join('\n');
}

/** 교수·학습 활동 행 렌더링 (수학과 예시 형식: 교사|학생|시간|자료·유의점·평가) */
function renderActivitiesRows(activities) {
    if (Array.isArray(activities) && activities.length > 0) {
        return activities.map((a) => {
            const 교사 = toKoreanOnly(toDisplayText(a.교사 || ''));
            const 학생 = toKoreanOnly(toDisplayText(a.학생 || ''));
            const 형태 = toDisplayText(a.형태 || '');
            const 시간 = toDisplayText(a.시간 || '');
            const 자료 = toDisplayText(a.자료 || '');
            const 유의점 = toDisplayText(a.유의점 || '');
            const 평가 = toDisplayText(a.평가 || '');
            const 자료유의점평가 = [
                자료 ? `자료(◎) ${escapeHtml(자료).replace(/\n/g, '<br>')}` : '',
                유의점 ? `유의점(유) ${escapeHtml(유의점).replace(/\n/g, '<br>')}` : '',
                평가 ? `평가(㉞) ${escapeHtml(평가).replace(/\n/g, '<br>')}` : ''
            ].filter(Boolean).join('<br><br>');
            const 교사Formatted = formatWithSymbols(교사 || '◉');
            const 학생Formatted = formatWithSymbols(학생 || '◦');
            const 교사Escaped = escapeHtml(교사Formatted).replace(/\n/g, '<br>');
            const 학생Escaped = escapeHtml(학생Formatted).replace(/\n/g, '<br>');
            return `<tr>
        <td>${escapeHtml(a.단계 || '')}</td>
        <td>${escapeHtml(형태)}</td>
        <td>${교사Escaped}</td>
        <td>${학생Escaped || '◦'}</td>
        <td>${escapeHtml(시간)}</td>
        <td>${자료유의점평가}</td>
      </tr>`;
        }).join('');
    }
    const activitiesText = toKoreanOnly(toDisplayText(activities));
    return `<tr>
      <td>도입/전개/정리</td>
      <td></td>
      <td>${escapeHtml(activitiesText).replace(/\n/g, '<br>') || '◉'}</td>
      <td>◦</td>
      <td></td>
      <td></td>
    </tr>`;
}

/** Fallback DOCX용 activities 포맷 (배열이면 교사/학생 구분) */
function formatActivitiesForFallback(activities) {
    if (Array.isArray(activities) && activities.length > 0) {
        return activities.map((a) => {
            const 교사 = toKoreanOnly(toDisplayText(a.교사));
            const 학생 = toKoreanOnly(toDisplayText(a.학생));
            return `[${a.단계 || ''}] 교사: ${교사}\n학생: ${학생}`;
        }).join('\n\n');
    }
    return toKoreanOnly(toDisplayText(activities));
}

/** 평가 계획 표 렌더링 (범주/평가요소/수준/피드백) */
function renderEvaluationPlan(evaluationPlan, feedback) {
    if (Array.isArray(evaluationPlan) && evaluationPlan.length > 0) {
        const rows = evaluationPlan.map((ep) => {
            const cat = escapeHtml(toDisplayText(ep.category || ''));
            const el = escapeHtml(toDisplayText(ep.element || '')).replace(/\n/g, '<br>');
            const h = escapeHtml(toDisplayText(ep.high || '')).replace(/\n/g, '<br>');
            const m = escapeHtml(toDisplayText(ep.middle || '')).replace(/\n/g, '<br>');
            const l = escapeHtml(toDisplayText(ep.low || '')).replace(/\n/g, '<br>');
            const fb = escapeHtml(toDisplayText(ep.feedback || '')).replace(/\n/g, '<br>');
            return `<tr><td>${cat}</td><td>${el}</td><td>${h}</td><td>${m}</td><td>${l}</td><td>${fb}</td></tr>`;
        }).join('');
        return `<table class="yakan-table yakan-eval"><thead><tr><th>범주(평가 방법)</th><th>평가 요소</th><th colspan="3">수준</th><th>피드백</th></tr><tr><th></th><th></th><th>상</th><th>중</th><th>하</th><th></th></tr></thead><tbody>${rows}</tbody></table>`;
    }
    return escapeHtml((feedback || '').replace(/\n/g, '<br>')) || '-';
}

/** AI가 넣은 영문 레이블을 한글로 치환 (표시용) */
function toKoreanOnly(text) {
    if (!text || typeof text !== 'string') return text;
    return text
        .replace(/\bcore\s*:\s*/gi, '교과 역량: ')
        .replace(/\barea\s*:\s*/gi, '영역: ')
        .replace(/\boriginal\s*:\s*/gi, '성취기준: ')
        .replace(/\brestated\s*:\s*/gi, '재진술: ')
        .trim();
}

/** 약안 서식 양식 그대로 HTML 렌더링 */
function renderYakanFormat(data) {
    const subj = elements.inputs.subject?.value || '';
    const unitVal = elements.inputs.unit?.value === '__direct__'
        ? (elements.inputs.unitFallback?.value || '')
        : (elements.inputs.unit?.value || '');
    const lessonVal = elements.inputs.lesson?.value || '';
    const totalLesson = unitList.find(u => u.단원명 === unitVal)?.차시수 || '';

    const competency = toKoreanOnly(toDisplayText(data.competency));
    const area = toKoreanOnly(toDisplayText(data.area));
    const coreIdea = toKoreanOnly(toDisplayText(data.coreIdea));
    const standard = toKoreanOnly(toDisplayText(data.standard));
    const question = toKoreanOnly(toDisplayText(data.question));
    const objective = toKoreanOnly(toDisplayText(data.objective));
    const topic = toKoreanOnly(toDisplayText(data.topic));
    const intent = toKoreanOnly(toDisplayText(data.intent));
    const feedback = toKoreanOnly(toDisplayText(data.feedback));

    const target = elements.inputs.target?.value || `${elements.inputs.grade?.value || ''}학년 0반`;
    const date = elements.inputs.date?.value || '';
    const model = (data.model || elements.inputs.model?.value || '').trim();

    const html = `
<div class="yakan-document">
  <div class="yakan-title">2022 개정 교육과정 적용 교수·학습 과정안(약안 서식)</div>
  <div class="yakan-subtitle">(${escapeHtml(subj)}) 교수·학습 과정안</div>

  <table class="yakan-table yakan-header">
    <tr>
      <th>단원</th>
      <th>대상</th>
      <th>일시</th>
    </tr>
    <tr>
      <td>${escapeHtml(unitVal)}</td>
      <td>${escapeHtml(target)}</td>
      <td>${escapeHtml(date)}</td>
    </tr>
  </table>

  <table class="yakan-table yakan-chasi">
    <tr>
      <th>차시</th>
      <th>교수·학습 모형</th>
    </tr>
    <tr>
      <td>${lessonVal}${totalLesson ? `/${totalLesson}` : ''}</td>
      <td>${escapeHtml(model) || '지도서 각론 등에서 확인'}</td>
    </tr>
  </table>

  <div class="yakan-section-title">교육과정 분석 (차시)</div>
  <table class="yakan-table yakan-analysis">
    <tr><th>교과 역량</th><td>${escapeHtml(competency).replace(/\n/g, '<br>') || '-'}</td></tr>
    <tr><th>영역</th><td>${escapeHtml(area || '해당 교과 교육과정에서 기재')}</td></tr>
    <tr><th>핵심 아이디어</th><td>${escapeHtml(coreIdea).replace(/\n/g, '<br>') || '-'}</td></tr>
    <tr><th>성취기준</th><td>${escapeHtml(standard).replace(/\n/g, '<br>') || '-'}</td></tr>
    <tr><th>탐구 질문</th><td>${escapeHtml(question).replace(/\n/g, '<br>') || '-'}</td></tr>
  </table>

  <table class="yakan-table yakan-goals">
    <tr><th>학습 목표</th><td>${escapeHtml(objective).replace(/\n/g, '<br>') || '-'}</td></tr>
    <tr><th>학습 주제</th><td>${escapeHtml(topic).replace(/\n/g, '<br>') || '-'}</td></tr>
    <tr><th>수업자 의도<br>(수업·평가 주안점)</th><td>${escapeHtml(intent).replace(/\n/g, '<br>') || '-'}</td></tr>
    <tr><th>평가 계획</th><td>${renderEvaluationPlan(data.evaluationPlan, feedback)}</td></tr>
  </table>

  <div class="yakan-section-title">교수·학습 활동</div>
  <table class="yakan-table yakan-activities">
    <thead>
      <tr>
        <th>학습<br>단계</th>
        <th>학습형태</th>
        <th>교사</th>
        <th>학생</th>
        <th>시간<br>(분)</th>
        <th>자료(◎) 유의점(유) 평가(㉞)</th>
      </tr>
    </thead>
    <tbody>
      ${renderActivitiesRows(data.activities)}
    </tbody>
  </table>
</div>`;

    elements.yakanOutput.innerHTML = html;
}

function handleDownload() {
    if (!lastGeneratedData) {
        showToast('먼저 과정안을 생성해주세요.');
        return;
    }
    const { Document, Packer, Paragraph, TextRun } = docx;
    const d = lastGeneratedData;
    const subj = elements.inputs.subject?.value || '';
    const unitVal = elements.inputs.unit?.value === '__direct__'
        ? (elements.inputs.unitFallback?.value || '')
        : (elements.inputs.unit?.value || '');
    const lessonVal = elements.inputs.lesson?.value || '';
    const target = elements.inputs.target?.value || '';
    const date = elements.inputs.date?.value || '';
    const model = (d.model || elements.inputs.model?.value || '').trim();

    const Table = docx.Table;
    const TableRow = docx.TableRow;
    const TableCell = docx.TableCell;
    if (!Table || !TableRow || !TableCell) {
        handleDownloadFallback(d, subj, unitVal, lessonVal);
        return;
    }

    const p = (text) => new Paragraph({ children: [new TextRun({ text: String(text || '-') })] });
    const cell = (content) => new TableCell({
        children: [content instanceof Paragraph ? content : p(content)],
    });

    const headerRow = new TableRow({
        children: [
            cell('단원'),
            cell('대상'),
            cell('일시'),
        ],
    });
    const headerDataRow = new TableRow({
        children: [cell(unitVal), cell(target), cell(date)],
    });

    const chasiRow = new TableRow({
        children: [cell('차시'), cell('교수·학습 모형')],
    });
    const chasiDataRow = new TableRow({
        children: [cell(`${lessonVal}차시`), cell(model || '지도서 각론 등에서 확인')],
    });

    const analysisRows = [
        new TableRow({ children: [cell('교과 역량'), cell(toKoreanOnly(toDisplayText(d.competency)))] }),
        new TableRow({ children: [cell('영역'), cell(toKoreanOnly(toDisplayText(d.area)) || '해당 교과 교육과정에서 기재')] }),
        new TableRow({ children: [cell('핵심 아이디어'), cell(toKoreanOnly(toDisplayText(d.coreIdea)))] }),
        new TableRow({ children: [cell('성취기준'), cell(toKoreanOnly(toDisplayText(d.standard)))] }),
        new TableRow({ children: [cell('탐구 질문'), cell(toKoreanOnly(toDisplayText(d.question)))] }),
    ];

    const evalPlanText = Array.isArray(d.evaluationPlan) && d.evaluationPlan.length > 0
        ? d.evaluationPlan.map(ep =>
            `${toDisplayText(ep.category)} | ${toDisplayText(ep.element)} | 상:${toDisplayText(ep.high)} 중:${toDisplayText(ep.middle)} 하:${toDisplayText(ep.low)} | ${toDisplayText(ep.feedback)}`
        ).join('\n')
        : toDisplayText(d.feedback);

    const goalRows = [
        new TableRow({ children: [cell('학습 목표'), cell(toKoreanOnly(toDisplayText(d.objective)))] }),
        new TableRow({ children: [cell('학습 주제'), cell(toKoreanOnly(toDisplayText(d.topic)))] }),
        new TableRow({ children: [cell('수업자 의도'), cell(toKoreanOnly(toDisplayText(d.intent)))] }),
        new TableRow({ children: [cell('평가 계획'), cell(toKoreanOnly(evalPlanText))] }),
    ];

    const activityHeaderRow = new TableRow({
        children: [
            cell('학습 단계'),
            cell('학습형태'),
            cell('활동'),
            cell('교사'),
            cell('학생'),
            cell('시간(분)'),
            cell('자료'),
            cell('유의점'),
            cell('평가'),
        ],
    });
    const activityDataRows = Array.isArray(d.activities) && d.activities.length > 0
        ? d.activities.map((a) => new TableRow({
            children: [
                cell(a.단계 || ''),
                cell(toDisplayText(a.형태)),
                cell(toKoreanOnly(toDisplayText(a.활동))),
                cell(toKoreanOnly(toDisplayText(a.교사)) || '◉'),
                cell(toKoreanOnly(toDisplayText(a.학생)) || '◦'),
                cell(toDisplayText(a.시간)),
                cell(toDisplayText(a.자료)),
                cell(toDisplayText(a.유의점)),
                cell(toDisplayText(a.평가)),
            ],
        }))
        : [new TableRow({
            children: [
                cell('도입/전개/정리'),
                cell(''),
                cell(toKoreanOnly(toDisplayText(d.activities))),
                cell('◉'),
                cell('◦'),
                cell(''),
                cell(''),
                cell(''),
                cell(''),
            ],
        })];

    const children = [
        new Paragraph({ text: '2022 개정 교육과정 적용 교수·학습 과정안(약안 서식)', heading: 'Heading1' }),
        new Paragraph({ text: `(${subj}) 교수·학습 과정안`, heading: 'Heading2' }),
        new Paragraph({ text: '' }),
        new Table({ rows: [headerRow, headerDataRow] }),
        new Paragraph({ text: '' }),
        new Table({ rows: [chasiRow, chasiDataRow] }),
        new Paragraph({ text: '교육과정 분석 (차시)', heading: 'Heading3' }),
        new Table({ rows: analysisRows }),
        new Paragraph({ text: '학습 목표·수업자 의도·평가 계획', heading: 'Heading3' }),
        new Table({ rows: goalRows }),
        new Paragraph({ text: '교수·학습 활동', heading: 'Heading3' }),
        new Table({ rows: [activityHeaderRow, ...activityDataRows] }),
    ];

    const doc = new Document({ sections: [{ children }] });

    Packer.toBlob(doc).then(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `교수학습과정안_${subj}_${unitVal}_${lessonVal}차시.docx`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('DOCX 파일이 다운로드되었습니다.');
    });
}

function handleDownloadFallback(d, subj, unitVal, lessonVal) {
    const { Document, Packer, Paragraph } = docx;
    const children = [
        new Paragraph({ text: '2022 개정 교육과정 적용 교수·학습 과정안(약안 서식)', heading: 'Heading1' }),
        new Paragraph({ text: `(${subj}) 교수·학습 과정안`, heading: 'Heading2' }),
        new Paragraph({ text: `단원: ${unitVal} | 차시: ${lessonVal}차시` }),
        new Paragraph({ text: '' }),
        new Paragraph({ text: '교과 역량', heading: 'Heading4' }),
        new Paragraph({ text: toKoreanOnly(toDisplayText(d.competency)) }),
        new Paragraph({ text: '성취기준', heading: 'Heading4' }),
        new Paragraph({ text: toKoreanOnly(toDisplayText(d.standard)) }),
        new Paragraph({ text: '탐구 질문', heading: 'Heading4' }),
        new Paragraph({ text: toKoreanOnly(toDisplayText(d.question)) }),
        new Paragraph({ text: '학습 목표', heading: 'Heading4' }),
        new Paragraph({ text: toKoreanOnly(toDisplayText(d.objective)) }),
        new Paragraph({ text: '수업자 의도', heading: 'Heading4' }),
        new Paragraph({ text: toKoreanOnly(toDisplayText(d.intent)) }),
        new Paragraph({ text: '평가 계획', heading: 'Heading4' }),
        new Paragraph({ text: toKoreanOnly(toDisplayText(d.feedback)) }),
        new Paragraph({ text: '교수·학습 활동', heading: 'Heading4' }),
        new Paragraph({ text: formatActivitiesForFallback(d.activities) }),
    ];
    const doc = new Document({ sections: [{ children }] });
    docx.Packer.toBlob(doc).then(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `교수학습과정안_${subj}_${unitVal}_${lessonVal}차시.docx`;
        a.click();
        URL.revokeObjectURL(url);
        showToast('DOCX 파일이 다운로드되었습니다.');
    });
}

function handlePrintPdf() {
    if (!lastGeneratedData) {
        showToast('먼저 과정안을 생성해주세요.');
        return;
    }
    window.print();
}

async function handleLearningSheet() {
    if (!lastGeneratedData) {
        showToast('먼저 과정안을 생성한 뒤 학습지를 만들 수 있습니다.');
        return;
    }
    const unitVal = elements.inputs.unit?.value === '__direct__'
        ? (elements.inputs.unitFallback?.value || '')
        : (elements.inputs.unit?.value || '');
    const payload = {
        grade: elements.inputs.grade?.value,
        subject: elements.inputs.subject?.value,
        unitName: unitVal,
        lesson: elements.inputs.lesson?.value,
        topic: lastGeneratedData.topic,
        objective: lastGeneratedData.objective,
        question: lastGeneratedData.question,
    };
    elements.learningSheetBtn.disabled = true;
    elements.learningSheetBtn.textContent = '학습지 생성 중...';
    try {
        const res = await fetch(`${API_BASE}/api/learning-sheet`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            throw new Error(err.details || err.error || `오류 ${res.status}`);
        }
        const { html, answerHtml } = await res.json();
        if (!html) throw new Error('학습지 내용이 비어 있습니다.');
        elements.learningSheetIframe.srcdoc = html;
        if (answerHtml) {
            elements.learningSheetAnswerIframe.srcdoc = answerHtml;
        } else {
            elements.learningSheetAnswerIframe.srcdoc = '<!DOCTYPE html><html lang="ko"><body><p>답안지가 생성되지 않았습니다.</p></body></html>';
        }
        elements.learningSheetIframe.onload = () => {
            try {
                const doc = elements.learningSheetIframe.contentDocument;
                if (doc?.body) {
                    doc.body.contentEditable = 'true';
                    doc.body.style.minHeight = '100%';
                }
            } catch (_) { /* cross-origin 등 */ }
        };
        if (elements.learningSheetIframe.contentDocument?.body) {
            elements.learningSheetIframe.contentDocument.body.contentEditable = 'true';
        }
        switchLearningSheetTab('sheet');
        elements.learningSheetSection?.classList.remove('hidden');
        elements.learningSheetSection?.scrollIntoView({ behavior: 'smooth' });
        showToast('학습지와 답안지가 생성되었습니다. 학습지는 수정 후 인쇄할 수 있습니다.');
    } catch (e) {
        showToast(e.message || '학습지 생성에 실패했습니다.');
    } finally {
        elements.learningSheetBtn.disabled = false;
        elements.learningSheetBtn.textContent = '학습지 PDF 만들기';
    }
}

function handleLearningSheetTab(e) {
    const tab = e.target.closest('.learning-sheet-tab');
    if (!tab?.dataset.tab) return;
    switchLearningSheetTab(tab.dataset.tab);
}

function switchLearningSheetTab(tabId) {
    const panes = document.querySelectorAll('.learning-sheet-pane');
    elements.learningSheetTabs?.forEach((t) => {
        t.classList.toggle('active', t.dataset.tab === tabId);
        t.setAttribute('aria-selected', t.dataset.tab === tabId ? 'true' : 'false');
    });
    panes.forEach((p) => {
        p.classList.toggle('active', (p.id === 'learning-sheet-iframe' && tabId === 'sheet') || (p.id === 'learning-sheet-answer-iframe' && tabId === 'answer'));
    });
}

function handleLearningSheetPrint() {
    const iframe = elements.learningSheetIframe;
    if (!iframe?.contentWindow) return;
    iframe.contentWindow.print();
}

function handleLearningSheetAnswerPrint() {
    const iframe = elements.learningSheetAnswerIframe;
    if (!iframe?.contentWindow) return;
    iframe.contentWindow.print();
}

function handleLearningSheetClose() {
    elements.learningSheetSection?.classList.add('hidden');
}

function showToast(message) {
    elements.toast.innerText = message;
    elements.toast.classList.remove('hidden');
    setTimeout(() => elements.toast.classList.add('hidden'), 3000);
}
