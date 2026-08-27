// This file handles EVERY request under /api/* (login, logout, session,
// products, upload). It's named _middleware.js on purpose: Cloudflare Pages
// routes all /api/... requests through it, and because it never calls
// context.next(), it acts as the final handler for all of them. That keeps
// the whole backend in a single file, which is easier to create/edit from
// a phone (one filename to type, no dynamic [brackets] in paths).
//
// Required setup in the Cloudflare Pages dashboard (Settings > Functions):
//   D1 binding      variable name: DB              -> your D1 database
//   R2 binding      variable name: PRODUCT_IMAGES  -> your R2 bucket
// Required environment variables (Settings > Environment variables):
//   ADMIN_PASSWORD  (Secret) - the password you'll log in with on /admin.html
//   SESSION_SECRET  (Secret) - any long random string, used to sign login sessions
//   R2_PUBLIC_URL   (Plain)  - the public r2.dev URL for your bucket, no trailing slash

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  // strip "/api/" prefix, e.g. "/api/products" -> "products"
  const path = url.pathname.replace(/^\/api\/?/, '');
  const method = request.method;

  try {
    if (path === 'login' && method === 'POST') return handleLogin(request, env);
    if (path === 'logout' && method === 'POST') return handleLogout();
    if (path === 'session' && method === 'GET') return handleSession(request, env);
    if (path === 'upload' && method === 'POST') return handleUpload(request, env);

    if (path === 'products') {
      if (method === 'GET') return listProducts(env);
      if (method === 'POST') return createProduct(request, env);
      if (method === 'PUT') return updateProduct(request, env, url.searchParams.get('id'));
      if (method === 'DELETE') return deleteProduct(request, env, url.searchParams.get('id'));
    }

    return jsonResponse({ error: 'Not found' }, 404);
  } catch (err) {
    return jsonResponse({ error: 'Server error', detail: String(err && err.message || err) }, 500);
  }
}

// ---------- helpers ----------

function jsonResponse(data, status, extraHeaders) {
  const headers = Object.assign({ 'Content-Type': 'application/json' }, extraHeaders || {});
  return new Response(JSON.stringify(data), { status: status || 200, headers: headers });
}

function bufferToBase64Url(buf) {
  const bytes = new Uint8Array(buf);
  let str = '';
  for (let i = 0; i < bytes.length; i++) str += String.fromCharCode(bytes[i]);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToString(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return atob(str);
}

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return result === 0;
}

async function hmacSign(data, secret) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
  return bufferToBase64Url(sig);
}

async function createSessionToken(secret) {
  const payload = JSON.stringify({ exp: Date.now() + 7 * 24 * 60 * 60 * 1000 });
  const encodedPayload = bufferToBase64Url(new TextEncoder().encode(payload));
  const sig = await hmacSign(encodedPayload, secret);
  return encodedPayload + '.' + sig;
}

async function verifySessionToken(token, secret) {
  if (!token) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const expectedSig = await hmacSign(parts[0], secret);
  if (!timingSafeEqual(parts[1], expectedSig)) return false;
  try {
    const payload = JSON.parse(base64UrlToString(parts[0]));
    return typeof payload.exp === 'number' && Date.now() <= payload.exp;
  } catch (e) {
    return false;
  }
}

function getCookie(request, name) {
  const header = request.headers.get('Cookie') || '';
  const match = header.match(new RegExp('(?:^|;\\s*)' + name + '=([^;]*)'));
  return match ? decodeURIComponent(match[1]) : null;
}

function setSessionCookie(token) {
  return 'admin_session=' + token + '; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=' + (7 * 24 * 60 * 60);
}

function clearSessionCookie() {
  return 'admin_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0';
}

async function requireAuth(request, env) {
  const token = getCookie(request, 'admin_session');
  return verifySessionToken(token, env.SESSION_SECRET);
}

// ---------- auth routes ----------

