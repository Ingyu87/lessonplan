/**
 * 1~6학년 모든 교과 단원에 차시별_주요_활동 추가
 * 주요_학습_내용_및_활동을 차시별로 분배 (이미 있으면 건너뜀)
 */
const fs = require('fs');
const path = require('path');

const planPath = path.join(__dirname, '연간지도_계획.json');
const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));

function splitActivities(text) {
    if (!text || typeof text !== 'string') return [];
    return text
        .split(/[,·]\s*|및\s+/)
        .map(s => s.trim())
        .filter(Boolean);
}

function generateChasiActivities(unit) {
    if (unit.차시별_주요_활동 && unit.차시별_주요_활동.length > 0) return unit;
    const total = parseInt(unit.차시수, 10) || 1;
    const parts = splitActivities(unit.주요_학습_내용_및_활동);
    if (parts.length === 0) return unit;

    const result = [];
    const prep = ['배울 내용 살펴보기', '단원 도입', '배움 지도 살펴보기', '준비'];
    const end = ['배운 내용 실천', '마무리', '실천하기', '돌아보기', '확인', '정리'];
    const prepIdx = parts.findIndex(p => prep.some(k => p.includes(k)));
    const endIdx = parts.findIndex(p => end.some(k => p.includes(k)));

    let idx = 0;
    if (prepIdx >= 0 && total >= 1) {
        result.push({ 차시: '1', 구분: '준비', 내용: parts[prepIdx] });
        idx = 1;
    }
    const mainParts = parts.filter((_, i) => i !== prepIdx && (endIdx < 0 || i !== endIdx));
    const endParts = endIdx >= 0 ? [parts[endIdx]] : [];
    if (parts.length >= 2 && endIdx >= 0 && endIdx !== parts.length - 1) {
        endParts.push(parts[parts.length - 1]);
    }

    const mainCount = total - (prepIdx >= 0 ? 1 : 0) - endParts.length;
    const mainPer = mainCount > 0 && mainParts.length > 0
        ? Math.max(1, Math.floor(mainCount / mainParts.length))
        : 1;

    let chasi = prepIdx >= 0 ? 2 : 1;
    for (let i = 0; i < mainParts.length && chasi <= total; i++) {
        const span = i === mainParts.length - 1
            ? Math.min(mainPer, total - chasi - endParts.length + 1)
            : mainPer;
        const endChasi = Math.min(chasi + span - 1, total - endParts.length);
        const range = endChasi > chasi ? `${chasi}~${endChasi}` : `${chasi}`;
        result.push({ 차시: range, 구분: `활동${i + 1}`, 내용: mainParts[i] });
        chasi = endChasi + 1;
    }

    for (let i = 0; i < endParts.length && chasi <= total; i++) {
        const range = i === endParts.length - 1 && chasi === total
            ? `${chasi}`
            : (chasi < total - 1 ? `${chasi}~${total - endParts.length + i + 1}` : `${chasi}`);
        result.push({ 차시: range, 구분: '실천·마무리', 내용: endParts[i] });
        chasi = total - endParts.length + i + 2;
    }

    if (result.length === 0 && parts.length > 0) {
        const per = Math.max(1, Math.floor(total / parts.length));
        let c = 1;
        for (let i = 0; i < parts.length; i++) {
            const endC = i === parts.length - 1 ? total : Math.min(c + per - 1, total);
            result.push({
                차시: endC > c ? `${c}~${endC}` : `${c}`,
                구분: i === 0 ? '준비' : (i === parts.length - 1 ? '마무리' : `활동${i}`),
                내용: parts[i]
            });
            c = endC + 1;
        }
    }

    unit.차시별_주요_활동 = result;
    return unit;
}

let count = 0;
for (const entry of plan) {
    if (!entry.단원목록) continue;
    for (const unit of entry.단원목록) {
        if (!unit.차시별_주요_활동 || unit.차시별_주요_활동.length === 0) {
            generateChasiActivities(unit);
            count++;
        }
    }
}

fs.writeFileSync(planPath, JSON.stringify(plan, null, 2), 'utf8');
console.log(`차시별_주요_활동 추가 완료: ${count}개 단원`);
