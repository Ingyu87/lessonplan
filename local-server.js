const express = require('express');
const dotenv = require('dotenv');
const path = require('path');
const fs = require('fs');

dotenv.config();

const app = express();
const port = 3000;

app.use(express.json());
app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') return res.sendStatus(200);
    next();
});
const baseDir = path.resolve(__dirname);

function getGradeBand(grade) {
    const g = parseInt(grade, 10);
    if (g <= 2) return '1~2학년';
    if (g <= 4) return '3~4학년';
    return '5~6학년';
}

/** AI로 핵심 아이디어 생성 (파일에 없을 때 폴백) */
async function generateCoreIdeaByAI(apiKey, subject, area, unitName) {
    if (!apiKey) return '';
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
        const prompt = `${subject} 교과 ${area || '해당'} 영역의 핵심 아이디어를 2022 개정 교육과정 스타일로 한 문단(2~4문장)으로 작성하세요. 영역의 핵심 개념만 진술하고, 성취기준 코드([4국03-02] 등)는 넣지 마세요.${unitName ? ` (단원: ${unitName})` : ''}`;
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: { maxOutputTokens: 300 }
            })
        });
        if (!res.ok) return '';
        const data = await res.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return text.trim();
    } catch (e) {
        console.warn('AI 핵심아이디어 생성 실패:', e.message);
        return '';
    }
}

/** 핵심아이디어.txt에서 해당 교과·영역의 핵심 아이디어 추출 */
function getCoreIdeaFromFile(subject, area) {
    try {
        const corePath = path.join(baseDir, '핵심아이디어.txt');
        if (!fs.existsSync(corePath)) return '';
        const core = JSON.parse(fs.readFileSync(corePath, 'utf8'));
        const norm = (s) => (s || '').replace(/[·⋅]/g, '·').trim();
        const areaNorm = norm(area);
        const found = core.find(c => c.교과 === subject && c.영역 && (
            norm(c.영역) === areaNorm || norm(c.영역).includes(areaNorm) || areaNorm.includes(norm(c.영역))
        ));
        return found ? (found['핵심 아이디어'] || '') : '';
    } catch (e) { return ''; }
}

/** 성취기준에서 해당 단원·차시의 영역 추출 (AI가 area를 비워둘 때 폴백) */
function getAreaFromStandards(subject, gradeBand, unitName) {
    try {
        const standardsPath = path.join(baseDir, '2022개정교육과정 성취기준 및 해설.json');
        if (!fs.existsSync(standardsPath)) return '';
        const standards = JSON.parse(fs.readFileSync(standardsPath, 'utf8'));
        let filtered = standards.filter(s => s.교과 === subject && s.학년 === gradeBand);
        if (unitName) {
            const u = String(unitName);
            const unitFiltered = filtered.filter(s => s.단원 && (
                s.단원.includes(u) || u.includes(s.단원) || s.단원 === u
            ));
            if (unitFiltered.length > 0) filtered = unitFiltered;
            else if (u.includes('독서')) {
                const r = filtered.find(s => s.영역 === '읽기');
                if (r) return r.영역;
            } else if (u.includes('매체')) {
                const r = filtered.find(s => s.영역 === '매체');
                if (r) return r.영역;
            } else if (u.includes('문학')) {
                const r = filtered.find(s => s.영역 === '문학');
                if (r) return r.영역;
            }
        }
        const first = filtered[0];
        return first && first.영역 ? first.영역 : '';
    } catch (e) { return ''; }
}

// 연간지도 계획 로드 (연간지도_계획.json 또는 연간지도_계획_템플릿.json)
function loadAnnualPlan() {
    const planPath = path.join(baseDir, '연간지도_계획.json');
    const templatePath = path.join(baseDir, '연간지도_계획_템플릿.json');
    try {
        if (fs.existsSync(planPath)) {
            const data = JSON.parse(fs.readFileSync(planPath, 'utf8'));
            if (Array.isArray(data) && data.length > 0) return data;
        }
        if (fs.existsSync(templatePath)) {
            return JSON.parse(fs.readFileSync(templatePath, 'utf8'));
        }
    } catch (e) {
        console.warn('연간지도 계획 로드 실패:', e.message);
    }
    return [];
}

