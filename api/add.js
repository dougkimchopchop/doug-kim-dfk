// POST /api/add  { bucket, text }  -> appends a bullet under the right heading
const PAGE_ID = process.env.NOTION_PAGE_ID;   // set this to your personal "My List" page id
const TOKEN = process.env.NOTION_TOKEN;
const APP_KEY = process.env.APP_KEY || '';
const NV = '2022-06-28';

const LABELS = { fires: 'Fires', today: 'Today', week: 'This Week', backlog: 'Backlog' };

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

function plain(rich) {
  return (rich || []).map((r) => r.plain_text).join('');
}

function matchBucket(text) {
  const t = (text || '').trim().toLowerCase();
  for (const k in LABELS) if (t === LABELS[k].toLowerCase()) return k;
  return null;
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
    if (!PAGE_ID) throw new Error('NOTION_PAGE_ID env var not set');
    if (APP_KEY && req.headers['x-app-key'] !== APP_KEY) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    if (req.method !== 'POST') { res.status(405).json({ error: 'POST only' }); return; }

    const body = await readBody(req);
    const bucket = String(body.bucket || 'today').toLowerCase();
    const text = String(body.text || '').trim();
    if (!LABELS[bucket]) { res.status(400).json({ error: 'bad bucket' }); return; }
    if (!text) { res.status(400).json({ error: 'empty text' }); return; }

    const blocks = await getAllChildren(PAGE_ID);
    let inSection = false, headingId = null, afterId = null;
    for (const b of blocks) {
      if (b.type === 'heading_2') {
        const key = matchBucket(plain(b.heading_2.rich_text));
        if (key === bucket) { inSection = true; headingId = b.id; afterId = b.id; }
        else if (inSection) { inSection = false; }
      } else if (inSection && b.type === 'bulleted_list_item') {
        afterId = b.id;
      }
    }
    if (!headingId) { res.status(404).json({ error: 'section heading not found' }); return; }

    await notion('/blocks/' + PAGE_ID + '/children', {
      method: 'PATCH',
      body: JSON.stringify({
        after: afterId,
        children: [
          {
            object: 'block',
            type: 'bulleted_list_item',
            bulleted_list_item: { rich_text: [{ type: 'text', text: { content: text } }] },
          },
        ],
      }),
    });
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};
