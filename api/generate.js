// Vercel Serverless Function: api/generate.js (REST API 사용 - ByteString 오류 회피)

import path from 'path';
import fs from 'fs';

export const config = { api: { bodyParser: true } };

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
    const resolvedUnit = unitName || unit || '';
    const apiKey = (process.env.GEMINI_API_KEY || '').trim();

    if (!apiKey) {
        return res.status(500).json({ error: 'API Key not configured', details: 'Vercel 환경 변수에 GEMINI_API_KEY를 설정하세요.' });
    }

    const modelId = "gemini-2.5-flash";
    const systemPrompt = `
당신은 2022 개정 교육과정에 정통한 초등학교 수업 설계 전문가입니다.
2022 개정 교육과정 가이드라인을 준수하여 교수학습 과정안(약안) 초안을 작성하세요.

[수업 설계 흐름 - 반드시 이 순서로 설계]
1. 역량을 기르기 위해 성취기준·핵심아이디어에 맞춰 탐구질문을 도출한다.
2. 그 탐구질문을 해결하기 위해 수업목표(objective)와 학습 주제(topic)를 설정한다.
3. 수업·평가 주안점을 두고 수업의도(intent)를 작성한다.
4. 그 의도에 맞게 평가계획(evaluationPlan)을 작성한다.
5. 평가계획을 실행하기 위한 방안으로 40분 수업이 진행된다. 도입·전개·정리로 구성.
6. 차시별 주요활동에 맞춰 전개에서 탐구질문·문제를 해결하기 위해 3가지 활동(실현 어려우면 2가지)을 제시하고, 정리에서 활동 마무리 활동을 제시한다.

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
  "standard": "성취기준만 ([4국03-02] 형태. 핵심 아이디어 넣지 말 것)",
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
