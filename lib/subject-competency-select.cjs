'use strict';

/**
 * 2022 개정 초등 교과별 공식 교과역량(교육과정 총론·각론 명칭에 준함) 중
 * 차시 맥락(성취기준·활동·영역 등)과의 키워드 정합으로 1~2개만 선택.
 */

function normalizeSubject(subject) {
    return String(subject || '').replace(/\s+/g, '').trim() || '국어';
}

function buildHaystack(opts) {
    const parts = [
        opts.standard,
        opts.chasiContent,
        opts.area,
        opts.objective,
        opts.topic,
        opts.intent,
        opts.question,
        opts.coreIdea,
        opts.activitiesText,
        opts.rawAiCompetency
    ];
    return parts.filter(Boolean).join('\n');
}

function scoreItem(hay, kwList) {
    if (!hay || !kwList?.length) return 0;
    let s = 0;
    for (const kw of kwList) {
        if (!kw) continue;
        if (hay.includes(kw)) s += kw.length >= 3 ? 3 : 2;
    }
    return s;
}

function pickTop(cfg, hay, maxPick) {
    const scored = cfg.competencies.map((c) => ({
        name: c.name,
        score: scoreItem(hay, c.kw)
    }));
    scored.sort((a, b) => b.score - a.score);
    const first = scored[0];
    if (!first || first.score === 0) {
        return (cfg.fallback || []).slice(0, maxPick);
    }
    const out = [first.name];
    const second = scored[1];
    if (second && second.score > 0 && second.score >= Math.max(2, Math.floor(first.score * 0.35))) {
        out.push(second.name);
    }
    if (out.length === 1 && maxPick === 2 && cfg.fallback?.length) {
        const extra = cfg.fallback.find((n) => n !== out[0]);
        if (extra) out.push(extra);
    }
    return out.slice(0, maxPick);
}

