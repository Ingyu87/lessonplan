// Vercel Serverless Function: api/generate.js (REST API 사용 - ByteString 오류 회피)

const path = require('path');
const fs = require('fs');
const { selectSubjectCompetencies } = require(path.join(__dirname, '../lib/subject-competency-select.cjs'));

const config = { api: { bodyParser: true } };

const GENERATION_MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash'];
const jsonCache = new Map();
const GEMINI_RETRY_MAX = 2;
const GEMINI_RETRY_BASE_MS = 700;

function readJsonCached(filePath) {
    try {
        const stat = fs.statSync(filePath);
        const mtimeMs = stat.mtimeMs;
        const cached = jsonCache.get(filePath);
        if (cached && cached.mtimeMs === mtimeMs) return cached.data;
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        jsonCache.set(filePath, { mtimeMs, data: parsed });
        return parsed;
    } catch (_) {
        return null;
    }
}

function parseGeminiErrorStatus(text) {
    if (!text) return null;
    const match = String(text).match(/"status"\s*:\s*"([A-Z_]+)"/);
    return match ? match[1] : null;
}

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableGeminiStatus(httpStatus, statusText) {
    const retryableHttp = httpStatus === 429 || httpStatus === 500 || httpStatus === 503 || httpStatus === 504;
    const retryableApi = ['UNAVAILABLE', 'RESOURCE_EXHAUSTED', 'DEADLINE_EXCEEDED'];
    return retryableHttp || retryableApi.includes(statusText || '');
}

