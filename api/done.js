// POST /api/done  { id }  -> deletes (completes) that bullet block, logs a completion
const TOKEN = process.env.NOTION_TOKEN;
const APP_KEY = process.env.APP_KEY || '';
const NV = '2022-06-28';

// Same Supabase project + anon key already embedded client-side in tracker.html.
// We reuse the single dfk_tracker row (id=1) and add a "task_log" map of
// { "YYYY-MM-DD": count } alongside the existing habit-tracker fields.
const SUPABASE_URL = 'https://rpmxkhgirhlfwqefdopo.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJwbXhraGdpcmhsZndxZWZkb3BvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2MDUzMTQsImV4cCI6MjA5MjE4MTMxNH0.bAUNydSiWh60mxD23RLYXpSpRxrzt0q2JQ7yDSZmOW4';

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

// Best-effort; a logging failure should never block the completion itself.
async function logCompletion() {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const r = await fetch(
      SUPABASE_URL + '/rest/v1/dfk_tracker?select=data&order=id.desc&limit=1',
      { headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY } }
    );
    let data = {};
    if (r.ok) {
      const rows = await r.json();
      if (rows && rows[0] && rows[0].data) {
        try { data = JSON.parse(rows[0].data); } catch { data = {}; }
      }
    }
    if (!data.task_log) data.task_log = {};
    data.task_log[today] = (data.task_log[today] || 0) + 1;
    await fetch(SUPABASE_URL + '/rest/v1/dfk_tracker', {
      method: 'POST',
      headers: {
        apikey: SUPABASE_KEY,
        Authorization: 'Bearer ' + SUPABASE_KEY,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates',
      },
      body: JSON.stringify({ id: 1, data: JSON.stringify(data) }),
    });
  } catch (e) {
    // swallow — completion logging is best-effort, not critical path
  }
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
    await logCompletion();
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};
