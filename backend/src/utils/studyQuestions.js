import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let cachedQuestions = null;

function cleanText(text = '') {
  return String(text).replace(/\s+/g, '').toLowerCase();
}

function matchQuestion(questionFromDB, actualQuestion) {
  const db = cleanText(questionFromDB);
  const actual = cleanText(actualQuestion);
  if (!db || !actual) return false;
  return actual.includes(db) || db.includes(actual);
}

function loadQuestionFile() {
  if (cachedQuestions) {
    return cachedQuestions;
  }

  const candidates = [
    path.resolve(__dirname, '../../public/answer.json'),
    path.resolve(__dirname, '../../../public/answer.json'),
    path.resolve(process.cwd(), 'public/answer.json'),
  ];

  for (const filePath of candidates) {
    try {
      if (!fs.existsSync(filePath)) continue;
      const raw = fs.readFileSync(filePath, 'utf8');
      const data = JSON.parse(raw);
      if (Array.isArray(data)) {
        cachedQuestions = data;
        console.log(`✅ 答题题库已加载: ${filePath} (${data.length}题)`);
        return cachedQuestions;
      }
    } catch (error) {
      console.warn(`⚠️ 读取题库失败: ${filePath}`, error.message);
    }
  }

  cachedQuestions = [];
  console.warn('⚠️ 未找到答题题库 answer.json，将使用默认答案');
  return cachedQuestions;
}

export function findAnswer(questionText) {
  const questions = loadQuestionFile();
  for (const item of questions) {
    if (!item?.name || !item?.value) continue;
    if (matchQuestion(item.name, questionText)) {
      return Number(item.value) || 1;
    }
  }
  return null;
}

