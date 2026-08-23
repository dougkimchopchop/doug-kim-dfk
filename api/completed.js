// GET /api/completed -> { items: [ { id, text, doneLabel, raw } ] }
// Reads the "Completed" heading_2 section on the My List page (where
// api/done.js archives finished to_do items as "{text} — done {Mon D}")
// and returns them in page order (oldest first).
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

module.exports = async (req, res) => {
  try {
    if (!TOKEN) throw new Error('NOTION_TOKEN env var not set');
    if (!PAGE_ID) throw new Error('NOTION_PAGE_ID env var not set');
    if (APP_KEY && req.headers['x-app-key'] !== APP_KEY) {
      res.status(401).json({ error: 'unauthorized' });
      return;
    }
    const blocks = await getAllChildren(PAGE_ID);
    let inCompleted = false;
    const items = [];
    for (const b of blocks) {
      if (b.type === 'heading_2') {
        const label = plain(b.heading_2.rich_text).trim();
        inCompleted = label === 'Completed';
        continue;
      }
      if (inCompleted && b.type === 'to_do') {
        const raw = plain(b.to_do.rich_text);
        const m = raw.match(/^([\s\S]*?)\s—\sdone\s(.+)$/);
        items.push({
          id: b.id,
          text: m ? m[1] : raw,
          doneLabel: m ? m[2] : null,
          raw,
        });
      }
    }
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ items });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};
