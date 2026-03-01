// Vercel Serverless Function: api/generate.js (REST API 사용 - ByteString 오류 회피)

import path from 'path';
import fs from 'fs';

export const config = { api: { bodyParser: true } };

function getChasiActivity(grade, subject, unitName, lesson) {
    try {
        const planPath = path.join(process.cwd(), '연간지도_계획.json');
        if (!fs.existsSync(planPath)) return '';
        const annualPlan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
        const gradeStr = String(grade);
        const g = parseInt(grade, 10);
        const gradeBand = g <= 2 ? '1~2학년' : g <= 4 ? '3~4학년' : '5~6학년';
        let planEntry = annualPlan.find(p => p.교과 === subject && p.학년 === gradeStr);
        if (!planEntry) planEntry = annualPlan.find(p => p.교과 === subject && p.학년군 === gradeBand);
        if (!planEntry?.단원목록) return '';
        const unitInfo = planEntry.단원목록.find(u =>
            u.단원명 === unitName || String(u.단원번호) === String(unitName) || (u.단원명 && u.단원명.includes(unitName))
        );
        if (!unitInfo?.차시별_주요_활동 || !Array.isArray(unitInfo.차시별_주요_활동)) return '';
        const lessonNum = parseInt(lesson, 10);
        if (isNaN(lessonNum)) return '';
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
        return best ? (best.내용 || '') : '';
    } catch (e) {
        return '';
    }
}

function getStandardsBlock(grade, subject, unitName, chasiContent) {
    try {
        const standardsPath = path.join(process.cwd(), '2022개정교육과정 성취기준 및 해설.json');
        if (!fs.existsSync(standardsPath)) return { block: '', fallback: '' };
        const standards = JSON.parse(fs.readFileSync(standardsPath, 'utf8'));
        const g = parseInt(grade, 10);
        const gradeBand = g <= 2 ? '1~2학년' : g <= 4 ? '3~4학년' : '5~6학년';
        let filtered = standards.filter(s => s.교과 === subject && s.학년 === gradeBand);
        if (unitName && unitName.length >= 2) {
            const u = String(unitName).trim();
            const unitFiltered = filtered.filter(s => s.단원 && (
                s.단원.includes(u) || u.includes(s.단원) || s.단원 === u || s.단원.indexOf(u) !== -1
            ));
            if (unitFiltered.length > 0) filtered = unitFiltered;
        }
        let matched = [];
        let rest = [];
        if (chasiContent && chasiContent.length >= 2) {
            const words = chasiContent.replace(/[을를이가에와과]\s*/g, ' ').split(/\s+/).filter(w => w.length >= 2);
            const keywords = [...new Set([...words, ...(chasiContent.includes('인물') ? ['인물'] : []), ...(chasiContent.includes('이야기') ? ['이야기'] : []), ...(chasiContent.includes('흐름') ? ['흐름'] : []), ...(chasiContent.includes('관계') ? ['관계'] : [])])];
            const scored = filtered.map(s => {
                const text = s.성취기준 || '';
                const matchCount = keywords.filter(k => text.includes(k)).length;
                return { ...s, _score: matchCount };
            });
            matched = scored.filter(s => s._score > 0).sort((a, b) => b._score - a._score).slice(0, 5);
            rest = scored.filter(s => s._score === 0).slice(0, 13);
        } else {
            matched = [];
            rest = filtered.slice(0, 18);
        }
        const fallback = (matched[0] || rest[0])?.성취기준 || '';
        const standardsForLookup = filtered;
        let block = '\n[성취기준 - 반드시 이 중에서 선택하여 standard 필드에 넣을 것]\n';
        if (matched.length > 0) {
            block += '[★★ 이 차시에 적합한 성취기준 - 우선 선택 ★★]\n';
            matched.forEach(s => {
                block += `- ${s.성취기준}${s.영역 ? ` [영역: ${s.영역}]` : ''}\n`;
            });
            block += '\n[기타 성취기준 참고]\n';
            rest.forEach(s => {
                block += `- ${s.성취기준}${s.영역 ? ` [영역: ${s.영역}]` : ''}\n`;
            });
        } else {
            rest.forEach(s => {
                block += `- ${s.성취기준}${s.영역 ? ` [영역: ${s.영역}]` : ''}${s.단원 ? ` [단원: ${s.단원}]` : ''}\n`;
            });
        }
        return { block, fallback, standardsForLookup };
    } catch (e) {
        return { block: '', fallback: '', standardsForLookup: [] };
    }
}