// 단원 목록 조회: 연간지도 계획 우선, 없으면 성취기준에서 추출
function getUnitList(subject, grade) {
    const gradeBand = getGradeBand(grade);
    const annualPlan = loadAnnualPlan();
    const gradeStr = String(grade);

    // 학년 정확 일치 우선 (4학년 선택 시 3학년 데이터가 반환되지 않도록)
    let planEntry = annualPlan.find(p => p.교과 === subject && p.학년 === gradeStr);
    if (!planEntry) planEntry = annualPlan.find(p => p.교과 === subject && p.학년군 === gradeBand);
    if (planEntry && planEntry.단원목록 && planEntry.단원목록.length > 0) {
        return planEntry.단원목록.map(u => ({
            단원번호: u.단원번호,
            단원명: u.단원명,
            차시수: u.차시수,
            주요_학습_내용_및_활동: u.주요_학습_내용_및_활동
        }));
    }

    // 성취기준에서 단원 추출 (단원이 있는 교과만)
    try {
        const standardsPath = path.join(baseDir, '2022개정교육과정 성취기준 및 해설.json');
        if (fs.existsSync(standardsPath)) {
            const standards = JSON.parse(fs.readFileSync(standardsPath, 'utf8'));
            const filtered = standards.filter(s => s.교과 === subject && s.학년 === gradeBand && s.단원);
            const unitMap = new Map();
            filtered.forEach(s => {
                if (s.단원 && !unitMap.has(s.단원)) {
                    unitMap.set(s.단원, { 단원명: s.단원, 차시수: null, 주요_학습_내용_및_활동: null });
                }
            });
            return Array.from(unitMap.entries()).map(([name, v], i) => ({
                단원번호: i + 1,
                단원명: name,
                차시수: v.차시수,
                주요_학습_내용_및_활동: v.주요_학습_내용_및_활동
            }));
        }
    } catch (e) {
        console.warn('성취기준 단원 추출 실패:', e.message);
    }
    return [];
}

// 장학자료 로드 (장학자료 폴더 우선, 없으면 장학자료_텍스트.txt)
function loadJanghakMaterials(subject) {
    const dir = path.join(baseDir, '장학자료');
    const maxLen = 5000;
    try {
        if (fs.existsSync(dir)) {
            const files = fs.readdirSync(dir);
            const match = files.find(f => f.includes(subject) && (f.endsWith('.txt') || f.endsWith('.json')));
            if (match) {
                const content = fs.readFileSync(path.join(dir, match), 'utf8');
                return content.length > maxLen ? content.substring(0, maxLen) + '\n...(이하 생략)' : content;
            }
        }
        const fallbackPath = path.join(baseDir, '장학자료_텍스트.txt');
        if (fs.existsSync(fallbackPath)) {
            const content = fs.readFileSync(fallbackPath, 'utf8');
            return content.length > maxLen ? content.substring(0, maxLen) + '\n...(이하 생략)' : content;
        }
    } catch (e) {}
    return '';
}

