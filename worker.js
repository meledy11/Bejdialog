// Cloudflare Worker: прокси к GitHub API для проекта Bejdialog
// С улучшенной поддержкой CORS для iPhone Safari

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '*';

    // CORS заголовки — используем конкретный origin вместо *
    // (iPhone Safari не принимает * для credentials, но у нас их нет — всё равно для надёжности)
    const corsHeaders = {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Upload-Key',
      'Access-Control-Max-Age': '86400',
    };

    // Preflight (OPTIONS) — отвечаем сразу
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    // Проверка ключа (для PUT/DELETE)
    const key = request.headers.get('X-Upload-Key');
    if (request.method !== 'GET' && key !== env.UPLOAD_KEY) {
      return jsonResponse({ error: 'Forbidden' }, 403, corsHeaders);
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/^\//, '');

    if (!path.startsWith('recordings/')) {
      return jsonResponse({ error: 'Not found' }, 404, corsHeaders);
    }

    const api = `https://api.github.com/repos/${env.GH_OWNER}/${env.GH_REPO}/contents/${path}`;
    const ghHeaders = {
      'Authorization': `Bearer ${env.GH_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'bejdialog-worker',
    };

    try {
      // ==================== GET: чтение ====================
      if (request.method === 'GET') {
        const raw = `https://raw.githubusercontent.com/${env.GH_OWNER}/${env.GH_REPO}/main/${path}`;
        const r = await fetch(raw, { cf: { cacheTtl: 0 } });
        if (!r.ok) return jsonResponse({ error: 'Not found' }, 404, corsHeaders);
        const buf = await r.arrayBuffer();
        return new Response(buf, {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': r.headers.get('Content-Type') || 'audio/webm',
            'Cache-Control': 'no-cache',
          },
        });
      }

      // ==================== PUT: загрузка ====================
      if (request.method === 'PUT') {
        let body;
        try {
          body = await request.json();
        } catch (e) {
          return jsonResponse({ error: 'Invalid JSON' }, 400, corsHeaders);
        }

        // Проверяем существующий файл (нужен sha для обновления)
        let sha = null;
        const check = await fetch(`${api}?ref=main`, { headers: ghHeaders });
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
          headers: { ...ghHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });

        if (!put.ok) {
          const errText = await put.text();
          return jsonResponse({ error: errText }, put.status, corsHeaders);
        }
        return jsonResponse({ ok: true }, 200, corsHeaders);
      }

      // ==================== DELETE: удаление ====================
      if (request.method === 'DELETE') {
        const check = await fetch(`${api}?ref=main`, { headers: ghHeaders });
        if (!check.ok) return jsonResponse({ ok: true }, 200, corsHeaders);
        const existing = await check.json();

        const del = await fetch(api, {
          method: 'DELETE',
          headers: { ...ghHeaders, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: `Delete recording: ${path}`,
            sha: existing.sha,
            branch: 'main',
          }),
        });

        if (!del.ok) {
          const errText = await del.text();
          return jsonResponse({ error: errText }, del.status, corsHeaders);
        }
        return jsonResponse({ ok: true }, 200, corsHeaders);
      }

      return jsonResponse({ error: 'Method not allowed' }, 405, corsHeaders);
    } catch (e) {
      return jsonResponse({ error: String(e) }, 500, corsHeaders);
    }
  },
};

// Вспомогательная функция — всегда возвращает JSON с CORS
function jsonResponse(obj, status, corsHeaders) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}
