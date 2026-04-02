import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let cachedQuestions = null;
let cachedQuestionBankStatus = null;

function cleanText(text = '') {
  return String(text).replace(/\s+/g, '').toLowerCase();
}

function matchQuestion(questionFromDB, actualQuestion) {
  const db = cleanText(questionFromDB);
  const actual = cleanText(actualQuestion);
  if (!db || !actual) return false;
  return actual.includes(db) || db.includes(actual);
}

function getQuestionBankCandidates() {
  return [
    path.resolve(__dirname, '../../../frontend/public/answer.json'),
    path.resolve(__dirname, '../../../frontend/dist/answer.json'),
    path.resolve(process.cwd(), '../frontend/public/answer.json'),
    path.resolve(process.cwd(), '../frontend/dist/answer.json'),
    path.resolve(process.cwd(), 'frontend/public/answer.json'),
    path.resolve(process.cwd(), 'frontend/dist/answer.json'),
    path.resolve(__dirname, '../../public/answer.json'),
    path.resolve(__dirname, '../../../public/answer.json'),
    path.resolve(process.cwd(), 'public/answer.json'),
  ];
}

function setQuestionBankStatus(status = {}) {
  cachedQuestionBankStatus = {
    loaded: Boolean(status.loaded),
    filePath: status.filePath || null,
    questionCount: Number(status.questionCount || 0),
    error: status.error || null,
    checkedCandidates: status.checkedCandidates || [],
  };
}

function loadQuestionFile() {
  if (cachedQuestions) {
    return cachedQuestions;
  }

  const candidates = [...new Set(getQuestionBankCandidates())];
  const checkedCandidates = [];

  for (const filePath of candidates) {
    checkedCandidates.push(filePath);

    try {
      if (!fs.existsSync(filePath)) continue;

      const raw = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        cachedQuestions = data;
        setQuestionBankStatus({
          loaded: true,
          filePath,
          questionCount: data.length,
          checkedCandidates,
        });
        return cachedQuestions;
      }

      console.warn(`⚠️ 答题题库格式无效: ${filePath}，期望为数组`);
    } catch (error) {
      console.warn(`⚠️ 读取题库失败: ${filePath}`, error.message);
    }
  }

  cachedQuestions = [];
  setQuestionBankStatus({
    loaded: false,
    filePath: null,
    questionCount: 0,
    error: '未找到可用的 answer.json',
    checkedCandidates,
  });
  return cachedQuestions;
}

export function preloadStudyQuestionBank() {
  const questions = loadQuestionFile();
  const status = getStudyQuestionBankStatus();

  if (status.loaded) {
    console.log(`🧠 答题题库加载完成：共加载 ${status.questionCount} 题，来源文件：${status.filePath}`);
  } else {
    console.warn(`⚠️ 答题题库未加载，已回退默认答案：共加载 0 题，已检查 ${status.checkedCandidates.length} 个路径`);
  }

  return questions;
}

export function getStudyQuestionBankStatus() {
  if (!cachedQuestionBankStatus) {
    loadQuestionFile();
  }

  return {
    ...cachedQuestionBankStatus,
    checkedCandidates: [...(cachedQuestionBankStatus?.checkedCandidates || [])],
  };
}

export function resolveStudyAnswer(questionText) {
  const questions = loadQuestionFile();
  for (const item of questions) {
    if (!item?.name || !item?.value) continue;
    if (matchQuestion(item.name, questionText)) {
      return {
        answer: Number(item.value) || 1,
        matched: true,
        matchedQuestion: item.name,
      };
    }
  }

  return {
    answer: 1,
    matched: false,
    matchedQuestion: null,
  };
}

export function findAnswer(questionText) {
  return resolveStudyAnswer(questionText).answer;
}
