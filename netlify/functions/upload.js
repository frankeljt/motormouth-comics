const { requireAuth } = require('./lib/auth');
const { uploadBinaryFile } = require('./lib/github');

const MAX_BYTES = 4.5 * 1024 * 1024;

function sanitizeFilename(name) {
  const base = String(name || 'upload').split(/[\\/]/).pop();
  const cleaned = base.replace(/[^a-zA-Z0-9._-]/g, '-');
  return `${Date.now()}-${cleaned}`;
}

exports.handler = async (event) => {
  const authError = requireAuth(event);
  if (authError) return authError;

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ ok: false, error: 'method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'invalid JSON' }) };
  }

  let raw = body.data || '';
  if (raw.includes(',')) raw = raw.split(',', 2)[1];

  const byteLength = Buffer.byteLength(raw, 'base64');
  if (byteLength > MAX_BYTES) {
    return {
      statusCode: 400,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: 'Image is too large (over 4.5MB). Please use a smaller image.' })
    };
  }

  const filename = sanitizeFilename(body.filename);
  const path = `images/${filename}`;

  try {
    await uploadBinaryFile(path, raw, `Upload image ${filename} via admin panel`);
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true, path }) };
  } catch (e) {
    return {
      statusCode: e.friendly ? 409 : 500,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: e.friendly || 'Upload failed' })
    };
  }
};
