const https = require('https');

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function fetchQuestions(category, amount = 10) {
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
          const questions = json.results.map(q => {
            const choices = shuffle([...q.incorrect_answers, q.correct_answer].map(decodeURIComponent));
            return {
              question: decodeURIComponent(q.question),
              choices,
              correct: decodeURIComponent(q.correct_answer),
            };
          });
          resolve(questions);
        } catch (e) { reject(e); }
      });
    }).on('error', e => { clearTimeout(timeout); reject(e); });
  });
}

async function fetchQuestionsMulti(categories, totalAmount) {
  const perCat = Math.max(2, Math.ceil(totalAmount / categories.length));
  const results = await Promise.all(categories.map(cat => fetchQuestions(cat, perCat)));
  return shuffle(results.flat()).slice(0, totalAmount);
}

module.exports = { fetchQuestions, fetchQuestionsMulti };