/** 올바른 성취기준 양식: [N과목코드NN-NN] 문장 (예: [6수01-16], [2국01-01]) */
const STANDARD_CODE_REGEX = /^\[\d+[국수사도과실체음미영]\d+-\d+\]\s*.+/;

/** AI가 코드만 반환한 경우(문장 생략) 전체 문장으로 보완 */
function ensureFullStandard(standard, standardsForLookup) {
    if (!standard || typeof standard !== 'string') return standard;
    const trimmed = standard.trim();
    const codeOnly = /^\[\d+[국수사도과실체음미영]\d+-\d+\]\s*$/;
    if (!codeOnly.test(trimmed)) return standard;
    const code = trimmed.match(/^(\[\d+[국수사도과실체음미영]\d+-\d+\])/)?.[1] || trimmed;
    const full = standardsForLookup.find(s => (s.성취기준 || '').startsWith(code))?.성취기준;
    return full || standard;
}

/** AI가 "수학6116." 등 잘못된 형식으로 반환한 경우, 문장으로 검색해 올바른 [코드] 문장으로 교체 */
function normalizeStandardFormat(standard, standardsForLookup) {
    if (!standard || typeof standard !== 'string' || !standardsForLookup?.length) return standard;
    const trimmed = standard.trim();
    if (STANDARD_CODE_REGEX.test(trimmed)) return trimmed;
    const descMatch = trimmed.match(/^[가-힣]+\d*\.?\s*(.+)$/s);
    const description = (descMatch ? descMatch[1] : trimmed).trim();
    if (!description || description.length < 10) return standard;
    const keyPhrase = description.slice(0, 40).replace(/\s+/g, ' ').trim();
    const found = standardsForLookup.find(s => {
        const text = (s.성취기준 || '').trim();
        return text.includes(keyPhrase) || text.includes(description.slice(0, 30));
    });
    return found ? found.성취기준.trim() : standard;
}

