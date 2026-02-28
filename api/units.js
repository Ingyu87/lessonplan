// Vercel Serverless: 단원 목록 조회 (연간지도_계획.json 기반)

import path from 'path';
import fs from 'fs';

function getGradeBand(grade) {
    const g = parseInt(grade, 10);
    if (g <= 2) return '1~2학년';
    if (g <= 4) return '3~4학년';
    return '5~6학년';
}

function loadAnnualPlan() {
    const baseDir = process.cwd();
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

    try {
        const standardsPath = path.join(process.cwd(), '2022개정교육과정 성취기준 및 해설.json');
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

export default function handler(req, res) {
    if (req.method !== 'GET') {
        return res.status(405).json({ error: 'Method Not Allowed' });
    }
    const { subject, grade } = req.query;
    if (!subject || !grade) {
        return res.status(400).json({ error: 'subject, grade 필요' });
    }
    const units = getUnitList(subject, grade);
    res.json({ units });
}
