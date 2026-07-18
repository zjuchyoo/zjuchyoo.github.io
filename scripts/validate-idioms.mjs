import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const sourcePath = path.resolve(process.argv[2] ?? 'study-assistant/index.html');
const source = fs.readFileSync(sourcePath, 'utf8');
const dataMatch = source.match(/window\.IDIOMS_DATA\s*=\s*(\[[\s\S]*?\r?\n\]);/);
if (!dataMatch) throw new Error('找不到 window.IDIOMS_DATA 数据块');

const idioms = JSON.parse(dataMatch[1]);
const errors = [];
const ids = new Set();
const words = new Map();

if (idioms.length !== 995) errors.push(`条目数量应为 995，实际为 ${idioms.length}`);

idioms.forEach((idiom, index) => {
  const expectedId = index + 1;
  if (idiom.id !== expectedId) errors.push(`位置 ${expectedId} 的 ID 为 ${idiom.id}`);
  if (ids.has(idiom.id)) errors.push(`ID 重复：${idiom.id}`);
  ids.add(idiom.id);
  if (typeof idiom.word !== 'string' || !idiom.word.trim()) errors.push(`ID ${idiom.id} 的词头为空`);
  if (typeof idiom.meaning !== 'string' || !idiom.meaning.trim()) errors.push(`ID ${idiom.id} 的释义为空`);
  if (/\uFFFD/.test(`${idiom.word}${idiom.meaning}`)) errors.push(`ID ${idiom.id} 含替换字符`);
  if (!words.has(idiom.word)) words.set(idiom.word, []);
  words.get(idiom.word).push(idiom.id);
});

const requiredHeadwords = new Map([
  [171, '妙趣横生'],
  [204, '珠联璧合'],
  [432, '以管窥天'],
]);
for (const [id, expectedWord] of requiredHeadwords) {
  const actual = idioms.find((idiom) => idiom.id === id)?.word;
  if (actual !== expectedWord) errors.push(`ID ${id} 词头应为“${expectedWord}”，实际为“${actual}”`);
}

for (const oldWord of ['妙趣橫生', '珠联壁合', '以管窺天']) {
  if (idioms.some((idiom) => idiom.word === oldWord)) errors.push(`仍含旧词头：${oldWord}`);
}

const requiredAliases = [
  "'171:妙趣橫生':'171:妙趣横生'",
  "'204:珠联壁合':'204:珠联璧合'",
  "'432:以管窺天':'432:以管窥天'",
];
for (const alias of requiredAliases) {
  if (!source.includes(alias)) errors.push(`缺少本地存储迁移：${alias}`);
}
if (!source.includes('marks:loadIdiomObject(STORAGE_KEY)')) errors.push('标记数据未接入迁移读取');
if (!source.includes('customMeanings:loadIdiomObject(CUSTOM_MEANINGS_KEY)')) errors.push('自定义释义未接入迁移读取');

const aliasSource = source.match(/const IDIOM_KEY_ALIASES=\{[\s\S]*?\};/)?.[0];
const loadObjectSource = source.match(/function loadObject\(key\)\{[^\r\n]+\}/)?.[0];
const saveObjectSource = source.match(/function saveObject\(key,value\)\{[^\r\n]+\}/)?.[0];
const loadIdiomObjectSource = source.match(/function loadIdiomObject\(key\)\{[\s\S]*?\r?\n\}/)?.[0];
let migrationTest = null;
if (!aliasSource || !loadObjectSource || !saveObjectSource || !loadIdiomObjectSource) {
  errors.push('无法提取本地存储迁移代码进行行为测试');
} else {
  const storage = new Map([
    ['marks', JSON.stringify({
      '171:妙趣橫生': 'yellow',
      '204:珠联壁合': 'red',
      '204:珠联璧合': 'green',
    })],
    ['meanings', JSON.stringify({ '432:以管窺天': '用户原有自定义释义' })],
  ]);
  const localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
  };
  const createHarness = new Function(
    'localStorage',
    `${aliasSource}\n${loadObjectSource}\n${saveObjectSource}\n${loadIdiomObjectSource}\nreturn {loadIdiomObject};`,
  );
  const harness = createHarness(localStorage);
  const migratedMarks = harness.loadIdiomObject('marks');
  const migratedMeanings = harness.loadIdiomObject('meanings');
  migrationTest = { migratedMarks, migratedMeanings };
  if (migratedMarks['171:妙趣横生'] !== 'yellow') errors.push('ID 171 旧标记迁移失败');
  if (migratedMarks['204:珠联璧合'] !== 'green') errors.push('ID 204 新标记被旧值覆盖');
  if ('171:妙趣橫生' in migratedMarks || '204:珠联壁合' in migratedMarks) errors.push('旧标记键迁移后未清理');
  if (migratedMeanings['432:以管窥天'] !== '用户原有自定义释义') errors.push('ID 432 自定义释义迁移失败');
  if ('432:以管窺天' in migratedMeanings) errors.push('旧自定义释义键迁移后未清理');
}

const inlineScripts = [...source.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)].map((match) => match[1]);
inlineScripts.forEach((script, index) => {
  try {
    new Function(script);
  } catch (error) {
    errors.push(`第 ${index + 1} 个内联脚本语法错误：${error.message}`);
  }
});

const duplicateWords = [...words]
  .filter(([, duplicateIds]) => duplicateIds.length > 1)
  .map(([word, duplicateIds]) => ({ word, ids: duplicateIds }));

const result = {
  source: sourcePath,
  total: idioms.length,
  uniqueIds: ids.size,
  uniqueWords: words.size,
  duplicateWords,
  inlineScriptsChecked: inlineScripts.length,
  migrationTest,
  errors,
};

console.log(JSON.stringify(result, null, 2));
if (errors.length) process.exitCode = 1;