async function handleLogin(request, env) {
  const body = await request.json().catch(() => ({}));
  const password = typeof body.password === 'string' ? body.password : '';
  if (!env.ADMIN_PASSWORD || !timingSafeEqual(password, env.ADMIN_PASSWORD)) {
    return jsonResponse({ error: 'Incorrect password' }, 401);
  }
  if (!env.SESSION_SECRET) {
    return jsonResponse({ error: 'Server is missing SESSION_SECRET' }, 500);
  }
  const token = await createSessionToken(env.SESSION_SECRET);
  return jsonResponse({ success: true }, 200, { 'Set-Cookie': setSessionCookie(token) });
}

function handleLogout() {
  return jsonResponse({ success: true }, 200, { 'Set-Cookie': clearSessionCookie() });
}

async function handleSession(request, env) {
  const authed = await requireAuth(request, env);
  return jsonResponse({ authenticated: authed });
}

// ---------- product routes ----------

async function listProducts(env) {
  const { results } = await env.DB.prepare(
    'SELECT id, name, price, description, image_url FROM products ORDER BY created_at DESC'
  ).all();
  return jsonResponse(results);
}

async function createProduct(request, env) {
  if (!(await requireAuth(request, env))) return jsonResponse({ error: 'Unauthorized' }, 401);
  const body = await request.json().catch(() => null);
  if (!body || !body.name || typeof body.price !== 'number') {
    return jsonResponse({ error: 'Name and price are required' }, 400);
  }
  const result = await env.DB.prepare(
    'INSERT INTO products (name, price, description, image_url, created_at, updated_at) VALUES (?, ?, ?, ?, unixepoch(), unixepoch())'
  ).bind(body.name, body.price, body.description || '', body.image_url || '').run();
  return jsonResponse({ success: true, id: result.meta.last_row_id });
}

async function updateProduct(request, env, id) {
  if (!(await requireAuth(request, env))) return jsonResponse({ error: 'Unauthorized' }, 401);
  if (!id) return jsonResponse({ error: 'Missing product id' }, 400);
  const body = await request.json().catch(() => null);
  if (!body || !body.name || typeof body.price !== 'number') {
    return jsonResponse({ error: 'Name and price are required' }, 400);
  }
  await env.DB.prepare(
    'UPDATE products SET name = ?, price = ?, description = ?, image_url = ?, updated_at = unixepoch() WHERE id = ?'
  ).bind(body.name, body.price, body.description || '', body.image_url || '', id).run();
  return jsonResponse({ success: true });
}

async function deleteProduct(request, env, id) {
  if (!(await requireAuth(request, env))) return jsonResponse({ error: 'Unauthorized' }, 401);
  if (!id) return jsonResponse({ error: 'Missing product id' }, 400);
  await env.DB.prepare('DELETE FROM products WHERE id = ?').bind(id).run();
  return jsonResponse({ success: true });
}

// ---------- image upload ----------

async function handleUpload(request, env) {
  if (!(await requireAuth(request, env))) return jsonResponse({ error: 'Unauthorized' }, 401);
  if (!env.R2_PUBLIC_URL) return jsonResponse({ error: 'Server is missing R2_PUBLIC_URL' }, 500);

  const formData = await request.formData().catch(() => null);
  const file = formData ? formData.get('image') : null;
  if (!file || typeof file === 'string') return jsonResponse({ error: 'No image provided' }, 400);

  const ext = (file.name && file.name.includes('.')) ? file.name.split('.').pop().toLowerCase() : 'jpg';
  const key = 'products/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '.' + ext;
  const buffer = await file.arrayBuffer();

  await env.PRODUCT_IMAGES.put(key, buffer, {
    httpMetadata: { contentType: file.type || 'image/jpeg' }
  });

  const url = env.R2_PUBLIC_URL.replace(/\/$/, '') + '/' + key;
  return jsonResponse({ success: true, url: url });
}