function getCoreIdeaFromFile(subject, area) {
    try {
        const corePath = path.join(process.cwd(), '핵심아이디어.txt');
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

async function generateCoreIdeaByAI(apiKey, subject, area, unitName) {
    if (!apiKey) return '';
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`;
        const prompt = `${subject} 교과 ${area || '해당'} 영역의 핵심 아이디어를 2022 개정 교육과정 스타일로 한 문단(2~4문장)으로 작성하세요. 성취기준 코드([4국03-02] 등)는 넣지 말고, 해당 영역의 핵심 개념만 진술하세요.${unitName ? ` (단원: ${unitName})` : ''}`;
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'x-goog-api-key': apiKey
            },
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
        return '';
    }
}

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { grade, semester, subject, unit, lesson, unitName } = req.body || {};
    const resolvedUnit = (unitName || unit || '').replace(/[\u201c\u201d\u2018\u2019\u2026]/g, '');
    const apiKey = (process.env.GEMINI_API_KEY || '').trim();

    if (!apiKey) {
        return res.status(500).json({ error: 'API Key not configured', details: 'Vercel 환경 변수에 GEMINI_API_KEY를 설정하세요.' });
    }

    const chasiContent = getChasiActivity(grade, subject || '국어', resolvedUnit, lesson);
    const chasiBlock = chasiContent
        ? `\n[★★★ 이 차시의 핵심 - 반드시 그대로 반영, 축약·변형·다른 내용 대체 금지 ★★★]\n${lesson}차시 주요 학습 내용 및 활동: ${chasiContent}\n`
        : `\n[참고] 연간지도 계획에서 이 단원·차시에 해당하는 "차시별 주요 활동"을 찾지 못했습니다. 선택한 단원(${resolvedUnit})과 ${lesson}차시에 맞게, 해당 교과 성취기준과 연계하여 학습 주제·목표와 활동을 작성하세요.\n`;

    const { block: standardsBlock, fallback: standardsFallback, standardsForLookup } = getStandardsBlock(grade, subject || '국어', resolvedUnit, chasiContent);

    const modelId = "gemini-2.5-flash";
    const systemPrompt = `
당신은 2022 개정 교육과정에 정통한 초등학교 수업 설계 전문가입니다.
2022 개정 교육과정 가이드라인을 준수하여 교수학습 과정안(약안) 초안을 작성하세요.

[수업 설계 흐름 - 반드시 이 순서로 설계]
1. 아래 [★★★ 이 차시의 핵심 ★★★]에 나온 "N차시 주요 학습 내용 및 활동" 문장이 곧 이 차시의 학습 내용입니다. 이 문장을 축약·변형·다른 내용으로 대체하지 말고 그대로 반영할 것.
2. **학습 주제(topic)·학습 목표(objective)**는 위 "주요 학습 내용 및 활동"에서 **그대로 뽑아** 사용. 다른 표현으로 바꾸거나 엉뚱한 단원/차시 내용으로 대체하지 않음.
3. 이 차시 주요 활동과 직접 관련된 성취기준·핵심아이디어만 선택. 해당 차시와 무관한 성취기준(다른 단원·영역)은 넣지 않음.
4. 위 주요 활동을 해결하기 위한 탐구 질문(question)을 한 개 작성.
5. 수업·평가 주안점으로 수업의도(intent) 작성, 그 의도에 맞게 평가계획 작성.
6. 40분 수업: 도입 1개 + 전개 2~3개(활동1·활동2·활동3) + 정리 1개. 전개 활동은 [이 차시의 핵심]에 제시된 "주요 학습 내용 및 활동"을 구체화한 내용으로 작성할 것.
(요약: objective·topic·전개 활동은 모두 [이 차시의 핵심] 블록의 "주요 학습 내용 및 활동"과 일치해야 함.)
${chasiBlock}
${standardsBlock}
[입력 정보]
- 학년: ${grade}학년, 학기: ${semester}학기, 교과: ${subject}
- 단원: ${resolvedUnit}
- 차시: ${lesson}차시

[작성 원칙]
1. 모든 출력은 한국어로 작성.
2. activities는 반드시 배열로 작성. 각 항목에 단계, 형태, 활동, 시간, 자료, 유의점, 평가, 교사, 학생 필드를 포함.
3. activities 기호: 교사 열 첫 줄은 ●(검은 동그라미)로 활동 주제(예: ● 사전 지식 활성화하기, ● 활동1). 다음 줄: ○=구체적 지시, -=발문·질문. 학생=예상 반응. 자료=자료명. 유의점=지도 시 유의사항. 평가=(관찰) 등.
4. 교수·학습 활동: 도입 1개 + 전개 3개(활동1·활동2·활동3, 실현 어려우면 2개) + 정리 1개. 전개에서 탐구질문·문제 해결을 위한 활동, 정리에서 마무리 활동을 제시.
5. model: 해당 차시 단원에 가장 적합한 교수학습 모형을 추천하여 한 문장으로 작성.

[★★★ 교수·학습 활동 - 반드시 해당 차시에 맞게 구체화 ★★★]
- 교과·단원·차시별 주요활동이 다르면 활동 내용이 완전히 달라야 함. 같은 템플릿을 모든 수업에 적용하지 말 것.
- 예: 국어 "인물 관계·이야기 흐름" → 읽기 자료·인물 관계도·이야기 흐름 파악 활동. 국어 "대화 생략 추론" → 대화 자료·생략된 내용 짐작 활동. 수학 "합동" → 도형·합동 판별·성질 탐구 활동.
- 교사·학생 열에 해당 차시 학습 내용에 맞는 구체적 자료명, 발문, 활동, 예상 반응을 작성할 것. "자료를 배부한다", "모둠별로 탐구한다" 같은 추상적 표현만 쓰지 말 것.
- 활동 이름(활동 필드)도 차시에 맞게 구체화할 것. 예: "활동1 - 인물 관계 파악하기", "활동1 - 대화에서 생략된 내용 짐작하기", "활동1 - 합동인 도형 찾기".

[출력 형식 - 순수 JSON만]
마크다운 없이 JSON만 반환하세요.
- area: 해당 교과 교육과정의 영역 (예: 듣기·말하기, 읽기, 문학, 매체).
- coreIdea: 영역 핵심 아이디어를 기반으로 해당 차시(단원·학습 내용)에 맞게 재진술. 성취기준 코드 넣지 말 것.
- objective: 학습 목표 한 문장 ("~할 수 있다" 형태).
- topic: 학습 주제 (학습 목표와 구분하여 별도).
- evaluationPlan: 평가 계획 표. 범주(평가방법), 평가요소, 수준(상/중/하), 피드백 포함. 1~3행.
{
  "competency": "교과 역량",
  "area": "해당 교과 영역",
  "coreIdea": "핵심 아이디어 (영역 핵심 아이디어를 기반으로 해당 차시에 맞게 재진술)",
  "standard": "위 [성취기준] 목록에서 선택. 반드시 [숫자과목코드숫자-숫자] 형식으로 시작 (예: [6수01-16], [2국01-01]). '수학6116.' 등 다른 형식 사용 금지. 코드+문장 전체를 그대로 복사.",
  "question": "탐구 질문",
  "objective": "학습 목표 한 문장",
  "topic": "학습 주제",
  "intent": "수업·평가 주안점을 두고 작성한 수업자 의도. 이 의도에 맞게 평가계획을 설계한다.",
  "feedback": "성취수준 및 피드백 (evaluationPlan 없을 때)",
  "evaluationPlan": [
    { "category": "지식·이해(관찰)", "element": "평가 요소", "high": "상", "middle": "중", "low": "하", "feedback": "피드백" }
  ],
  "model": "교수·학습 모형",
  "activities": [
    { "단계": "도입", "형태": "전체", "활동": "사전 지식 활성화하기", "교사": "● 사전 지식 활성화하기\n○ ○○○를 실물화상기로 제시한다.\n- 선생님이 지금 무엇을 하고 있나요?\n● 탐구 질문 확인하기\n- ○○○는 무엇인가요?", "학생": "○ 제시된 모습을 관찰한다.\n- 예상 반응. 등", "시간": "3", "자료": "자료명", "유의점": "유의사항", "평가": "(관찰)" },
    { "단계": "전개", "형태": "모둠", "활동": "활동1 - 탐구 질문 제시·자료 배부", "교사": "● 활동1\n○ 자료를 모둠에 배부한다.\n- 구체적 지시.", "학생": "○ 자료를 받고 살펴본다.", "시간": "3", "자료": "", "유의점": "", "평가": "(관찰)" },
    { "단계": "전개", "형태": "모둠", "활동": "활동2 - 모둠 탐구·실습", "교사": "● 활동2\n○ 모둠별로 탐구하도록 안내한다.\n- 발문.", "학생": "○ 함께 탐구·실습한다.", "시간": "10", "자료": "", "유의점": "", "평가": "(관찰)" },
    { "단계": "전개", "형태": "전체", "활동": "활동3 - 발표·정리", "교사": "● 활동3\n○ 모둠별로 발표하도록 안내한다.\n- 발표해 볼까요?", "학생": "○ 발표한다.", "시간": "10", "자료": "", "유의점": "", "평가": "" },
    { "단계": "정리", "형태": "전체", "활동": "정리", "교사": "● 오늘 배운 내용 정리\n○ 정리한다.\n- 이번 시간에 무엇을 배웠나요?", "학생": "○ 정리 발표한다.", "시간": "5", "자료": "", "유의점": "", "평가": "" }
  ]
}
`;

    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`;
        const body = {
            contents: [{ role: 'user', parts: [{ text: systemPrompt }] }],
            generationConfig: { responseMimeType: 'application/json' }
        };
        const apiRes = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'x-goog-api-key': apiKey
            },
            body: JSON.stringify(body)
        });
        if (!apiRes.ok) {
            const errText = await apiRes.text();
            throw new Error(`Gemini API ${apiRes.status}: ${errText.substring(0, 200)}`);
        }
        const apiData = await apiRes.json();
        const text = apiData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (!text) throw new Error('AI 응답이 비어 있습니다.');

        const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const data = JSON.parse(jsonStr);

        if (!data.standard || String(data.standard).trim() === '') {
            if (standardsFallback) data.standard = standardsFallback;
        } else if (standardsForLookup.length > 0) {
            data.standard = normalizeStandardFormat(data.standard, standardsForLookup);
            data.standard = ensureFullStandard(data.standard, standardsForLookup);
        }
        if (!data.coreIdea || String(data.coreIdea).trim() === '') {
            const coreIdea = getCoreIdeaFromFile(subject || '국어', data.area);
            if (coreIdea) {
                data.coreIdea = coreIdea;
            } else {
                data.coreIdea = await generateCoreIdeaByAI(apiKey, subject || '국어', data.area, resolvedUnit);
            }
        }

        if (data.activities && !Array.isArray(data.activities)) {
            data.activities = [{ 단계: '전개', 형태: '전체', 활동: String(data.activities), 시간: '40', 자료: '', 유의점: '', 평가: '', 교사: '◉', 학생: '◦' }];
        }

        res.status(200).json(data);
    } catch (error) {
        console.error('AI generate error:', error);
        const msg = error?.message || 'AI 생성 실패';
        res.status(500).json({
            error: 'AI 생성 실패',
            details: msg,
        });
    }
}
