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

[입력 정보]
- 학년: ${grade}학년, 학기: ${semester}학기, 교과: ${subject}
- 단원: ${resolvedUnit}
- 차시: ${lesson}차시

[작성 원칙]
1. 모든 출력은 한국어로 작성.
2. activities는 반드시 배열로 작성. 각 항목에 단계, 형태, 활동, 시간, 자료, 유의점, 평가, 교사, 학생 필드를 포함.
3. activities 필드별 역할 및 기호: 교사·학생 열은 문장별로 줄바꿈하고 각 문장 앞에 기호를 붙인다. ●=주요 활동 제목(예: ● 사전 지식 활성화하기). ○=구체적 지시·활동(예: ○ 실물화상기로 제시한다). -=발문·질문·세부 항목(예: - 선생님이 지금 무엇을 하고 있나요?). 교사=주요 활동+발문. 학생=예상 반응·할 말. 자료=자료명. 유의점=지도 시 유의사항. 평가=(관찰) 등.
4. 도입 전개 정리 단계별로 2~5개 행 작성.
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
  "intent": "수업자 의도",
  "feedback": "성취수준 및 피드백 (evaluationPlan 없을 때)",
  "evaluationPlan": [
    { "category": "지식·이해(관찰)", "element": "평가 요소", "high": "상", "middle": "중", "low": "하", "feedback": "피드백" }
  ],
  "model": "교수·학습 모형",
  "activities": [
    { "단계": "도입", "형태": "전체", "활동": "사전 지식 활성화하기", "교사": "● 사전 지식 활성화하기\n○ ○○○를 실물화상기로 제시한다.\n- 선생님이 지금 무엇을 하고 있나요?\n● 탐구 질문 확인하기\n- ○○○는 무엇인가요?", "학생": "○ 제시된 모습을 관찰한다.\n- 예상 반응. 등", "시간": "3", "자료": "자료명", "유의점": "유의사항", "평가": "(관찰)" },
    { "단계": "전개", "형태": "모둠", "활동": "활동1", "교사": "● 탐구 활동1\n○ 자료를 모둠에 배부한다.\n- 구체적 지시.\n- 발문.", "학생": "○ 함께 활동한다.\n- 구체적 활동·산출. 등", "시간": "10", "자료": "", "유의점": "", "평가": "(관찰)" },
    { "단계": "정리", "형태": "전체", "활동": "정리", "교사": "● 오늘 배운 내용 정리\n○ 정리한다.\n- 이번 시간에 무엇을 배웠나요?", "학생": "○ 정리 발표한다.\n- 발표 내용. 등", "시간": "5", "자료": "", "유의점": "", "평가": "" }
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