// 참고 자료 로드 (단원명 포함 시 해당 단원 성취기준·주요 학습 내용 반영)
function loadReferenceMaterials(subject, grade, unitName, lesson) {
    const gradeBand = getGradeBand(grade);
    let context = '';

    // 1. 연간지도 계획 - 주요 학습 내용 및 활동
    const annualPlan = loadAnnualPlan();
    const planEntry = annualPlan.find(p => p.교과 === subject && (p.학년 === grade || p.학년군 === gradeBand));
    if (planEntry && planEntry.단원목록) {
        const unitInfo = planEntry.단원목록.find(u =>
            u.단원명 === unitName || String(u.단원번호) === String(unitName) || (u.단원명 && u.단원명.includes(unitName))
        );
        if (unitInfo) {
            context += '\n[연간지도 계획 - 해당 단원]\n';
            context += `- 단원명: ${unitInfo.단원명}\n`;
            context += `- 차시수: ${unitInfo.차시수 || '-'}\n`;
            const lessonNum = parseInt(lesson, 10);
            if (unitInfo.차시별_주요_활동 && Array.isArray(unitInfo.차시별_주요_활동) && !isNaN(lessonNum)) {
                const matches = unitInfo.차시별_주요_활동.filter((c) => {
                    const m = (c.차시 || '').match(/^(\d+)(?:~(\d+))?$/);
                    if (!m) return false;
                    const start = parseInt(m[1], 10);
                    const end = m[2] ? parseInt(m[2], 10) : start;
                    return lessonNum >= start && lessonNum <= end;
                });
                const rangeOf = (c) => {
                    const m = (c.차시 || '').match(/^(\d+)(?:~(\d+))?$/);
                    if (!m) return 999;
                    const start = parseInt(m[1], 10);
                    const end = m[2] ? parseInt(m[2], 10) : start;
                    return end - start;
                };
                const best = matches.sort((a, b) => rangeOf(a) - rangeOf(b))[0];
                if (best) {
                    context += `- ${lesson}차시 주요 학습 내용 및 활동 (${best.구분 || ''}): ${best.내용 || ''}\n`;
                }
            }
            if (unitInfo.주요_학습_내용_및_활동) {
                context += `- 단원 전체 주요 학습 내용 및 활동: ${unitInfo.주요_학습_내용_및_활동}\n`;
            }
        }
    }

    // 2. 성취기준 (단원 있으면 해당 단원 우선, 해설 전체 반영)
    try {
        const standardsPath = path.join(baseDir, '2022개정교육과정 성취기준 및 해설.json');
        if (fs.existsSync(standardsPath)) {
            const standards = JSON.parse(fs.readFileSync(standardsPath, 'utf8'));
            let filtered = standards.filter(s => s.교과 === subject && s.학년 === gradeBand);
            if (unitName) {
                const unitFiltered = filtered.filter(s => s.단원 && (
                    s.단원.includes(unitName) || String(unitName).includes(s.단원) || s.단원 === unitName ||
                    (unitName.length >= 2 && s.단원.indexOf(unitName.trim()) !== -1)
                ));
                if (unitFiltered.length > 0) filtered = unitFiltered;
            }
            filtered = filtered.slice(0, 18);
            if (filtered.length > 0) {
                context += '\n[성취기준 - 영역 포함]\n';
                filtered.forEach(s => {
                    const areaPart = s.영역 ? ` [영역: ${s.영역}]` : '';
                    const unitPart = s.단원 ? ` [단원: ${s.단원}]` : '';
                    context += `- ${s.성취기준}${areaPart}${unitPart}\n`;
                    if (s['성취기준 해설']) context += `  해설: ${s['성취기준 해설']}\n`;
                });
            }
        }
    } catch (e) {
        console.warn('성취기준 로드 실패:', e.message);
    }

    // 3. 핵심 아이디어 (해당 교과 전체)
    try {
        const corePath = path.join(baseDir, '핵심아이디어.txt');
        if (fs.existsSync(corePath)) {
            const core = JSON.parse(fs.readFileSync(corePath, 'utf8'));
            const filtered = core.filter(c => c.교과 === subject);
            if (filtered.length > 0) {
                context += '\n[핵심 아이디어]\n';
                filtered.forEach(c => {
                    context += `- ${c.영역}: ${c['핵심 아이디어']}\n`;
                });
            }
        }
    } catch (e) {
        console.warn('핵심아이디어 로드 실패:', e.message);
    }

    // 4. 성취기준 적용 시 고려사항 (해당 교과·학년군 전체)
    try {
        const considerPath = path.join(baseDir, '성취기준 적용시 고려사항.txt');
        if (fs.existsSync(considerPath)) {
            const consider = JSON.parse(fs.readFileSync(considerPath, 'utf8'));
            const filtered = consider.filter(c => c.교과 === subject && c.학년군 === gradeBand);
            if (filtered.length > 0) {
                context += '\n[성취기준 적용 시 고려사항]\n';
                filtered.forEach(c => {
                    context += `- ${c.영역}: ${c['성취기준 적용 시 고려사항']}\n`;
                });
            }
        }
    } catch (e) {
        console.warn('고려사항 로드 실패:', e.message);
    }

    // 5. 성취수준 (해당 학년군 JSON에서 교과 섹션 발췌, 분량 확대)
    try {
        const levelFile = gradeBand === '1~2학년' ? '★(초)2022개정교육과정에따른성취수준(1~2학년군).json' :
            gradeBand === '3~4학년' ? '★(초)2022개정교육과정에따른성취수준(3~4학년군).json' :
            '★(초)2022개정교육과정에따른성취수준(5~6학년군).json';
        const levelPath = path.join(baseDir, levelFile);
        if (fs.existsSync(levelPath)) {
            const raw = fs.readFileSync(levelPath, 'utf8');
            const parsed = JSON.parse(raw);
            if (parsed.content && parsed.content.includes(subject)) {
                const idx = parsed.content.indexOf(subject);
                const excerpt = parsed.content.substring(idx, idx + 3500).replace(/\t/g, ' ');
                context += '\n[성취수준 - 해당 교과 발췌]\n';
                context += excerpt + '\n';
            }
        }
    } catch (e) {
        console.warn('성취수준 로드 실패:', e.message);
    }

    // 6. 장학자료
    const janghak = loadJanghakMaterials(subject);
    if (janghak) {
        context += '\n[장학자료]\n' + janghak + '\n';
    }

    // 7. 약안 서식 구조 (2022 개정)
    try {
        const formatPath = path.join(baseDir, '약안_서식_구조.json');
        if (fs.existsSync(formatPath)) {
            const fmt = JSON.parse(fs.readFileSync(formatPath, 'utf8'));
            context += '\n[약안 서식 구조]\n';
            context += `- 섹션: ${fmt.섹션목록?.map(s => s.name).join(', ') || '-'}\n`;
            context += `- 평가범주: ${(fmt.평가범주 || []).join(', ')}\n`;
        }
    } catch (e) {}

    return context;
}

