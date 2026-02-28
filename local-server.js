const express = require('express');
const { GoogleGenerativeAI } = require('@google/generative-ai');
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

    const planEntry = annualPlan.find(p => p.교과 === subject && (p.학년 === grade || p.학년군 === gradeBand));
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
            if (unitInfo.주요_학습_내용_및_활동) {
                context += `- 주요 학습 내용 및 활동: ${unitInfo.주요_학습_내용_및_활동}\n`;
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
                context += '\n[성취기준]\n';
                filtered.forEach(s => {
                    const unitPart = s.단원 ? ` [단원: ${s.단원}]` : '';
                    context += `- ${s.성취기준}${unitPart}\n`;
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
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        return res.status(500).json({ error: 'API Key not configured in .env file' });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const modelId = "gemini-1.5-flash";
    const model = genAI.getGenerativeModel({ model: modelId });

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
아래 참고 자료(연간지도 계획, 성취기준·해설, 성취수준, 핵심아이디어, 적용 시 고려사항, 장학자료)를 모두 반영하여, **해당 차시에 맞는 상세하고 실질적으로 진행 가능한** 교수·학습 과정안(약안)을 작성하세요.

[입력 정보]
- 학년: ${grade}학년, 학기: ${semester}학기, 교과: ${subject}
- 단원: ${resolvedUnitName || unit + '단원'}
- 차시: ${lesson}차시

[필수 반영 사항]
1. **연간지도 계획**에 제시된 해당 단원·차시의 "주요 학습 내용 및 활동"을 이 차시 수업의 골격으로 반드시 반영하세요. 이 차시에서 다룰 구체적인 학습 내용을 그에 맞게 설정하세요.
2. **성취기준**과 **성취기준 해설**을 반영하여 학습 목표·탐구 질문·수업자 의도를 구체적으로 작성하세요.
3. **성취수준** 자료를 참고하여 평가 계획에 지식·이해, 과정·기능, 가치·태도 범주별로 상/중/하 수준을 구체적으로 진술하고, 각 수준에 대한 피드백 방안을 제시하세요.
4. **핵심 아이디어**와 **성취기준 적용 시 고려사항**, **장학자료**를 반영하여 수업 설계와 유의점에 반영하세요.

[작성 원칙 - 상세·실행 가능]
- 수업안은 **상당히 상세하게** 작성하세요. 교사 열에는 발문(질문 문장), 설명 내용, 지도 절차, 자료 제시 순서 등을 구체적으로 적으세요. 학생 열에는 예상 반응, 활동 내용, 산출물, 모둠별 역할 등을 구체적으로 적으세요.
- **실제 수업에서 그대로 진행할 수 있는** 수준으로 작성하세요. 추상적 요약이 아니라 "교사가 할 말·할 일", "학생이 할 말·할 일"이 드러나도록 하세요.
- 도입/전개/정리 단계별로 **여러 행**을 두세요. 전개 단계는 해당 차시의 주요 학습 내용을 세부 활동으로 나누어 2~5개 행으로 작성하세요(예: 활동1 탐구 질문 제시, 활동2 모둠 탐구, 활동3 발표·정리 등).
- 모든 문장은 **한국어만** 사용하세요. 영어 레이블(competency, standard 등)은 사용하지 마세요.
- competency: 해당 교과 역량 및 영역을 한글로. standard: 성취기준 문장 및 핵심 아이디어 반영. question: 탐구 질문 한 문장. objective: 학습 목표·학습 주제. intent: 수업자의 의도(수업·평가 주안점). feedback: 성취수준 상/중/하 진술 및 피드백 방안.
- model: 해당 차시·단원에 가장 적합한 교수·학습 모형을 추천하여 한 문장으로 작성 (예: 개념 형성 모형, 문제 해결 학습 모형, 탐구 학습 모형 등).

[출력 형식 - 순수 JSON만]
마크다운 코드블록 없이 JSON만 반환하세요.
{
  "competency": "교과 역량 및 영역(한글)",
  "standard": "성취기준 및 핵심 아이디어",
  "question": "탐구 질문",
  "objective": "학습 목표·학습 주제",
  "intent": "수업자 의도(수업·평가 주안점)",
  "feedback": "성취수준(상/중/하) 및 피드백 방안",
  "model": "해당 차시에 맞는 교수·학습 모형",
  "activities": [
    { "단계": "도입", "형태": "전체", "활동": "활동 요약", "시간": "3", "자료": "자료명", "유의점": "유의사항", "평가": "", "교사": "구체적인 발문·설명·지도 내용", "학생": "예상 반응·활동 내용" },
    { "단계": "전개", "형태": "모둠", "활동": "활동1 요약", "시간": "10", "자료": "", "유의점": "", "평가": "관찰 등", "교사": "구체적 발문 및 지도", "학생": "구체적 활동 및 산출" },
    { "단계": "전개", "형태": "전체", "활동": "활동2 요약", "시간": "10", "자료": "", "유의점": "", "평가": "", "교사": "구체적 지도", "학생": "구체적 활동" },
    { "단계": "정리", "형태": "전체", "활동": "정리·마무리", "시간": "5", "자료": "", "유의점": "", "평가": "", "교사": "정리 발문·다음 차시 안내", "학생": "정리 발표·확인" }
  ]
}
activities의 교사·학생 필드에는 한두 문장이 아닌, 실제 수업에서 쓸 수 있을 정도로 구체적으로 작성하세요.

[참고 자료 - 반드시 반영]
${refContextClean}
`;

    try {
        console.log(`Gemini API 호출 중... (모델: ${modelId})`);
        const result = await model.generateContent(systemPrompt);
        const response = await result.response;
        const text = response.text();
        console.log('AI 응답 수신 성공:', text.substring(0, 100) + '...');

        const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
        try {
            const data = JSON.parse(jsonStr);
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
