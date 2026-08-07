// GET /api/list  ->  { fires:[{id,text}], today:[...], week:[...], backlog:[...] }
const PAGE_ID = process.env.NOTION_PAGE_ID;   // set this to your personal "My List" page id
const TOKEN = process.env.NOTION_TOKEN;
const APP_KEY = process.env.APP_KEY || '';
const NV = '2022-06-28';

const BUCKETS = [
  { key: 'fires', label: 'Fires' },
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This Week' },
  { key: 'backlog', label: 'Backlog' },
];

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
  for (const b of BUCKETS) if (t === b.label.toLowerCase()) return b.key;
  return null;
}

module.exports = async (req, res) => {
  try {
    if (!TOKEN) throw new Error('NOTION_TOKEN env var not set');
    if (!PAGE_ID) throw new Error('NOTION_PAGE_ID env var not set');
    if (APP_KEY && req.headers['x-app-key'] !== APP_KEY) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const blocks = await getAllChildren(PAGE_ID);
    const out = { fires: [], today: [], week: [], backlog: [] };
    let cur = null;
    for (const b of blocks) {
      if (b.type === 'heading_2') {
        cur = matchBucket(plain(b.heading_2.rich_text));
      } else if (b.type === 'bulleted_list_item' && cur) {
        out[cur].push({ id: b.id, text: plain(b.bulleted_list_item.rich_text) });
      }
    }
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(out);
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};