const SUBJECT_CONFIG = {
    국어: {
        competencies: [
            { name: '비판적·창의적 사고 역량', kw: ['비판', '추론', '근거', '분석', '문학', '짐작', '추측', '비교', '판단', '해석', '논리', '생략', '인과', '요약', '주장'] },
            { name: '디지털·미디어 역량', kw: ['디지털', '미디어', '영상', '뉴스', '정보', '온라인', '검색', '자료', '매체', '멀티'] },
            { name: '의사소통 역량', kw: ['듣기', '말하기', '토의', '토론', '발표', '대화', '질문', '설명', '말하', '듣고', '이야기'] },
            { name: '공동체·대인 관계 역량', kw: ['모둠', '협력', '친구', '함께', '경청', '예의', '공동체', '협동', '배려', '소통'] },
            { name: '문화 향유 역량', kw: ['문화', '전통', '감상', '작품', '글', '시', '노래', '놀이'] },
            { name: '자기 성찰·계발 역량', kw: ['성찰', '계획', '목표', '자기', '독서', '습관', '기록', '피드백'] }
        ],
        fallback: ['의사소통 역량', '비판적·창의적 사고 역량']
    },
    수학: {
        competencies: [
            { name: '수학적 문제해결 역량', kw: ['문제', '해결', '전략', '상황', '실생활', '맥락', '문제해결'] },
            { name: '수학적 추론 역량', kw: ['추론', '규칙', '아이디어', '설명', '타당', '논리', '성질'] },
            { name: '수학적 의사소통 역량', kw: ['표현', '설명', '듣', '말', '토의', '발표', '기호', '말하기'] },
            { name: '수학적 연결 역량', kw: ['연결', '관계', '다른', '도형', '그래프', '실생활', '모델'] },
            { name: '수학적 정보처리 역량', kw: ['자료', '그래프', '표', '수집', '정리', '해석', '막대', '도수', '평균', '확률'] }
        ],
        fallback: ['수학적 문제해결 역량', '수학적 의사소통 역량']
    },
    과학: {
        competencies: [
            { name: '과학적 탐구 능력', kw: ['관찰', '실험', '측정', '분류', '기록', '탐구', '조사', '비교'] },
            { name: '과학적 사고력', kw: ['가설', '변인', '통제', '자료', '해석', '설명', '모형', '추론'] },
            { name: '과학적 의사소통 능력', kw: ['발표', '토의', '그래프', '표', '설명', '근거', '토론'] },
            { name: '과학적 문제 해결력', kw: ['문제', '해결', '설계', '개선', '적용', '안'] },
            { name: '과학적 참여와 평생 학습 능력', kw: ['안전', '환경', '생활', '과학기술', '윤리', '지속'] }
        ],
        fallback: ['과학적 탐구 능력', '과학적 의사소통 능력']
    },
    사회: {
        competencies: [
            { name: '인문적 탐구 능력', kw: ['역사', '문화', '인물', '사건', '자료', '시대', '생활사'] },
            { name: '공간적 탐구 능력', kw: ['지도', '지역', '위치', '공간', '이동', '분포', '환경'] },
            { name: '시민적 참여 능력', kw: ['시민', '참여', '공동체', '규칙', '권리', '의무', '투표', '봉사'] },
            { name: '비판적 사고 능력', kw: ['비판', '근거', '관점', '비교', '분석', '판단', '신뢰'] },
            { name: '디지털·미디어 능력', kw: ['디지털', '미디어', '정보', '검색', '자료', '온라인'] }
        ],
        fallback: ['인문적 탐구 능력', '비판적 사고 능력']
    },
    도덕: {
        competencies: [
            { name: '도덕적 가치 판단 역량', kw: ['가치', '판단', '옳', '그름', '양심', '정의', '공정'] },
            { name: '도덕적 관계 형성 역량', kw: ['관계', '친구', '가족', '존중', '배려', '소통', '갈등'] },
            { name: '도덕적 의사소통 역량', kw: ['대화', '경청', '설득', '표현', '토의', '약속'] },
            { name: '도덕적 실천 역량', kw: ['실천', '습관', '생활', '약속', '봉사', '돌봄', '행동'] },
            { name: '도덕적 성찰·관리 역량', kw: ['성찰', '책임', '자기', '계획', '조절', '감정'] }
        ],
        fallback: ['도덕적 실천 역량', '도덕적 관계 형성 역량']
    },
    음악: {
        competencies: [
            { name: '음악적 표현 역량', kw: ['표현', '노래', '리듬', '박자', '음악', '소리', '악기'] },
            { name: '음악적 감상 역량', kw: ['감상', '느낌', '곡', '악곡', '특징', '요소', '장단'] },
            { name: '음악적 창작 역량', kw: ['창작', '작곡', '즉흥', '만들', '편곡', '아이디어'] },
            { name: '음악적 연주·노래 역량', kw: ['연주', '반주', '합주', '연습', '기술', '악보'] },
            { name: '음악 문화 향유 역량', kw: ['문화', '전통', '민요', '세계', '다양', '배경'] }
        ],
        fallback: ['음악적 표현 역량', '음악적 감상 역량']
    },
    미술: {
        competencies: [
            { name: '심미적 감성 역량', kw: ['감상', '느낌', '색', '질감', '아름', '미적', '감각'] },
            { name: '창의·융합 역량', kw: ['창의', '융합', '상상', '새롭', '재료', '조합'] },
            { name: '시각적 소통 역량', kw: ['시각', '그림', '도안', '표현', '기호', '이미지', '포스터'] },
            { name: '정체성 역량', kw: ['자신', '주제', '경험', '이야기', '개성', '생각'] },
            { name: '공동체 역량', kw: ['모둠', '함께', '협력', '전시', '피드백', '존중'] }
        ],
        fallback: ['시각적 소통 역량', '창의·융합 역량']
    },
    실과: {
        competencies: [
            { name: '창의·융합적 설계 역량', kw: ['설계', '아이디어', '모형', '제작', '만들', '창의', '융합'] },
            { name: '문제 해결과 혁신 실천 역량', kw: ['문제', '해결', '개선', '시행착오', '실험', '검증'] },
            { name: '디지털·기술 활용 역량', kw: ['디지털', '코딩', '로봇', '정보', '기술', 'AI', '프로그램'] },
            { name: '지속가능한 삶 실천 역량', kw: ['환경', '자원', '절약', '지속', '안전', '건강', '생활'] },
            { name: '공동체·협력 역량', kw: ['모둠', '협력', '역할', '함께', '발표', '피드백'] }
        ],
        fallback: ['창의·융합적 설계 역량', '문제 해결과 혁신 실천 역량']
    },
    영어: {
        competencies: [
            { name: '영어 의사소통 역량', kw: ['말하기', '듣기', '읽기', '쓰기', '대화', '발표', '질문', 'English', 'sentence'] },
            { name: '자기주도적 학습 역량', kw: ['스스로', '계획', '복습', '목표', '전략', '기록'] },
            { name: '공감·협업 역량', kw: ['모둠', '협력', 'pair', '역할', '함께', '피드백'] },
            { name: '문화간 이해·소통 역량', kw: ['문화', '나라', '습관', '인사', '다양', '비교'] },
            { name: '정보·매체 활용 역량', kw: ['동영상', '자료', '검색', '미디어', '온라인', '앱'] }
        ],
        fallback: ['영어 의사소통 역량', '자기주도적 학습 역량']
    },
    체육: {
        competencies: [
            { name: '신체활동 수행 역량', kw: ['달리', '던지', '받', '기본', '움직임', 'FMS', '신체', '뛰'] },
            { name: '스포츠 참여 역량', kw: ['경기', '규칙', '팀', '공격', '수비', '전술', '스포츠'] },
            { name: '신체 표현 역량', kw: ['표현', '춤', '리듬', '무용', '동작', '연출'] },
            { name: '건강·체력 관리 역량', kw: ['체력', '건강', '스트레칭', '호흡', '운동량', '생활'] },
            { name: '안전·도전 실천 역량', kw: ['안전', '도전', '규칙', '보호', '장애', '도구'] }
        ],
        fallback: ['신체활동 수행 역량', '건강·체력 관리 역량']
    },
    바른생활: {
        competencies: [
            { name: '자기관리·실천 역량', kw: ['습관', '시간', '정리', '계획', '약속', '스스로', '생활'] },
            { name: '대인·관계 형성 역량', kw: ['친구', '가족', '경청', '배려', '사과', '인사', '갈등'] },
            { name: '공동체 참여 역량', kw: ['학교', '모둠', '규칙', '역할', '함께', '봉사'] },
            { name: '안전·건강 생활 역량', kw: ['안전', '교통', '건강', '위생', '응급', '보행'] },
            { name: '바른 생활 태도 역량', kw: ['정직', '책임', '공정', '배려', '예절', '약속'] }
        ],
        fallback: ['자기관리·실천 역량', '대인·관계 형성 역량']
    },
    슬기로운생활: {
        competencies: [
            { name: '탐구·활용 역량', kw: ['탐구', '관찰', '조사', '실험', '기록', '비교', '자료'] },
            { name: '문제해결·실천 역량', kw: ['문제', '해결', '방법', '시도', '개선', '적용'] },
            { name: '표현·소통 역량', kw: ['발표', '그림', '표', '설명', '발표', '표현'] },
            { name: '협력·공동체 역량', kw: ['모둠', '협력', '역할', '함께', '토의'] },
            { name: '안전·건강·환경 역량', kw: ['안전', '건강', '환경', '위생', '절약'] }
        ],
        fallback: ['탐구·활용 역량', '문제해결·실천 역량']
    },
    즐거운생활: {
        competencies: [
            { name: '심미·감상 역량', kw: ['감상', '느낌', '아름', '음악', '미술', '표현', '감각'] },
            { name: '창의·표현 역량', kw: ['만들', '창작', '놀이', '표현', '상상', '그리'] },
            { name: '문화 향유 역량', kw: ['문화', '전통', '축제', '노래', '놀이'] },
            { name: '협력·참여 역량', kw: ['모둠', '함께', '발표', '공유', '감상'] },
            { name: '자기표현·성찰 역량', kw: ['성찰', '느낌', '말하기', '기록'] }
        ],
        fallback: ['창의·표현 역량', '심미·감상 역량']
    }
};

/**
 * @param {string} subject
 * @param {object} opts
 * @param {string} [opts.standard]
 * @param {string} [opts.chasiContent]
 * @param {string} [opts.area]
 * @param {string} [opts.objective]
 * @param {string} [opts.topic]
 * @param {string} [opts.intent]
 * @param {string} [opts.question]
 * @param {string} [opts.coreIdea]
 * @param {string} [opts.activitiesText]
 * @param {string} [opts.rawAiCompetency]
 * @returns {string} 줄바꿈으로 1~2개 연결 (UI에서 <br> 처리)
 */
function selectSubjectCompetencies(subject, opts = {}) {
    const sub = normalizeSubject(subject);
    let cfg = SUBJECT_CONFIG[sub];
    if (!cfg) {
        cfg = SUBJECT_CONFIG.국어;
    }
    const hay = buildHaystack(opts);
    const picked = pickTop(cfg, hay, 2);
    return picked.join('\n');
}

module.exports = { selectSubjectCompetencies, normalizeSubject, SUBJECT_CONFIG };
