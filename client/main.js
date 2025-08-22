async function getJSON(url, opts) {
  const res = await fetch(url, opts);
  const text = await res.text();
  try { return JSON.parse(text); } catch { return { raw: text }; }
}

const healthBtn = document.getElementById('healthBtn');
const healthStatus = document.getElementById('healthStatus');
const askBtn = document.getElementById('askBtn');
const questionEl = document.getElementById('question');
const responseEl = document.getElementById('response');

healthBtn.addEventListener('click', async () => {
  healthStatus.textContent = 'Checking...';
  try {
    const data = await getJSON('http://localhost:8000/health');
    healthStatus.textContent = `OK (${data.service})`;
  } catch (e) {
    healthStatus.textContent = 'Failed to reach backend';
  }
});

askBtn.addEventListener('click', async () => {
  const question = questionEl.value.trim();
  responseEl.textContent = 'Asking...';
  try {
    const data = await getJSON('http://localhost:8000/api/v1/interview/question', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question })
    });
    responseEl.textContent = JSON.stringify(data, null, 2);
  } catch (e) {
    responseEl.textContent = 'Request failed.';
  }
});