async function callGeminiWithFallback(apiKey, body, models = GENERATION_MODELS) {
    let lastError = null;
    for (let i = 0; i < models.length; i++) {
        const modelId = models[i];
        const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId}:generateContent`;
        for (let attempt = 0; attempt <= GEMINI_RETRY_MAX; attempt++) {
            try {
                const apiRes = await fetch(url, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json; charset=utf-8',
                        'x-goog-api-key': apiKey
                    },
                    body: JSON.stringify(body)
                });
                if (apiRes.ok) {
                    const data = await apiRes.json();
                    return { data, modelId };
                }
                const errText = await apiRes.text();
                const statusText = parseGeminiErrorStatus(errText);
                lastError = new Error(`Gemini API ${apiRes.status} (${statusText || 'UNKNOWN'}): ${errText.substring(0, 300)}`);
                const canRetrySameModel = isRetryableGeminiStatus(apiRes.status, statusText) && attempt < GEMINI_RETRY_MAX;
                if (canRetrySameModel) {
                    await sleep(GEMINI_RETRY_BASE_MS * (attempt + 1));
                    continue;
                }
                break;
            } catch (networkError) {
                lastError = networkError instanceof Error ? networkError : new Error('Gemini 네트워크 오류');
                if (attempt >= GEMINI_RETRY_MAX) break;
                await sleep(GEMINI_RETRY_BASE_MS * (attempt + 1));
            }
        }
        const canTryNextModel = i < models.length - 1;
        if (!canTryNextModel) throw lastError || new Error('Gemini API 호출 실패');
    }
    throw lastError || new Error('Gemini API 호출 실패');
}

function sanitizeJsonText(raw) {
    const src = String(raw || '');
    let out = '';
    let inString = false;
    let escaped = false;
    for (let i = 0; i < src.length; i++) {
        const ch = src[i];
        const code = src.charCodeAt(i);
        if (!inString) {
            out += ch;
            if (ch === '"') inString = true;
            continue;
        }
        if (escaped) {
            out += ch;
            escaped = false;
            continue;
        }
        if (ch === '\\') {
            out += ch;
            escaped = true;
            continue;
        }
        if (ch === '"') {
            out += ch;
            inString = false;
            continue;
        }
        if (code <= 0x1f || code === 0x2028 || code === 0x2029) {
            if (ch === '\n') out += '\\n';
            else if (ch === '\r') out += '\\r';
            else if (ch === '\t') out += '\\t';
            else out += '';
            continue;
        }
        out += ch;
    }
    return out;
}

function getChasiActivity(grade, subject, unitName, lesson) {
    try {
        const planPath = path.join(process.cwd(), '연간지도_계획.json');
        if (!fs.existsSync(planPath)) return '';
        const annualPlan = readJsonCached(planPath);
        if (!Array.isArray(annualPlan)) return '';
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
        const standards = readJsonCached(standardsPath);
        if (!Array.isArray(standards)) return { block: '', fallback: '', standardsForLookup: [] };
        const g = parseInt(grade, 10);
        const gradeBand = g <= 2 ? '1~2학년' : g <= 4 ? '3~4학년' : '5~6학년';
        const normalizeUnitName = (v) => String(v || '')
            .replace(/^\s*\d+\s*[.．)\]]\s*/g, '') // "5. 막대그래프" -> "막대그래프"
            .replace(/\(\s*\d+\s*차시\s*\)/g, '') // "(10차시)" 제거
            .replace(/\(\s*\d+\s*\)/g, '') // "(10)" 제거
            .trim();

        const gradeToken = `${g}학년`;
        let filtered = standards.filter((s) => {
            if (s.교과 !== subject) return false;
            const gradeText = String(s.학년 || s.학년군 || '').trim();
            // 데이터셋이 "4학년 1학기, 4학년 2학기" 형태이므로 해당 학년 포함 여부로 매칭
            return gradeText.includes(gradeToken) || gradeText.includes(gradeBand);
        });
        if (unitName && unitName.length >= 2) {
            const u = normalizeUnitName(unitName);
            const unitFiltered = filtered.filter(s => s.단원 && (
                normalizeUnitName(s.단원).includes(u) ||
                u.includes(normalizeUnitName(s.단원)) ||
                normalizeUnitName(s.단원) === u
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

/**
 * 성취기준은 반드시 원본 데이터의 "완전 일치 문장"만 허용한다.
 * - AI가 임의 생성/변형한 문장은 허용하지 않는다.
 * - [코드]만 반환한 경우에만 해당 코드의 원문 문장으로 치환한다.
 * - 매칭 실패 시 fallback(원본 문장)으로 강제한다.
 */
function resolveStandardFromSourceOnly(standard, standardsForLookup, fallback) {
    const fallbackText = typeof fallback === 'string' ? fallback.trim() : '';
    const sourceList = Array.isArray(standardsForLookup) ? standardsForLookup : [];
    const sourceTexts = sourceList
        .map((s) => (s?.성취기준 || '').trim())
        .filter(Boolean);

    if (sourceTexts.length === 0) return fallbackText || '';

    const raw = typeof standard === 'string' ? standard.trim() : '';
    if (!raw) return fallbackText || sourceTexts[0];

    // 1) 원문 완전 일치면 그대로 사용
    if (sourceTexts.includes(raw)) return raw;

    // 2) [코드]만 온 경우, 같은 코드의 원문 문장으로 보완
    const codeOnlyMatch = raw.match(/^(\[\d+[국수사도과실체음미영]\d+-\d+\])\s*$/);
    const codeFromOnly = codeOnlyMatch?.[1];
    if (codeFromOnly) {
        const foundByCodeOnly = sourceTexts.find((t) => t.startsWith(codeFromOnly));
        if (foundByCodeOnly) return foundByCodeOnly;
    }

    // 3) 코드가 들어있으면 해당 코드의 원문 문장으로 치환
    const codeMatch = raw.match(/(\[\d+[국수사도과실체음미영]\d+-\d+\])/);
    const code = codeMatch?.[1];
    if (code) {
        const foundByCode = sourceTexts.find((t) => t.startsWith(code));
        if (foundByCode) return foundByCode;
    }

    // 4) 어떤 경우에도 원문 목록 외 텍스트는 금지
    if (fallbackText && sourceTexts.includes(fallbackText)) return fallbackText;
    return sourceTexts[0];
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
        const core = readJsonCached(corePath);
        if (!Array.isArray(core)) return '';
        const norm = (s) => (s || '').replace(/[·⋅]/g, '·').trim();
        const areaNorm = norm(area);
        const found = core.find(c => c.교과 === subject && c.영역 && (
            norm(c.영역) === areaNorm || norm(c.영역).includes(areaNorm) || areaNorm.includes(norm(c.영역))
        ));
        return found ? (found['핵심 아이디어'] || '') : '';
    } catch (e) { return ''; }
}


function asPlainText(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(v => asPlainText(v)).join(' ');
    if (typeof value === 'object') return Object.values(value).map(v => asPlainText(v)).join(' ');
    return String(value);
}

const TEACHING_MODEL_CANDIDATES = [
    '문제해결학습',
    '개념형성학습',
    '발견학습',
    '탐구학습',
    '협동학습',
    '프로젝트학습',
    '직접교수',
    '토의토론학습',
    '역할놀이학습'
];

function pickDefaultModelBySubject(subject) {
    const s = asPlainText(subject);
    if (s.includes('수학')) return '문제해결학습';
    if (s.includes('국어')) return '탐구학습';
    if (s.includes('과학')) return '발견학습';
    if (s.includes('사회')) return '탐구학습';
    return '협동학습';
}

function normalizeModelField(model, subject, topic, objective) {
    const raw = asPlainText(model).replace(/\s+/g, ' ').trim();
    const picked = TEACHING_MODEL_CANDIDATES.find((m) => raw.includes(m)) || pickDefaultModelBySubject(subject);
    let reason = raw;
    if (reason.includes('-')) reason = reason.split('-').slice(1).join('-').trim();
    if (!reason || TEACHING_MODEL_CANDIDATES.some((m) => reason === m)) {
        const basis = asPlainText(topic || objective || '해당 차시 학습 내용');
        reason = `${basis}에 적합한 탐구·문제 해결 중심 수업 운영이 가능하다`;
    }
    reason = reason.replace(/[.]+$/g, '').trim();
    return `${picked} - ${reason}.`;
}

function normalizeToOneSentenceCoreIdea(text, contextFallback) {
    let cleaned = asPlainText(text)
        .replace(/```/g, '')
        .replace(/\s+/g, ' ')
        .replace(/["']/g, '')
        .trim();
    if (!cleaned) return '';
    cleaned = cleaned
        .replace(/핵심\s*아이디어/gi, '핵심 개념')
        .replace(/핵심아이디어/gi, '핵심 개념');
    cleaned = cleaned.split(/(?<=[.?!])\s+/)[0]?.trim() || cleaned;
    cleaned = cleaned.replace(/[.?!]+$/g, '').trim();
    if (!cleaned) return '';
    return cleaned.endsWith('.') ? cleaned : `${cleaned}.`;
}


function extractStandardTextWithoutCode(standard) {
    return String(standard || '').replace(/^\[\d+[국수사도과실체음미영]\d+-\d+\]\s*/, '').trim();
}

function extractMeaningfulKeywords(text) {
    const stop = new Set([
        '그리고', '또는', '통해', '대한', '에서', '으로', '이다', '있다', '한다',
        '학습', '활동', '차시', '해당', '우리', '학생', '교사', '문장', '기준'
    ]);
    return [...new Set(
        String(text || '')
            .replace(/[^\w가-힣\s]/g, ' ')
            .split(/\s+/)
            .map((w) => w.trim())
            .filter((w) => w.length >= 2 && !stop.has(w))
    )];
}

function buildKeywordPool({ standard, chasiContent, baseCoreIdea, area, subject }) {
    const standardText = extractStandardTextWithoutCode(standard);
    const list = [
        ...extractMeaningfulKeywords(standardText),
        ...extractMeaningfulKeywords(chasiContent),
        ...extractMeaningfulKeywords(baseCoreIdea),
        ...extractMeaningfulKeywords(area),
        ...extractMeaningfulKeywords(subject)
    ];
    return [...new Set(list)].filter((k) => k.length >= 2).slice(0, 12);
}

function countKeywordHits(text, keywords) {
    const src = String(text || '');
    return keywords.filter((k) => src.includes(k)).length;
}



function isQuestionAcceptable(question, keywords, subject, area) {
    const q = String(question || '').trim();
    if (!q) return false;
    if (!/[?？]$/.test(q)) return false;
    if (q.length < 10) return false;
    const hitCount = countKeywordHits(q, keywords);
    // 사회 영역이 아닐 때 "우리 지역 소개" 유형 문장 방지
    const nonSocial = !(String(subject || '').includes('사회') || String(area || '').includes('지리') || String(area || '').includes('지역'));
    if (nonSocial && /우리 지역(을|의)?\s*소개/.test(q)) return false;
    return hitCount >= 1;
}

function buildFallbackQuestion({ keywords, subject }) {
    const k1 = keywords[0] || '핵심 개념';
    const k2 = keywords[1] || '핵심 요소';
    const s = String(subject || '');
    if (s.includes('수학')) return `${k1}와 ${k2}를 어떻게 나타내고 비교하면 근거 있게 설명할 수 있을까요?`;
    if (s.includes('국어')) return `${k1}와 ${k2}를 바탕으로 어떤 근거를 들어 생각을 설명할 수 있을까요?`;
    if (s.includes('과학')) return `${k1}와 ${k2}를 관찰하고 해석해 어떤 결론을 말할 수 있을까요?`;
    if (s.includes('사회')) return `${k1}와 ${k2}를 자료로 확인하면 어떤 관계를 설명할 수 있을까요?`;
    return `${k1}와 ${k2}를 바탕으로 무엇을 어떻게 설명할 수 있을까요?`;
}

async function regenerateCoreIdeaAndQuestionByAI(apiKey, options) {
    const { subject, area, standard, baseCoreIdea, chasiContent, unitName, lesson, currentCoreIdea, currentQuestion } = options || {};
    if (!apiKey) return { coreIdea: '', question: '' };
    const standardText = extractStandardTextWithoutCode(standard);
    const prompt = `다음 정보를 바탕으로 초등 ${asPlainText(subject)} 차시의 핵심 아이디어와 탐구 질문을 작성하세요.

[성취기준]
${asPlainText(standard)}

[영역 핵심 아이디어 원문]
${asPlainText(baseCoreIdea)}

[차시 정보]
- 영역: ${asPlainText(area)}
- 단원: ${asPlainText(unitName)}
- 차시: ${asPlainText(lesson)}차시
- 주요 학습 내용: ${asPlainText(chasiContent)}

[현재 결과(품질 보정 대상)]
- 핵심 아이디어: ${asPlainText(currentCoreIdea)}
- 탐구 질문: ${asPlainText(currentQuestion)}

[핵심 아이디어 작성 원칙]
1) 한 문장, 현재형, 중립적 동사 사용.
2) 성취기준의 핵심 개념어 2개 이상 포함.
3) 개념 간 관계가 드러나야 함.
4) "본질", 가치판단, 지시문 표현 금지.

[탐구 질문 작성 원칙]
1) 학생이 답할 수 있는 한 문장 질문(물음표로 종료).
2) 핵심 개념어를 포함하고 학습 내용과 직접 연결.
3) 일반적 문구(예: 아무 교과나 가능한 질문) 금지.

JSON으로만 답하세요:
{"coreIdea":"...", "question":"..."}`;
    try {
        const { data } = await callGeminiWithFallback(apiKey, {
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json' }
        });
        const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const jsonStr = sanitizeJsonText(String(raw || '').replace(/```json/g, '').replace(/```/g, '').trim());
        const parsed = JSON.parse(jsonStr);
        return {
            coreIdea: normalizeToOneSentenceCoreIdea(parsed?.coreIdea || '', chasiContent),
            question: asPlainText(parsed?.question || '').trim()
        };
    } catch (_) {
        return { coreIdea: '', question: '' };
    }
}


function enforceQuestionByStandard({ question, standard, chasiContent, baseCoreIdea, area, subject }) {
    const keywords = buildKeywordPool({ standard, chasiContent, baseCoreIdea, area, subject });
    if (isQuestionAcceptable(question, keywords, subject, area)) return String(question).trim();
    return buildFallbackQuestion({ keywords, subject });
}

function enforceMathCoreIdea(coreIdea, standard, chasiContent) {
    const idea = String(coreIdea || '').trim();
    const standardText = extractStandardTextWithoutCode(standard);
    const standardKeywords = extractMeaningfulKeywords(standardText);
    const hasBarGraph = /막대그래프/.test(standardText) || /막대그래프/.test(chasiContent || '');

    const mustHave = hasBarGraph
        ? ['막대그래프', '자료', '해석']
        : standardKeywords.slice(0, 3);

    const isValid = idea &&
        !/본질은/.test(idea) &&
        mustHave.every((k) => !k || idea.includes(k));

    if (isValid) return idea.endsWith('.') ? idea : `${idea}.`;

    if (hasBarGraph) {
        return '자료의 수량은 막대의 길이로 표현되고, 막대그래프는 항목별 수량을 비교하고 해석하는 데 활용된다.';
    }
    if (standardKeywords.length >= 2) {
        return `${standardKeywords[0]}와 ${standardKeywords[1]}의 관계는 해당 차시의 자료를 통해 표현되고 해석된다.`;
    }
    return '해당 차시의 수학 개념은 자료를 통해 표현되고 비교되며 해석된다.';
}

function enforceMathQuestion(question, standard, chasiContent) {
    const q = String(question || '').trim();
    const standardText = extractStandardTextWithoutCode(standard);
    const hasBarGraph = /막대그래프/.test(standardText) || /막대그래프/.test(chasiContent || '');
    const isValid = q && q.includes('?') && !/우리 지역을 소개/.test(q) && /자료|막대그래프|비교|해석/.test(q);
    if (isValid) return q;

    if (hasBarGraph) {
        return '수집한 자료를 막대그래프로 나타내면 어떤 항목이 가장 많고 가장 적은지, 그 이유를 어떻게 설명할 수 있을까요?';
    }
    return '이 차시의 자료를 어떻게 나타내고 비교하면 근거 있게 설명할 수 있을까요?';
}

async function generateRestatedCoreIdeaSentenceByAI(apiKey, options) {
    const { subject, area, baseCoreIdea, chasiContent, unitName, lesson, topic, objective } = options || {};
    if (!apiKey) return '';
    if (!baseCoreIdea) return '';
    const sentenceContext = asPlainText(chasiContent || topic || objective || `${asPlainText(area) || asPlainText(subject) || '해당 교과'} 학습`);
    const prompt = `다음 정보를 바탕으로 핵심 아이디어를 정확히 한 문장으로 재진술하세요.

[영역별 원문 핵심 아이디어]
${baseCoreIdea}

[차시 정보]
- 단원: ${asPlainText(unitName) || '-'}
- 차시: ${asPlainText(lesson) || '-'}차시
- 차시별 주요 학습 내용: ${asPlainText(chasiContent) || '-'}
- 학습 주제: ${asPlainText(topic) || '-'}
- 학습 목표: ${asPlainText(objective) || '-'}

[작성 규칙]
1) 반드시 한 문장만 작성.
2) 반드시 "...은 ...이다." 형태를 지킬 것.
3) 원문 핵심 아이디어의 핵심 용어를 2개 이상 포함.
4) 성취기준 코드는 넣지 말 것.
5) 문장에 "핵심 아이디어" 또는 "핵심아이디어"라는 단어를 쓰지 말 것.
6) 다른 설명 없이 문장만 출력.`;
    try {
        const { data } = await callGeminiWithFallback(apiKey, {
            contents: [{ role: 'user', parts: [{ text: prompt }] }],
            generationConfig: { maxOutputTokens: 120 }
        });
        const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        return normalizeToOneSentenceCoreIdea(raw, sentenceContext);
    } catch (_) {
        return '';
    }
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

async function handler(req, res) {
    if (req.method !== 'POST') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }

    const { grade, semester, subject, unit, lesson, unitName, lessonType } = req.body || {};
    const resolvedLessonType = lessonType === 'inquiry' ? 'inquiry' : 'general';
    const resolvedUnit = (unitName || unit || '').replace(/[\u201c\u201d\u2018\u2019\u2026]/g, '');
    const apiKey = (process.env.GEMINI_API_KEY || '').trim();

    if (!apiKey) {
        return res.status(500).json({ error: '서버 설정 오류로 생성할 수 없습니다.' });
    }

    const chasiContent = getChasiActivity(grade, subject || '국어', resolvedUnit, lesson);
    const chasiBlock = chasiContent
        ? `\n[★★★ 이 차시의 핵심 - 반드시 그대로 반영, 축약·변형·다른 내용 대체 금지 ★★★]\n${lesson}차시 주요 학습 내용 및 활동: ${chasiContent}\n`
        : `\n[참고] 연간지도 계획에서 이 단원·차시에 해당하는 "차시별 주요 활동"을 찾지 못했습니다. 선택한 단원(${resolvedUnit})과 ${lesson}차시에 맞게, 해당 교과 성취기준과 연계하여 학습 주제·목표와 활동을 작성하세요.\n`;

    const { block: standardsBlock, fallback: standardsFallback, standardsForLookup } = getStandardsBlock(grade, subject || '국어', resolvedUnit, chasiContent);
    const areaHint = standardsForLookup.find(s => s.영역)?.영역 || '';
    const coreIdeaSource = getCoreIdeaFromFile(subject || '국어', areaHint);
    const coreIdeaGuideBlock = coreIdeaSource
        ? `\n[원문 핵심 아이디어 - 용어 유지 필수]\n${coreIdeaSource}\n`
        : '';

    const modelId = GENERATION_MODELS[0];
    const lessonTypeLabel = resolvedLessonType === 'inquiry' ? '개념기반 탐구수업형' : '일반형';
    const lessonTypeGuide = resolvedLessonType === 'inquiry'
        ? '7. 교수·학습 활동은 탐구질문 기반 흐름으로 구성할 것: 도입(탐구 질문 제시) → 전개1(탐구1: 자료 탐색·근거 찾기) → 전개2(탐구2: 적용·실행/문제 해결) → 전개3(공유: 주장·근거 발표 및 상호질문) → 정리(성찰: 처음 생각-바뀐 생각-이유).'
        : '7. 교수·학습 활동은 일반형 흐름으로 구성할 것: 도입(학습 동기·과제 안내) → 전개1/2/3(핵심 기능 학습·적용·확인) → 정리(학습 내용 정리·다음 차시 예고). 탐구 질문은 보조적으로 활용하되, 활동명을 탐구1/탐구2로 강제하지 않는다.';
    const lessonTypeActivityRule = resolvedLessonType === 'inquiry'
        ? `5. 활동명은 아래 구조를 기본으로 차시 맥락에 맞게 구체화:
- 도입: 탐구 질문 열기/탐구 문제 인식
- 전개1: 탐구1(자료 탐색·근거 찾기)
- 전개2: 탐구2(적용·실행/문제 해결)
- 전개3: 공유(주장·근거 발표, 상호 질문)
- 정리: 성찰(처음 생각-바뀐 생각-이유, 다음 탐구 연결)`
        : `5. 활동명은 차시 목표와 핵심 활동이 드러나게 구체화:
- 도입: 학습 동기 유발/학습 문제 확인
- 전개1: 핵심 개념·기능 이해
- 전개2: 적용·연습/실습
- 전개3: 확인·공유/피드백
- 정리: 배운 내용 정리·형성평가·다음 차시 연결`;
    const systemPrompt = `
당신은 2022 개정 교육과정에 정통한 초등학교 수업 설계 전문가입니다.
2022 개정 교육과정 가이드라인을 준수하여 교수학습 과정안(약안) 초안을 작성하세요.

[수업 형식]
- 선택된 형식: ${lessonTypeLabel}

[수업 설계 흐름 - 반드시 이 순서로 설계]
1. 아래 [★★★ 이 차시의 핵심 ★★★]에 나온 "N차시 주요 학습 내용 및 활동" 문장이 곧 이 차시의 학습 내용입니다. 이 문장을 축약·변형·다른 내용으로 대체하지 말고 그대로 반영할 것.
2. **학습 주제(topic)·학습 목표(objective)**는 위 "주요 학습 내용 및 활동"에서 **그대로 뽑아** 사용. 다른 표현으로 바꾸거나 엉뚱한 단원/차시 내용으로 대체하지 않음.
3. 이 차시 주요 활동과 직접 관련된 성취기준·핵심아이디어만 선택. 해당 차시와 무관한 성취기준(다른 단원·영역)은 넣지 않음.
4. 위 주요 활동을 해결하기 위한 탐구 질문(question)을 한 개 작성.
5. 수업·평가 주안점으로 수업의도(intent) 작성, 그 의도에 맞게 평가계획 작성.
6. 40분 수업: 도입 1개 + 전개 2~3개(활동1·활동2·활동3) + 정리 1개. 전개 활동은 [이 차시의 핵심]에 제시된 "주요 학습 내용 및 활동"을 구체화한 내용으로 작성할 것.
${lessonTypeGuide}
(요약: objective·topic·전개 활동은 모두 [이 차시의 핵심] 블록의 "주요 학습 내용 및 활동"과 일치해야 함.)
${chasiBlock}
${standardsBlock}
${coreIdeaGuideBlock}
[입력 정보]
- 학년: ${grade}학년, 학기: ${semester}학기, 교과: ${subject}
- 단원: ${resolvedUnit}
- 차시: ${lesson}차시

[작성 원칙]
1. 모든 출력은 한국어로 작성.
2. activities는 반드시 배열로 작성. 각 항목에 단계, 형태, 활동, 시간, 자료, 유의점, 평가, 교사, 학생 필드를 포함.
3. activities 기호: 교사 열 첫 줄은 ●(검은 동그라미)로 활동 주제(예: ● 사전 지식 활성화하기, ● 활동1). 다음 줄: ○=구체적 지시, -=발문·질문. 학생=예상 반응. 자료=자료명. 유의점=지도 시 유의사항. 평가=(관찰) 등.
4. 교수·학습 활동: 도입 1개 + 전개 3개(활동1·활동2·활동3, 실현 어려우면 2개) + 정리 1개. 전개에서 탐구질문·문제 해결을 위한 활동, 정리에서 마무리 활동을 제시.
${lessonTypeActivityRule}
6. model(교수·학습 모형)은 "해당 차시를 운영하는 수업 절차 프레임"이며, 활동명이 아니라 모형명으로 선택한다.
7. model은 반드시 아래 중 1개 모형명을 사용한다: 문제해결학습, 개념형성학습, 발견학습, 탐구학습, 협동학습, 프로젝트학습, 직접교수, 토의토론학습, 역할놀이학습.
8. model 출력 형식은 "모형명 - 해당 차시에 맞는 적용 근거 1문장"으로 작성한다.

[★★★ 교수·학습 활동 - 반드시 해당 차시에 맞게 구체화 ★★★]
- 교과·단원·차시별 주요활동이 다르면 활동 내용이 완전히 달라야 함. 같은 템플릿을 모든 수업에 적용하지 말 것.
- 예: 국어 "인물 관계·이야기 흐름" → 읽기 자료·인물 관계도·이야기 흐름 파악 활동. 국어 "대화 생략 추론" → 대화 자료·생략된 내용 짐작 활동. 수학 "합동" → 도형·합동 판별·성질 탐구 활동.
- 교사·학생 열에 해당 차시 학습 내용에 맞는 구체적 자료명, 발문, 활동, 예상 반응을 작성할 것. "자료를 배부한다", "모둠별로 탐구한다" 같은 추상적 표현만 쓰지 말 것.
- 활동 이름(활동 필드)도 차시에 맞게 구체화할 것. 예: "활동1 - 인물 관계 파악하기", "활동1 - 대화에서 생략된 내용 짐작하기", "활동1 - 합동인 도형 찾기".

[출력 형식 - 순수 JSON만]
마크다운 없이 JSON만 반환하세요.
- area: 해당 교과 교육과정의 영역 (예: 듣기·말하기, 읽기, 문학, 매체).
- coreIdea: 영역 핵심 아이디어를 기반으로 해당 차시(단원·학습 내용)에 맞게 재진술. 성취기준 코드 넣지 말 것.
- coreIdea는 [원문 핵심 아이디어]와 차시별 주요 학습 내용을 바탕으로 Gemini가 재진술한 정확히 한 문장만 사용.
- coreIdea 문장 형식: 반드시 "...은 ...이다." (한 문장, 마침표 포함).
- coreIdea 문장에는 "핵심 아이디어/핵심아이디어"라는 단어를 쓰지 말 것.
- competency: 해당 교과 **공식 교과역량 명칭으로 1~2개만**(쉼표 또는 줄바꿈으로 구분). **3개 이상 나열 금지.** 교과 전체 역량을 한 줄에 모두 적지 말 것.
- objective: 학습 목표 한 문장 ("~할 수 있다" 형태).
- topic: 학습 주제 (학습 목표와 구분하여 별도).
- evaluationPlan: 평가 계획 표. 범주(평가방법), 평가요소, 수준(상/중/하), 피드백 포함. 1~3행.
{
  "competency": "해당 교과 공식 교과역량 정확한 명칭 1~2개만(나열·전부 나열 금지)",
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
    { "단계": "도입", "형태": "전체", "활동": "탐구 질문 열기", "교사": "● 탐구 질문 열기\n○ 차시와 연결된 실제 사례·자료를 제시한다.\n- 오늘 우리가 풀어야 할 탐구 질문은 무엇일까요?\n- 왜 이 질문을 탐구할 가치가 있을까요?", "학생": "○ 제시 자료를 관찰하고 첫 생각을 말한다.\n- 예상 답을 자유롭게 제시한다.", "시간": "5", "자료": "사진·PPT 등 자료명", "유의점": "학생의 다양한 관찰을 수용하고 질문의 초점을 분명히 한다.", "평가": "(관찰) 참여 태도·질문 이해" },
    { "단계": "전개", "형태": "모둠", "활동": "활동1 - 탐구1(자료 탐색·근거 찾기)", "교사": "● 활동1 - 탐구1\n○ 자료를 탐색하도록 안내하고 관찰 기준을 제시한다.\n- 어떤 정보가 탐구 질문 해결에 중요한 근거가 되나요?\n- 근거를 2가지 이상 찾아 기록해 보세요.", "학생": "○ 자료를 탐색하며 핵심 정보와 근거를 찾는다.\n- 근거를 모둠 기록지에 정리한다.", "시간": "10", "자료": "탐구 자료, 기록지", "유의점": "정답 제시보다 근거 기반 설명을 강조한다.", "평가": "(관찰) 자료 탐색·근거 추출" },
    { "단계": "전개", "형태": "모둠", "활동": "활동2 - 탐구2(적용·실행/문제 해결)", "교사": "● 활동2 - 탐구2\n○ 찾은 근거를 바탕으로 해결안을 구성·실행하도록 안내한다.\n- 우리 모둠의 해결안(또는 표현안)은 무엇인가요?\n- 근거와 연결해 설명해 보세요.", "학생": "○ 근거를 바탕으로 해결안(또는 표현안)을 만들고 수정한다.\n- 역할을 나누어 산출물을 완성한다.", "시간": "12", "자료": "활동지, 표현·실습 도구", "유의점": "과정 중간 피드백으로 수정 기회를 제공한다.", "평가": "(관찰/실기) 적용·실행 과정" },
    { "단계": "전개", "형태": "전체", "활동": "활동3 - 공유(주장·근거 발표/상호질문)", "교사": "● 활동3 - 공유\n○ 모둠별 발표를 진행하고 상호 질문을 촉진한다.\n- 우리 모둠의 주장을 한 문장으로 말해 볼까요?\n- 그 주장을 뒷받침하는 근거는 무엇인가요?", "학생": "○ 모둠 산출물을 발표한다.\n- 다른 모둠의 질문에 근거를 들어 답한다.", "시간": "8", "자료": "학생 산출물", "유의점": "근거 없는 주장보다 논리적 설명을 격려한다.", "평가": "(관찰) 발표·의사소통" },
    { "단계": "정리", "형태": "전체", "활동": "성찰·다음 탐구 연결", "교사": "● 성찰·다음 탐구 연결\n○ 오늘 탐구 과정을 돌아보게 한다.\n- 처음 생각과 지금 생각은 어떻게 달라졌나요?\n- 생각이 바뀐 이유는 무엇인가요?", "학생": "○ 처음 생각-바뀐 생각-바뀐 이유를 말하거나 쓴다.\n- 다음 차시에서 더 탐구할 점을 정한다.", "시간": "5", "자료": "성찰 기록지", "유의점": "성과뿐 아니라 변화 과정을 언어화하도록 지도한다.", "평가": "(자기평가/관찰) 성찰의 구체성" }
  ]
}
`;

    try {
        const body = {
            contents: [{ role: 'user', parts: [{ text: systemPrompt }] }],
            generationConfig: { responseMimeType: 'application/json' }
        };
        const { data: apiData } = await callGeminiWithFallback(apiKey, body);
        const text = apiData?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        if (!text) throw new Error('AI 응답이 비어 있습니다.');

        const jsonStr = sanitizeJsonText(text.replace(/```json/g, '').replace(/```/g, '').trim());
        const data = JSON.parse(jsonStr);

        if (!data.standard || String(data.standard).trim() === '') {
            if (standardsFallback) data.standard = standardsFallback;
        } else if (standardsForLookup.length > 0) {
            // 기존 보정 로직 유지 후, 마지막에 "원문 데이터 완전 일치" 강제
            data.standard = normalizeStandardFormat(data.standard, standardsForLookup);
            data.standard = ensureFullStandard(data.standard, standardsForLookup);
        }
        data.standard = resolveStandardFromSourceOnly(data.standard, standardsForLookup, standardsFallback);
        const selectedStandardRow = standardsForLookup.find((s) =>
            String(s?.성취기준 || '').trim() === String(data.standard || '').trim()
        );
        if (selectedStandardRow?.영역) data.area = selectedStandardRow.영역;
        const resolvedArea = data.area || areaHint || selectedStandardRow?.영역 || '';
        const baseCoreIdea = getCoreIdeaFromFile(subject || '국어', resolvedArea) || coreIdeaSource;
        data.coreIdea = baseCoreIdea || '';
        // 핵심아이디어는 교육과정 원문(핵심아이디어.txt) 그대로 사용
        let enforcedCoreIdea = data.coreIdea;
        let enforcedQuestion = enforceQuestionByStandard({
            question: data.question,
            standard: data.standard,
            chasiContent,
            baseCoreIdea,
            area: resolvedArea,
            subject: subject || '국어'
        });

        const keywordPool = buildKeywordPool({
            standard: data.standard,
            chasiContent,
            baseCoreIdea,
            area: resolvedArea,
            subject: subject || '국어'
        });

        // 검증 실패 시 1회 AI 재보정 후 다시 검증
        if (!isQuestionAcceptable(enforcedQuestion, keywordPool, subject || '국어', resolvedArea)) {
            const repaired = await regenerateCoreIdeaAndQuestionByAI(apiKey, {
                subject: subject || '국어',
                area: resolvedArea,
                standard: data.standard,
                baseCoreIdea,
                chasiContent,
                unitName: resolvedUnit,
                lesson,
                currentCoreIdea: enforcedCoreIdea,
                currentQuestion: enforcedQuestion
            });
            enforcedQuestion = enforceQuestionByStandard({
                question: repaired.question || enforcedQuestion,
                standard: data.standard,
                chasiContent,
                baseCoreIdea,
                area: resolvedArea,
                subject: subject || '국어'
            });
        }

        data.coreIdea = enforcedCoreIdea;
        data.question = enforcedQuestion;
        data.model = normalizeModelField(data.model, subject || '국어', data.topic, data.objective);

        let activitiesText = '';
        try {
            if (data.activities && Array.isArray(data.activities)) {
                activitiesText = data.activities
                    .map((a) => [a.활동, a.교사, a.학생].filter(Boolean).join(' '))
                    .join('\n');
            }
        } catch (_) {}
        data.competency = selectSubjectCompetencies(subject || '국어', {
            standard: data.standard,
            chasiContent,
            area: resolvedArea,
            objective: data.objective,
            topic: data.topic,
            intent: data.intent,
            question: data.question,
            coreIdea: data.coreIdea,
            activitiesText,
            rawAiCompetency: data.competency
        });

        if (data.activities && !Array.isArray(data.activities)) {
            data.activities = [{ 단계: '전개', 형태: '전체', 활동: String(data.activities), 시간: '40', 자료: '', 유의점: '', 평가: '', 교사: '◉', 학생: '◦' }];
        }

        res.status(200).json(data);
    } catch (error) {
        console.error('AI generate error:', error);
        const msg = error?.message || 'AI 생성 실패';
        const isOverloaded = /UNAVAILABLE|RESOURCE_EXHAUSTED|503|overloaded|high demand/i.test(msg);
        res.status(500).json({
            error: 'AI 생성 실패',
            details: isOverloaded
                ? 'Gemini 모델이 현재 과부하 상태입니다. 잠시 후 다시 시도해 주세요.'
                : '요청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
        });
    }
}

module.exports = handler;
module.exports.config = config;
