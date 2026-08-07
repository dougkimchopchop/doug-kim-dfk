// POST /api/done  { id }  -> deletes (completes) that bullet block
const TOKEN = process.env.NOTION_TOKEN;
const APP_KEY = process.env.APP_KEY || '';
const NV = '2022-06-28';

async function notion(path, opts = {}) {
  const res = await fetch('https://api.notion.com/v1' + path, {
    ...opts,
    headers: {
      Authorization: 'Bearer ' + TOKEN,
      'Notion-Version': NV,
      'Content-Type': 'application/json',
      ...(opts.headers || {}),
    },
  });
  if (!res.ok) throw new Error('Notion ' + res.status + ': ' + (await res.text()));
  return res.json();
}

function readBody(req) {
  return new Promise((resolve) => {
    if (req.body) {
      if (typeof req.body === 'string') {
        try { return resolve(JSON.parse(req.body)); } catch { return resolve({}); }
      }
      return resolve(req.body);
    }
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => { try { resolve(JSON.parse(data || '{}')); } catch { resolve({}); } });
  });
}

module.exports = async (req, res) => {
  try {
    if (!TOKEN) throw new Error('NOTION_TOKEN env var not set');
    if (APP_KEY && req.headers['x-app-key'] !== APP_KEY) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }
    const body = await readBody(req);
    const id = String(body.id || '');
    if (!id) { res.status(400).json({ error: 'no id' }); return; }
    await notion('/blocks/' + id, { method: 'DELETE' });
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};
