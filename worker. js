// Cloudflare Worker: прокси к GitHub API для проекта Bejdialog
export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Upload-Key',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: cors });
    }

    const key = request.headers.get('X-Upload-Key');
    if (request.method !== 'GET' && key !== env.UPLOAD_KEY) {
      return json({ error: 'Forbidden' }, 403, cors);
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/^\//, '');
    if (!path.startsWith('recordings/')) {
      return json({ error: 'Not found' }, 404, cors);
    }

    const api = `https://api.github.com/repos/${env.GH_OWNER}/${env.GH_REPO}/contents/${path}`;
    const headers = {
      'Authorization': `Bearer ${env.GH_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'bejdialog-worker',
    };

    try {
      if (request.method === 'GET') {
        const raw = `https://raw.githubusercontent.com/${env.GH_OWNER}/${env.GH_REPO}/main/${path}`;
        const r = await fetch(raw, { cf: { cacheTtl: 0 } });
        if (!r.ok) return json({ error: 'Not found' }, 404, cors);
        const buf = await r.arrayBuffer();
        return new Response(buf, {
          headers: {
            ...cors,
            'Content-Type': r.headers.get('Content-Type') || 'audio/webm',
            'Cache-Control': 'no-cache',
          },
        });
      }

      if (request.method === 'PUT') {
        const body = await request.json();
        let sha = null;
        const check = await fetch(`${api}?ref=main`, { headers });
        if (check.ok) {
          const existing = await check.json();
          sha = existing.sha;
        }
        const payload = {
          message: `Update recording: ${path}`,
          content: body.content,
          branch: 'main',
        };
        if (sha) payload.sha = sha;
        const put = await fetch(api, {
          method: 'PUT',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
        if (!put.ok) return json({ error: await put.text() }, put.status, cors);
        return json({ ok: true }, 200, cors);
      }

      if (request.method === 'DELETE') {
        const check = await fetch(`${api}?ref=main`, { headers });
        if (!check.ok) return json({ ok: true }, 200, cors);
        const existing = await check.json();
        const del = await fetch(api, {
          method: 'DELETE',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: `Delete recording: ${path}`,
            sha: existing.sha,
            branch: 'main',
          }),
        });
        if (!del.ok) return json({ error: await del.text() }, del.status, cors);
        return json({ ok: true }, 200, cors);
      }

      return json({ error: 'Method not allowed' }, 405, cors);
    } catch (e) {
      return json({ error: String(e) }, 500, cors);
    }
  },
};

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  });
}
