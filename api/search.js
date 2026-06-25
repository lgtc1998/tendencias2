export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const TAVILY_KEY = process.env.TAVILY_KEY;
  const GROQ_KEY = process.env.GROQ_KEY;

  if (!TAVILY_KEY || !GROQ_KEY) {
    return res.status(500).json({ error: 'Chaves de API não configuradas no servidor.' });
  }

  const body = req.body;
  if (!body) return res.status(400).json({ error: 'Body inválido.' });

  const { action, query, prompt, domains } = body;

  try {
    if (action === 'search') {
      // STEP 1: Tavily busca na web
      const tavilyBody = {
        query: `${query} arquitetura design interiores tendências`,
        search_depth: 'advanced',
        max_results: 7,
        include_answer: true,
      };
      if (domains && domains.length) tavilyBody.include_domains = domains;

      const tRes = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TAVILY_KEY}` },
        body: JSON.stringify(tavilyBody),
      });
      const tData = await tRes.json();
      if (!tRes.ok) throw new Error(tData.message || `Tavily erro ${tRes.status}`);

      const context = tData.results?.map(r => `FONTE: ${r.url}\nTÍTULO: ${r.title}\nCONTEÚDO: ${r.content}`).join('\n\n---\n\n') || '';
      const tavilySummary = tData.answer || '';
      const fontes = tData.results?.map(r => new URL(r.url).hostname.replace('www.', '')) || [];

      // STEP 2: Gemini estrutura em JSON
      const fullPrompt = `${prompt}\n\n=== CONTEÚDO PESQUISADO ===\n${tavilySummary}\n\n${context}\n\nPesquisa: ${query}`;
      const groqBody = {
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: fullPrompt }],
        temperature: 0.2,
        max_tokens: 2000,
      };

      const gRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_KEY}` },
        body: JSON.stringify(groqBody),
      });
      const gData = await gRes.json();
      if (!gRes.ok) throw new Error(gData.error?.message || `Groq erro ${gRes.status}`);

      const text = gData.choices?.[0]?.message?.content || '';
      const clean = text.replace(/```json|```/g, '').trim();
      let parsed;
      try { parsed = JSON.parse(clean); } catch { const m = clean.match(/\{[\s\S]*\}/); parsed = m ? JSON.parse(m[0]) : {}; }
      parsed.fontes = fontes;

      return res.status(200).json({ ok: true, data: parsed });
    }

    if (action === 'compare') {
      // Tavily busca rápida para comparador
      const tBody = { query, search_depth: 'basic', max_results: 5 };
      if (domains && domains.length) tBody.include_domains = domains;

      const tRes = await fetch('https://api.tavily.com/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${TAVILY_KEY}` },
        body: JSON.stringify(tBody),
      });
      const tData = await tRes.json();
      if (!tRes.ok) throw new Error(tData.message || 'Tavily erro');

      const ctx = tData.results?.map(r => `${r.title}: ${r.content}`).join('\n') || '';
      const fullPrompt = `${prompt}\n\nConteúdo pesquisado:\n${ctx}\n\nTema: ${query}`;

      const groqBody2 = {
        model: 'llama-3.3-70b-versatile',
        messages: [{ role: 'user', content: fullPrompt }],
        temperature: 0.2,
        max_tokens: 600,
      };
      const gRes = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_KEY}` },
        body: JSON.stringify(groqBody2),
      });
      const gData = await gRes.json();
      if (!gRes.ok) throw new Error(gData.error?.message || 'Groq erro');

      const text = gData.choices?.[0]?.message?.content || '';
      const clean = text.replace(/```json|```/g, '').trim();
      let parsed;
      try { parsed = JSON.parse(clean); } catch { const m = clean.match(/\{[\s\S]*\}/); parsed = m ? JSON.parse(m[0]) : {}; }

      return res.status(200).json({ ok: true, data: parsed });
    }

    return res.status(400).json({ error: 'Ação inválida.' });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
