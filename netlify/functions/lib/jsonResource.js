const { requireAuth } = require('./auth');
const { readJsonFile, writeJsonFile } = require('./github');

function makeJsonResourceHandler(filePath, resourceName) {
  return async (event) => {
    const authError = requireAuth(event);
    if (authError) return authError;

    if (event.httpMethod === 'GET') {
      try {
        const { data } = await readJsonFile(filePath);
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) };
      } catch (e) {
        return { statusCode: 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'Could not load ' + resourceName }) };
      }
    }

    if (event.httpMethod === 'POST') {
      let body;
      try {
        body = JSON.parse(event.body || 'null');
      } catch (e) {
        return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'invalid JSON' }) };
      }
      if (!Array.isArray(body)) {
        return { statusCode: 400, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: 'expected an array' }) };
      }
      try {
        await writeJsonFile(filePath, body, `Update ${resourceName} via admin panel`);
        return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: true }) };
      } catch (e) {
        return { statusCode: e.friendly ? 409 : 500, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ok: false, error: e.friendly || 'Could not save ' + resourceName }) };
      }
    }

    return { statusCode: 405, body: JSON.stringify({ ok: false, error: 'method not allowed' }) };
  };
}

module.exports = { makeJsonResourceHandler };
