/**
 * AI 학습지 생성 API: 차시 학습 내용을 바탕으로 학습지 HTML 생성 → PDF 인쇄용
 */
export const config = { api: { bodyParser: true } };

export default async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const apiKey = (process.env.GEMINI_API_KEY || '').trim();
    if (!apiKey) {
        return res.status(500).json({ error: 'API Key not configured', details: 'GEMINI_API_KEY를 설정하세요.' });
    }

    const { grade, subject, unitName, lesson, topic, objective, question } = req.body || {};
    const topicText = [topic, objective, question].filter(Boolean).join(' / ');

    const prompt = `당신은 초등학교 수업 자료 설계 전문가입니다.
아래 **해당 차시의 학습 주제·목표·탐구 질문**에 맞는 **학습지(활동지)** 한 장 분량의 HTML을 작성해 주세요.

[규칙]
1. 출력은 **HTML만** 반환하세요. 마크다운이나 설명 없이 <!DOCTYPE html>부터 </html>까지의 완전한 HTML 한 덩어리만 출력합니다.
2. 인쇄했을 때 A4 한 페이지 안에 들어가도록 CSS를 포함하세요 (예: @media print, page-break, 폰트 12~14px, 여백 적당히).
3. 학습지 구성: 상단에 "학습지", 단원명·차시, 학습 목표 1~2문장, 그 아래 **학생이 직접 쓰거나 활동할 수 있는** 영역을 넣으세요. 예: 빈칸 채우기, 짧은 질문에 답하기, 빈 칸에 쓰기, ○/× 표시, 짝과 이야기 나누기 기록 등. 해당 차시 학습 내용과 직접 연관된 문제·활동으로 구성할 것.
4. 전체 문서는 한국어로만 작성하고, body 안에만 내용을 넣어도 됩니다 (html, head, style 포함 권장).
5. 스타일은 <style> 태그로 포함하세요. 표나 div로 깔끔하게 정리하고, 인쇄 시 보기 좋게 해 주세요.

[해당 차시 정보]
- 학년: ${grade}학년
- 교과: ${subject}
- 단원: ${unitName || '-'}
- 차시: ${lesson}차시
- 학습 주제·목표·탐구 질문: ${topicText || '(없음)'}

위 내용에 맞는 학습지 HTML을 **그대로** 출력하세요.`;

    try {
        const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
        const apiRes = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json; charset=utf-8',
                'x-goog-api-key': apiKey
            },
            body: JSON.stringify({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: { maxOutputTokens: 4096 }
            })
        });

        if (!apiRes.ok) {
            const errText = await apiRes.text();
            throw new Error(`Gemini API ${apiRes.status}: ${errText.substring(0, 200)}`);
        }

        const apiData = await apiRes.json();
        let text = apiData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        text = text.trim();

        // 코드블록 제거
        if (text.startsWith('```')) {
            text = text.replace(/^```html?\n?/, '').replace(/\n?```\s*$/, '');
        }

        // 완전한 HTML이 아니면 body로 감싸기
        if (!text.includes('<html') && !text.includes('<!DOCTYPE')) {
            text = `<!DOCTYPE html><html lang="ko"><head><meta charset="UTF-8"><title>학습지</title><style>body{font-family:'Malgun Gothic',sans-serif;padding:20px;font-size:14px;} @media print{body{padding:0;}}</style></head><body>${text}</body></html>`;
        }

        res.status(200).json({ html: text });
    } catch (error) {
        console.error('학습지 생성 오류:', error);
        res.status(500).json({
            error: '학습지 생성 실패',
            details: error?.message || 'Unknown error'
        });
    }
}
