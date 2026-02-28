// Vercel Serverless Function: api/generate.js
import { GoogleGenerativeAI } from "@google/generative-ai";

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { grade, semester, subject, unit, lesson } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;

    if (!apiKey) {
        return res.status(500).json({ error: 'API Key not configured' });
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

    const systemPrompt = `
당신은 "초등학교 수업 설계 전문가"입니다. 사용자는 "초등학교 교사"입니다.
2022 개정 교육과정 가이드라인을 엄격히 준수하여 교수·학습 과정안을 작성하세요.

[입력 정보]
- 학년: ${grade}학년
- 학기: ${semester}학기
- 교과: ${subject}
- 단원: ${unit}
- 차시: ${lesson}

[작성 원칙]
1. 모든 출력은 한국어로 작성.
2. 핵심 아이디어 재진술 원칙: 현재형, 중립적 동사, 개념어만 포함, 가치 판단 배제.
3. 탐구질문: 실질적 사고 유도, 학생 수준에 맞는 발문.
4. 활동 설계: 학생 참여형, 2-3개 활동 포함, 40분 단위, 수업모형 적용.
5. 성취수준: 상/중/하 각각 한 문장으로 작성.
6. 피드백: 구체적 방안 기술 ("~한다." 형태).

[출력 형식]
JSON 형식으로 반환하세요:
{
  "competency": "교과역량 및 영역",
  "standard": "성취기준 및 재진술된 핵심 아이디어",
  "question": "탐구질문",
  "objective": "학습목표 및 주제",
  "intent": "수업자 의도",
  "feedback": "성취수준 및 피드백 방안",
  "activities": "교수·학습 활동 (도입-전개-정리 단계별 교사/학생 활동)"
}
`;

    try {
        const result = await model.generateContent(systemPrompt);
        const response = await result.response;
        const text = response.text();

        // JSON 파싱 (AI가 마크다운 블록을 포함할 수 있으므로 정제 필요)
        const jsonStr = text.replace(/```json/g, '').replace(/```/g, '').trim();
        const data = JSON.parse(jsonStr);

        res.status(200).json(data);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'AI 생성 실패' });
    }
}
