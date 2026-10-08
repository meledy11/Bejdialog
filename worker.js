// Cloudflare Worker: прокси к GitHub API для Bejdialog
// Читает файлы через GitHub Contents API (без кэша raw.githubusercontent.com)

export default {
  async fetch(request, env) {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, PUT, DELETE, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Upload-Key, *',
      'Access-Control-Max-Age': '86400',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/^\//, '');

    if (!path.startsWith('recordings/')) {
      return jsonR({ error: 'Not found' }, 404, corsHeaders);
    }

    // Ключ доступа из URL или тела
    const keyFromUrl = url.searchParams.get('key');
    let bodyData = null;
    if (request.method === 'PUT' || request.method === 'POST') {
      try { bodyData = await request.json(); } catch (e) {}
    }
    const key = keyFromUrl || (bodyData && bodyData.key);

    // Проверка ключа (для PUT/POST/DELETE)
    if (request.method !== 'GET' && key !== env.UPLOAD_KEY) {
      return jsonR({ error: 'Forbidden' }, 403, corsHeaders);
    }

    const api = `https://api.github.com/repos/${env.GH_OWNER}/${env.GH_REPO}/contents/${path}`;
    const ghHeaders = {
      'Authorization': `Bearer ${env.GH_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'bejdialog-worker',
    };

    try {
      // ============ GET: чтение через API (без кэша raw) ============
      if (request.method === 'GET') {
        const r = await fetch(api, { headers: ghHeaders });
        if (!r.ok) {
          return jsonR({ error: 'Not found' }, 404, corsHeaders);
        }
        const data = await r.json();
        if (!data.content) {
          return jsonR({ error: 'Empty' }, 500, corsHeaders);
        }
        // data.content — base64, декодируем в бинарник
        const binary = atob(data.content.replace(/\n/g, ''));
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        const contentType = path.endsWith('.mp4') ? 'audio/mp4' : 'audio/webm';
        return new Response(bytes, {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': contentType,
            'Content-Length': String(bytes.length),
            'Cache-Control': 'no-cache',
          },
        });
      }

      // ============ PUT / POST: загрузка ============
      if (request.method === 'PUT' || request.method === 'POST') {
        if (!bodyData || !bodyData.content) {
          return jsonR({ error: 'No content' }, 400, corsHeaders);
        }

        // Проверяем существующий файл — нужен SHA для обновления
        let sha = null;
        const check = await fetch(`${api}?ref=main`, { headers: ghHeaders });
        if (check.ok) {
          const existing = await check.json();
          sha = existing.sha;
        }

        const payload = {
          message: `Update recording: ${path}`,
          content: bodyData.content,
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
          return jsonR({ error: errText }, put.status, corsHeaders);
        }
        return jsonR({ ok: true }, 200, corsHeaders);
      }

      // ============ DELETE: удаление ============
      if (request.method === 'DELETE') {
        const check = await fetch(`${api}?ref=main`, { headers: ghHeaders });
        if (!check.ok) {
          return jsonR({ ok: true }, 200, corsHeaders);
        }
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
          return jsonR({ error: errText }, del.status, corsHeaders);
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
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  });
}