// API 라우트를 static보다 먼저 등록 (api 폴더와 충돌 방지)
app.get('/api/units', (req, res) => {
    const { subject, grade } = req.query;
    if (!subject || !grade) {
        return res.status(400).json({ error: 'subject, grade 필요' });
    }
    const units = getUnitList(subject, grade);
    res.json({ units });
});

// 연간지도 계획 조회 (붙여넣기 UI용)
app.get('/api/plan', (req, res) => {
    try {
        const data = loadAnnualPlan();
        res.json(data);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// 연간지도 계획 저장 (붙여넣은 JSON으로 덮어쓰기)
app.post('/api/plan', (req, res) => {
    const planPath = path.join(baseDir, '연간지도_계획.json');
    let data = req.body;
    if (!Array.isArray(data)) data = data?.data != null ? data.data : (data ? [data] : []);
    try {
        fs.writeFileSync(planPath, JSON.stringify(data, null, 2), 'utf8');
        res.json({ ok: true, count: data.length });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/generate', async (req, res) => {
    const { grade, semester, subject, unit, lesson, unitName } = req.body;
    const apiKey = (process.env.GEMINI_API_KEY || '').trim();

    if (!apiKey) {
        return res.status(500).json({ error: 'API Key not configured in .env file' });
    }

    const modelId = "gemini-2.5-flash";
    const resolvedUnitName = String(unitName || unit || '').replace(/[\u201c\u201d\u2018\u2019\u2026]/g, '');
    const refContext = loadReferenceMaterials(subject || '국어', grade || '3', resolvedUnitName, lesson);
    const refContextClean = refContext.replace(/[\u201c\u201d\u2018\u2019\u2026]/g, (m) => {
        if (m === '\u2026') return '...';
        if (m === '\u2018' || m === '\u2019') return "'";
        return '"';
    });
    console.log('참고 자료 로드 완료, 길이:', refContext.length);

    const systemPrompt = `
당신은 2022 개정 교육과정에 정통한 "초등학교 수업 설계 전문가"입니다. 사용자는 실제 수업을 진행할 초등 교사입니다.
아래 참고 자료를 모두 반영하여, **해당 차시에 맞는 상세하고 실질적으로 진행 가능한** 교수·학습 과정안(약안)을 작성하세요.

[수업 설계 흐름 - 반드시 이 순서로 설계]
1. **역량**을 기르기 위해 **성취기준·핵심아이디어**에 맞춰 **탐구질문**을 도출한다.
2. 그 **탐구질문을 해결하기 위해** **수업목표(objective)**와 **학습 주제(topic)**를 설정한다.
3. **수업·평가 주안점**을 두고 **수업의도(intent)**를 작성한다.
4. 그 **의도에 맞게** **평가계획(evaluationPlan)**을 작성한다.
5. **평가계획을 실행하기 위한 방안**으로 **40분 수업**이 진행된다. 도입·전개·정리로 구성.
6. **차시별 주요활동**에 맞춰 **전개**에서 탐구질문·문제를 해결하기 위해 **3가지 활동**(실현이 어려우면 2가지)을 제시하고, **정리**에서 활동 마무리 활동을 제시한다.

[입력 정보]
- 학년: ${grade}학년, 학기: ${semester}학기, 교과: ${subject}
- 단원: ${resolvedUnitName || unit + '단원'}
- 차시: ${lesson}차시

[필수 반영 사항]
1. 위 [수업 설계 흐름]을 따라 설계하세요. 탐구질문 → 수업목표·주제 → 수업의도 → 평가계획 → 40분 수업(도입·전개·정리) 순서.
2. **연간지도 계획** 해당 차시 "주요 학습 내용 및 활동"을 핵심으로, **성취기준·해설·핵심아이디어**를 반영하여 탐구질문·학습목표·수업자 의도를 구체적으로 작성하세요. 교수·학습 활동: **도입 1행, 전개 3행(활동1·활동2·활동3, 실현 어려우면 2행), 정리 1행** 총 5행(또는 4행)으로 작성하세요.
3. **성취수준** 자료를 참고하여 평가 계획에 지식·이해, 과정·기능, 가치·태도 범주별로 상/중/하 수준을 구체적으로 진술하고, 각 수준에 대한 피드백 방안을 제시하세요.
4. **핵심 아이디어**와 **성취기준 적용 시 고려사항**, **장학자료**를 반영하여 수업 설계와 유의점에 반영하세요.

[작성 원칙 - 상세·실행 가능]
- 수업안은 **상당히 상세하게** 작성하세요. 교사 열에는 **주요 활동**(자료 제시·지도 절차·설명 등)과 **발문**(질문 문장)을 모두 적으세요. 예: "○○○를 실물화상기로 제시한다." "선생님이 지금 무엇을 하고 있나요?"처럼 교사가 하는 구체적 활동을 먼저 쓰고, 그 다음 발문을 적습니다. 학생 열에는 예상 반응, 활동 내용, 산출물, 모둠별 역할 등을 구체적으로 적으세요.
- **실제 수업에서 그대로 진행할 수 있는** 수준으로 작성하세요. 추상적 요약이 아니라 "교사가 할 말·할 일", "학생이 할 말·할 일"이 드러나도록 하세요.
- **교수·학습 활동**은 **도입 1개** + **전개 3개**(활동1·활동2·활동3, 실현 어려우면 2개) + **정리 1개**. 전개에서 탐구질문·문제 해결을 위한 활동, 정리에서 마무리 활동을 제시하세요.
- 모든 문장은 **한국어만** 사용하세요. 영어 레이블(competency, standard 등)은 사용하지 마세요.
- competency: 해당 교과 역량. area: 위 [성취기준]에 나온 해당 차시·단원의 영역.
- coreIdea(핵심 아이디어): [핵심 아이디어] 참고에 해당 영역이 있으면 그걸 기반으로, 해당 차시의 학습 맥락(단원·주요 학습 내용·탐구 질문)에 맞게 재진술. 영역 핵심 아이디어는 그대로 두되, 차시에 맞게 수정·적용 가능. 성취기준 코드([4국03-02] 등) 넣지 말 것.
- standard(성취기준): 해당 차시 성취기준 코드+문장만. 핵심 아이디어 문장 넣지 말 것.
- objective(학습 목표): "~할 수 있다" 형태의 학습 목표 한 문장만.
- topic(학습 주제): 이 차시에서 다루는 구체적 주제·내용 (학습 목표와 구분하여 별도로).
- intent: 수업·평가 주안점을 두고 작성한 수업자의 의도. 이 의도에 맞게 평가계획을 설계한다.
- evaluationPlan: intent(수업의도)에 맞게 평가 계획을 표 형태로 작성. 각 행은 범주(평가 방법), 평가 요소, 수준(상/중/하), 피드백을 포함. 성취수준 자료를 참고하여 지식·이해, 과정·기능, 가치·태도 등 범주별로 1~3행 작성.
- model: 해당 차시·단원에 가장 적합한 교수·학습 모형 추천.

[출력 형식 - 순수 JSON만]
마크다운 코드블록 없이 JSON만 반환하세요.
{
  "competency": "교과 역량",
  "area": "해당 교과 교육과정의 영역 (예: 듣기·말하기, 읽기, 문학, 매체)",
  "coreIdea": "핵심 아이디어 (영역 핵심 아이디어를 기반으로 해당 차시에 맞게 재진술)",
  "standard": "성취기준만 ([4국03-02] 형태 코드+문장. 핵심 아이디어 문장 넣지 말 것)",
  "question": "탐구 질문",
  "objective": "학습 목표 한 문장",
  "topic": "학습 주제",
  "intent": "수업자 의도",
  "feedback": "성취수준(상/중/하) 및 피드백 방안 (evaluationPlan 없을 때 사용)",
  "evaluationPlan": [
    { "category": "지식·이해(관찰)", "element": "평가 요소", "high": "상 수준 진술", "middle": "중 수준 진술", "low": "하 수준 진술", "feedback": "피드백 방안" }
  ],
  "model": "교수·학습 모형",
  "activities": [
    { "단계": "도입", "형태": "전체", "활동": "사전 지식 활성화하기", "교사": "● 사전 지식 활성화하기\n○ 종이에 도장을 찍고, 펀치로 같은 모양을 만드는 모습을 실물화상기로 제시한다.\n- 선생님이 지금 무엇을 하고 있나요?\n- 찍힌 도장들 또는 만들어진 모양들은 어떤 공통점이 있나요?\n● 탐구 질문 확인하기\n- 합동은 무엇인가요?", "학생": "○ 제시된 모습을 관찰한다.\n- 도장을 찍고 있습니다. 색종이로 같은 모양을 만들고 있습니다. 등\n- 각각 모양과 크기가 같습니다. 합동입니다. 등", "시간": "3", "자료": "사진·PPT 등 자료명", "유의점": "지도 시 유의사항", "평가": "(관찰) 참여 태도 등" },
    { "단계": "전개", "형태": "모둠", "활동": "활동1 - 탐구 질문 제시·자료 배부", "교사": "● 활동1\n○ 탐구 자료를 모둠에 배부한다.\n- 도형들을 살펴보고 합동인 것과 합동이 아닌 것을 구분해 보세요.", "학생": "○ 자료를 받고 살펴본다.", "시간": "3", "자료": "", "유의점": "", "평가": "(관찰)" },
    { "단계": "전개", "형태": "모둠", "활동": "활동2 - 모둠 탐구·실습", "교사": "● 활동2\n○ 모둠별로 탐구하도록 안내한다.\n- 합동인 예를 관찰하여 합동인 도형의 성질을 최대한 많이 찾아보세요.\n- 각 모둠에서 찾아낸 성질을 살펴보고 '합동'의 개념을 한 문장으로 써 보세요.", "학생": "○ 모둠별로 탐구한다.\n- 모양이 같다. 크기가 같다. 포개었을 때 완전히 겹친다. 등", "시간": "10", "자료": "", "유의점": "", "평가": "(관찰)" },
    { "단계": "전개", "형태": "전체", "활동": "활동3 - 발표·정리", "교사": "● 활동3\n○ 모둠별로 발표하도록 안내한다.\n- ○○○한 모둠부터 발표해 볼까요?\n- 다른 의견은요?", "학생": "○ 모둠별로 발표한다.\n- 찾은 성질을 발표한다. 등", "시간": "10", "자료": "", "유의점": "", "평가": "" },
    { "단계": "정리", "형태": "전체", "활동": "정리·마무리", "교사": "● 오늘 배운 내용 정리\n○ 오늘 배운 내용을 정리한다.\n- 이번 시간에 무엇을 배웠나요?\n- 다음 차시에는 ○○○를 배워봅시다.", "학생": "○ 정리 발표한다.\n- 합동의 개념, 성질 등을 발표한다. 등", "시간": "5", "자료": "", "유의점": "", "평가": "" }
  ]
}
activities 필드별 역할 및 기호(반드시 지킬 것):
- 교사 열의 **첫 줄**은 반드시 ●(검은 동그라미)로 **활동 주제**를 쓴다. 예: ● 사전 지식 활성화하기, ● 활동1 - 탐구 질문 제시
- 그 다음 줄부터: ○(빈 원)=구체적 지시·활동, -(하이픈)=발문·질문·설명
- 학생 열도 문장별로 ○ 또는 - 기호를 붙인다.
- 교사=주요 활동+발문. 자료=자료명. 유의점=지도 시 유의사항. 평가=(관찰) 등. 서로 섞지 말 것.

[참고 자료 - 반드시 반영]
${refContextClean}
`;

    try {
        console.log(`Gemini REST API 호출 중... (모델: ${modelId})`);
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent?key=${apiKey}`;
        const body = {
            contents: [{ role: 'user', parts: [{ text: systemPrompt }] }],
            generationConfig: { responseMimeType: 'application/json' }
        };
        const apiRes = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
            body: JSON.stringify(body)
        });
        if (!apiRes.ok) {
            const errText = await apiRes.text();
            throw new Error(`Gemini API ${apiRes.status}: ${errText.substring(0, 200)}`);
        }
        const apiData = await apiRes.json();
        const text = apiData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (!text) throw new Error('AI 응답이 비어 있습니다.');
        console.log('AI 응답 수신 성공:', text.substring(0, 100) + '...');

        const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
        try {
            const data = JSON.parse(jsonStr);
            if (!data.area || String(data.area).trim() === '') {
                const gradeBand = getGradeBand(grade || '3');
                const area = getAreaFromStandards(subject || '국어', gradeBand, resolvedUnitName);
                if (area) data.area = area;
            }
            if (!data.coreIdea || String(data.coreIdea).trim() === '') {
                const baseCoreIdea = getCoreIdeaFromFile(subject || '국어', data.area);
                if (baseCoreIdea) {
                    data.coreIdea = baseCoreIdea;
                } else {
                    data.coreIdea = await generateCoreIdeaByAI(apiKey, subject || '국어', data.area, resolvedUnitName);
                }
            }
            res.status(200).json(data);
        } catch (parseError) {
            console.error('JSON 파싱 에러. 원본 텍스트:', text);
            res.status(500).json({ error: 'AI 응답 형식 오류', details: parseError.message });
        }
    } catch (error) {
        console.error('서버 에러 상세:', error);
        res.status(500).json({
            error: 'AI 생성 실패',
            details: error.message,
            stack: error.stack
        });
    }
});

app.use(express.static(baseDir));

app.listen(port, () => {
    console.log(`서버가 실행되었습니다: http://localhost:${port}`);
    console.log('연간지도 계획, 성취기준, 성취수준, 핵심아이디어, 장학자료를 반영합니다.');
});
