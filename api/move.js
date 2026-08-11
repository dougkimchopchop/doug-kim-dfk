// POST /api/move  { id, text, type, toSection }  -> moves an item to a
// different section (heading_2). Notion's API has no native "move block to a
// different parent" call, so this appends a fresh block with the same
// text/type at the end of the destination section, then deletes the original.
// The item gets a new block id as a result — the client just reloads after.
const PAGE_ID = process.env.NOTION_PAGE_ID;
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

function slugify(label) {
  return label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '') || 'section';
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

const ALLOWED_TYPES = ['bulleted_list_item', 'to_do'];

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
    const id = String(body.id || '');
    const text = String(body.text || '').trim();
    const type = ALLOWED_TYPES.includes(body.type) ? body.type : 'bulleted_list_item';
    const wantedRaw = String(body.toSection || '').trim();
    const wanted = slugify(wantedRaw);
    if (!id) { res.status(400).json({ error: 'no id' }); return; }
    if (!text) { res.status(400).json({ error: 'empty text' }); return; }
    if (!wanted) { res.status(400).json({ error: 'missing toSection' }); return; }

    const blocks = await getAllChildren(PAGE_ID);
    let inSection = false, headingId = null, afterId = null;
    for (const b of blocks) {
      if (b.type === 'heading_2') {
        const label = plain(b.heading_2.rich_text).trim();
        const key = slugify(label);
        if (key === wanted) { inSection = true; headingId = b.id; afterId = b.id; }
        else if (inSection) { inSection = false; }
      } else if (inSection && (b.type === 'bulleted_list_item' || b.type === 'to_do')) {
        afterId = b.id;
      }
    }
    if (!headingId) { res.status(404).json({ error: 'section not found: ' + wantedRaw }); return; }

    const blockPayload = type === 'to_do'
      ? { object: 'block', type: 'to_do', to_do: { rich_text: [{ type: 'text', text: { content: text } }], checked: false } }
      : { object: 'block', type: 'bulleted_list_item', bulleted_list_item: { rich_text: [{ type: 'text', text: { content: text } }] } };

    await notion('/blocks/' + PAGE_ID + '/children', {
      method: 'PATCH',
      body: JSON.stringify({ after: afterId, children: [blockPayload] }),
    });
    await notion('/blocks/' + id, { method: 'DELETE' });
    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};
