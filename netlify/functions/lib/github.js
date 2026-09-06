const API = 'https://api.github.com';

function owner() { return process.env.GITHUB_OWNER; }
function repo() { return process.env.GITHUB_REPO; }
function branch() { return process.env.GITHUB_BRANCH || 'main'; }

function authHeaders() {
  return {
    Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28'
  };
}

async function ghFetch(path, options) {
  const res = await fetch(`${API}${path}`, { ...options, headers: { ...authHeaders(), ...(options && options.headers) } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`GitHub API ${res.status} ${path}: ${text}`);
    err.status = res.status;
    throw err;
  }
  return res.status === 204 ? null : res.json();
}

async function readJsonFile(path) {
  const data = await ghFetch(`/repos/${owner()}/${repo()}/contents/${path}?ref=${branch()}`);
  const content = Buffer.from(data.content, 'base64').toString('utf8');
  return { data: JSON.parse(content), sha: data.sha };
}

async function writeJsonFile(path, newData, message) {
  let sha;
  try {
    sha = (await readJsonFile(path)).sha;
  } catch (e) {
    if (e.status !== 404) throw e; // file doesn't exist yet — create it
  }

  try {
    await ghFetch(`/repos/${owner()}/${repo()}/contents/${path}`, {
      method: 'PUT',
      body: JSON.stringify({
        message,
        content: Buffer.from(JSON.stringify(newData, null, 2), 'utf8').toString('base64'),
        sha,
        branch: branch()
      })
    });
  } catch (e) {
    if (e.status === 409 || e.status === 422) {
      const conflict = new Error('conflict');
      conflict.friendly = 'Someone else just saved a change — please refresh and try again.';
      throw conflict;
    }
    throw e;
  }
}

async function uploadBinaryFile(path, base64Content, message) {
  const refData = await ghFetch(`/repos/${owner()}/${repo()}/git/ref/heads/${branch()}`);
  const latestCommitSha = refData.object.sha;

  const commitData = await ghFetch(`/repos/${owner()}/${repo()}/git/commits/${latestCommitSha}`);
  const baseTreeSha = commitData.tree.sha;

  const blob = await ghFetch(`/repos/${owner()}/${repo()}/git/blobs`, {
    method: 'POST',
    body: JSON.stringify({ content: base64Content, encoding: 'base64' })
  });

  const tree = await ghFetch(`/repos/${owner()}/${repo()}/git/trees`, {
    method: 'POST',
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree: [{ path, mode: '100644', type: 'blob', sha: blob.sha }]
    })
  });

  const commit = await ghFetch(`/repos/${owner()}/${repo()}/git/commits`, {
    method: 'POST',
    body: JSON.stringify({ message, tree: tree.sha, parents: [latestCommitSha] })
  });

  try {
    await ghFetch(`/repos/${owner()}/${repo()}/git/refs/heads/${branch()}`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commit.sha })
    });
  } catch (e) {
    if (e.status === 422) {
      const conflict = new Error('conflict');
      conflict.friendly = 'Someone else just saved a change — please refresh and try again.';
      throw conflict;
    }
    throw e;
  }
}

module.exports = { readJsonFile, writeJsonFile, uploadBinaryFile };
