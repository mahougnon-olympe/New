const https = require('https');

// Mapping catégories opentdb → the-trivia-api.com (pour le mode FR)
const TRIVIA_API_CAT = {
  9:'general_knowledge', 23:'history', 22:'geography', 17:'science',
  21:'sport_and_leisure', 11:'film_and_tv', 12:'music', 14:'film_and_tv',
  19:'science', 20:'science', 25:'arts_and_literature', 27:'general_knowledge',
};

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── Anglais : Open Trivia DB ───────────────────────────────────────────────────
function fetchQuestionsEN(category, amount = 10) {
  const url = `https://opentdb.com/api.php?amount=${amount}&category=${category}&type=multiple&encode=url3986`;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('timeout')), 10000);
    https.get(url, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        clearTimeout(timeout);
        try {
          const json = JSON.parse(data);
          if (json.response_code !== 0) { reject(new Error('code:' + json.response_code)); return; }
          resolve(json.results.map(q => {
            const choices = shuffle([...q.incorrect_answers, q.correct_answer].map(decodeURIComponent));
            return { question: decodeURIComponent(q.question), choices, correct: decodeURIComponent(q.correct_answer) };
          }));
        } catch (e) { reject(e); }
      });
    }).on('error', e => { clearTimeout(timeout); reject(e); });
  });
}

// ── Français : The Trivia API (supporte FR nativement) ───────────────────────
function fetchQuestionsFR(category, amount = 10) {
  const cat = TRIVIA_API_CAT[category] || 'general_knowledge';
  const url = `https://the-trivia-api.com/v2/questions?limit=${amount}&language=fr&categories=${cat}`;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('timeout')), 10000);
    https.get(url, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        clearTimeout(timeout);
        try {
          const items = JSON.parse(data);
          if (!Array.isArray(items) || items.length === 0) { reject(new Error('empty')); return; }
          resolve(items.map(q => {
            const choices = shuffle([q.correctAnswer, ...q.incorrectAnswers]);
            return { question: q.question.text, choices, correct: q.correctAnswer };
          }));
        } catch (e) { reject(e); }
      });
    }).on('error', e => { clearTimeout(timeout); reject(e); });
  });
}

function fetchQuestions(category, amount = 10, lang = 'fr') {
  return lang === 'en' ? fetchQuestionsEN(category, amount) : fetchQuestionsFR(category, amount);
}

async function fetchQuestionsMulti(categories, totalAmount, lang = 'fr') {
  const perCat = Math.max(2, Math.ceil(totalAmount / categories.length));
  const results = await Promise.all(categories.map(cat => fetchQuestions(cat, perCat, lang)));
  return shuffle(results.flat()).slice(0, totalAmount);
}

module.exports = { fetchQuestions, fetchQuestionsMulti };
