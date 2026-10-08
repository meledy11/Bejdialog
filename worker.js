// Cloudflare Worker: прокси к GitHub API для Bejdialog
// Версия без кастомных заголовков — чтобы Safari не требовал preflight

export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, PUT, DELETE, POST, OPTIONS',
      'Access-Control-Allow-Headers': '*',
    };

    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/^\//, '');
    if (!path.startsWith('recordings/')) {
      return jsonR({ error: 'Not found' }, 404, corsHeaders);
    }

    // Ключ — из URL (?key=...) или из тела
    const keyFromUrl = url.searchParams.get('key');
    let bodyData = null;
    if (request.method === 'PUT' || request.method === 'POST') {
      try { bodyData = await request.json(); } catch (e) {}
    }
    const key = keyFromUrl || (bodyData && bodyData.key);

    if (request.method !== 'GET' && key !== env.UPLOAD_KEY) {
      return jsonR({ error: 'Forbidden' }, 403, corsHeaders);
    }

    const api = `https://api.github.com/repos/${env.GH_OWNER}/${env.GH_REPO}/contents/${path}`;
    const gh = {
      'Authorization': `Bearer ${env.GH_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'bejdialog-worker',
    };

    try {
      // GET — чтение
      if (request.method === 'GET') {
        const raw = `https://raw.githubusercontent.com/${env.GH_OWNER}/${env.GH_REPO}/main/${path}`;
        const r = await fetch(raw, { cf: { cacheTtl: 0 } });
        if (!r.ok) return jsonR({ error: 'Not found' }, 404, corsHeaders);
        const buf = await r.arrayBuffer();
        return new Response(buf, {
          headers: {
            ...corsHeaders,
            'Content-Type': r.headers.get('Content-Type') || 'audio/webm',
            'Cache-Control': 'no-cache',
          },
        });
      }

      // PUT / POST — загрузка (принимаем оба, чтобы обойти preflight)
      if (request.method === 'PUT' || request.method === 'POST') {
        if (!bodyData || !bodyData.content) {
          return jsonR({ error: 'No content' }, 400, corsHeaders);
        }

        let sha = null;
        const check = await fetch(`${api}?ref=main`, { headers: gh });
        if (check.ok) {
          const existing = await check.json();
          sha = existing.sha;
        }

        const payload = {
          message: `Update: ${path}`,
          content: bodyData.content,
          branch: 'main',
        };
        if (sha) payload.sha = sha;

        const res = await fetch(api, {
          method: 'PUT',
          headers: { ...gh, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const t = await res.text();
          return jsonR({ error: t }, res.status, corsHeaders);
        }
        return jsonR({ ok: true }, 200, corsHeaders);
      }

      // DELETE — удаление
      if (request.method === 'DELETE') {
        const check = await fetch(`${api}?ref=main`, { headers: gh });
        if (!check.ok) return jsonR({ ok: true }, 200, corsHeaders);
        const existing = await check.json();

        const res = await fetch(api, {
          method: 'DELETE',
          headers: { ...gh, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: `Delete: ${path}`,
            sha: existing.sha,
            branch: 'main',
          }),
        });
        if (!res.ok) {
          const t = await res.text();
          return jsonR({ error: t }, res.status, corsHeaders);
        }
        return jsonR({ ok: true }, 200, corsHeaders);
      }

      return jsonR({ error: 'Method not allowed' }, 405, corsHeaders);
    } catch (e) {
      return jsonR({ error: String(e) }, 500, corsHeaders);
    }
  },
};

function jsonR(obj, status, corsHeaders) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
