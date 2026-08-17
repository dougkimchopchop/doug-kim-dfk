// POST /api/done  { id, type, text, major }  -> completes that block, logs completion
//
// to_do blocks (The Fucking Hard Things) get archived: a checked, date-stamped
// copy is appended to a "## Completed" section at the bottom of the My List
// page, then the original block is deleted. That gives a permanent, visible,
// chronological record of what's been crossed off, right in Notion.
//
// Plain bulleted items (Fires/Today/This Week/Backlog) have no checked state
// to preserve and aren't archived — they're just deleted, same as before.
const TOKEN = process.env.NOTION_TOKEN;
const PAGE_ID = process.env.NOTION_PAGE_ID;
const APP_KEY = process.env.APP_KEY || '';
const NV = '2022-06-28';

// Same Supabase project + anon key already embedded client-side in tracker.html.
// We reuse the single dfk_tracker row (id=1) and add a "task_log" map of
// { "YYYY-MM-DD": { total, major } } alongside the existing habit-tracker fields.
// "major" = items from a section that sits under a heading_1 divider (currently
// just "The Fucking Hard Things" / the 90-day Phase lists) — flagged by the client.
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

function plain(rich) {
  return (rich || []).map((r) => r.plain_text).join('');
}

async function getAllChildren(blockId) {
  let results = [];
  let cursor = null;
  do {
    const q = cursor ? '?page_size=100&start_cursor=' + cursor : '?page_size=100';
    const data = await notion('/blocks/' + blockId + '/children' + q);
    results = results.concat(data.results);
    cursor = data.has_more ? data.next_cursor : null;
  } while (cursor);
  return results;
}

let completedSectionId = null;
async function getOrCreateCompletedSection() {
  if (completedSectionId) return completedSectionId;
  const children = await getAllChildren(PAGE_ID);
  const found = children.find(
    (b) => b.type === 'heading_2' && plain(b.heading_2.rich_text).trim() === 'Completed'
  );
  if (found) { completedSectionId = found.id; return completedSectionId; }
  const created = await notion('/blocks/' + PAGE_ID + '/children', {
    method: 'PATCH',
    body: JSON.stringify({ children: [{ heading_2: { rich_text: [{ text: { content: 'Completed' } }] } }] }),
  });
  completedSectionId = created.results[0].id;
  return completedSectionId;
}

async function archiveCompleted(text) {
  const sectionId = await getOrCreateCompletedSection();
  const dateStr = new Date().toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' });
  await notion('/blocks/' + sectionId + '/children', {
    method: 'PATCH',
    body: JSON.stringify({
      children: [{
        to_do: {
          rich_text: [{ text: { content: text + ' — done ' + dateStr } }],
          checked: true,
        },
      }],
    }),
  });
}

// Best-effort; a logging failure should never block the completion itself.
async function logCompletion(isMajor) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const r = await fetch(
      SUPABASE_URL + '/rest/v1/dfk_tracker?select=data&id=eq.1',
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
    let entry = data.task_log[today];
    // migrate old plain-number entries (pre-"major" split) into the new shape
    if (typeof entry === 'number') entry = { total: entry, major: 0 };
    if (!entry) entry = { total: 0, major: 0 };
    entry.total = (entry.total || 0) + 1;
    if (isMajor) entry.major = (entry.major || 0) + 1;
    data.task_log[today] = entry;
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
    const isMajor = !!body.major;
    const type = String(body.type || '');
    const text = String(body.text || '').trim();
    if (!id) { res.status(400).json({ error: 'no id' }); return; }
    if (type === 'to_do' && text && PAGE_ID) {
      try { await archiveCompleted(text); } catch (e) { /* best-effort — still complete below even if archiving fails */ }
    }
    await notion('/blocks/' + id, { method: 'DELETE' });
    await logCompletion(isMajor);
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};
