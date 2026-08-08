// GET /api/list  ->  { sections: [ { key, label, items:[{id,text}] }, ... ] }
// Any heading_2 on the page becomes a section automatically — no hardcoded bucket list.
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

// Extract text + checked-state from either block type. to_do items that are
// already checked in Notion are skipped (treated as done/archived already).
function itemFromBlock(b) {
  if (b.type === 'bulleted_list_item') {
    return { id: b.id, text: plain(b.bulleted_list_item.rich_text) };
  }
  if (b.type === 'to_do') {
    if (b.to_do.checked) return null;
    return { id: b.id, text: plain(b.to_do.rich_text) };
  }
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
    const sections = [];
    const byKey = {};
    let cur = null;
    let pendingDivider = null;
    for (const b of blocks) {
      if (b.type === 'heading_1') {
        pendingDivider = plain(b.heading_1.rich_text).trim() || null;
        continue;
      }
      if (b.type === 'heading_2') {
        const label = plain(b.heading_2.rich_text).trim();
        if (!label) { cur = null; continue; }
        const key = slugify(label);
        if (!byKey[key]) {
          byKey[key] = { key, label, items: [] };
          if (pendingDivider) byKey[key].divider = pendingDivider;
          sections.push(byKey[key]);
        }
        cur = byKey[key];
        pendingDivider = null;
      } else if (cur) {
        const item = itemFromBlock(b);
        if (item) cur.items.push(item);
      }
    }
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json({ sections });
  } catch (e) {
    res.status(500).json({ error: String((e && e.message) || e) });
  }
};
