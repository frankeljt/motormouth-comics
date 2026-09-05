#!/usr/bin/env python3
"""
Motormouth Admin Server
-----------------------
Run:  python3 admin.py
Open: http://localhost:4322/admin/
"""

import base64
import hashlib
import http.server
import json
import secrets
import time
import urllib.parse
from pathlib import Path

ROOT   = Path(__file__).parent
DATA   = ROOT / 'data'
IMGS   = ROOT / 'images'
PORT   = 4322

DATA.mkdir(exist_ok=True)
IMGS.mkdir(exist_ok=True)

# ── Sessions ──────────────────────────────────────────────────────────────────
SESSIONS: dict[str, float] = {}   # token → expiry (unix time)
SESSION_TTL = 7 * 24 * 3600       # 7 days

# ── Credentials ───────────────────────────────────────────────────────────────
CONFIG_FILE = DATA / 'admin-config.json'

def _hash(pw: str) -> str:
    return hashlib.sha256(pw.encode()).hexdigest()

def load_config() -> dict:
    if CONFIG_FILE.exists():
        return json.loads(CONFIG_FILE.read_text())
    # First run — write defaults
    cfg = {'username': 'lily', 'password_hash': _hash('motormouth')}
    CONFIG_FILE.write_text(json.dumps(cfg, indent=2))
    return cfg

def save_config(cfg: dict):
    CONFIG_FILE.write_text(json.dumps(cfg, indent=2))


class Handler(http.server.SimpleHTTPRequestHandler):

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        code = str(args[1]) if len(args) > 1 else ''
        if code not in ('200', '304', ''):
            super().log_message(fmt, *args)

    # ── Auth helpers ──────────────────────────────────────────────────────────
    def _session_token(self):
        for chunk in self.headers.get('Cookie', '').split(';'):
            k, _, v = chunk.strip().partition('=')
            if k.strip() == 'session':
                return v.strip()
        return None

    def _is_authenticated(self) -> bool:
        token = self._session_token()
        if not token:
            return False
        expiry = SESSIONS.get(token, 0)
        if time.time() > expiry:
            SESSIONS.pop(token, None)
            return False
        return True

    def _require_auth(self) -> bool:
        """Return True if authenticated, else send 401 and return False."""
        if self._is_authenticated():
            return True
        self._json(401, b'{"error":"unauthorized"}')
        return False

    # ── Routing ───────────────────────────────────────────────────────────────
    def do_OPTIONS(self):
        self._cors_ok()

    def do_GET(self):
        p = urllib.parse.urlparse(self.path).path

        # Admin routes
        if p in ('/admin/', '/admin/login.html'):
            if p == '/admin/' and not self._is_authenticated():
                self._redirect('/admin/login.html')
                return
            if p == '/admin/' and self._is_authenticated():
                self._redirect('/admin/index.html')
                return
            super().do_GET()
            return

        # Protected admin pages
        if p.startswith('/admin/') and p != '/admin/login.html':
            if not self._is_authenticated():
                self._redirect('/admin/login.html')
                return

        # API – open
        if p == '/api/login':
            self._json(405, b'{"error":"use POST"}')
            return

        # API – protected
        if p.startswith('/api/'):
            if not self._require_auth():
                return
            if p == '/api/works':
                self._send_file(DATA / 'works.json')
            elif p == '/api/exhibitions':
                self._send_file(DATA / 'exhibitions.json')
            else:
                self.send_error(404)
            return

        super().do_GET()

    def do_POST(self):
        p = urllib.parse.urlparse(self.path).path
        body = self._body()

        if p == '/api/login':
            self._handle_login(body)
        elif p == '/api/logout':
            self._handle_logout()
        elif p == '/api/change-password':
            if not self._require_auth(): return
            self._handle_change_password(body)
        elif p == '/api/works':
            if not self._require_auth(): return
            self._write_json(DATA / 'works.json', body)
        elif p == '/api/exhibitions':
            if not self._require_auth(): return
            self._write_json(DATA / 'exhibitions.json', body)
        elif p == '/api/upload':
            if not self._require_auth(): return
            self._upload(body)
        else:
            self.send_error(404)

    # ── Auth handlers ─────────────────────────────────────────────────────────
    def _handle_login(self, body):
        try:
            data = json.loads(body)
            cfg  = load_config()
            if (data.get('username','').strip().lower() == cfg['username'].lower()
                    and _hash(data.get('password','')) == cfg['password_hash']):
                token = secrets.token_hex(32)
                SESSIONS[token] = time.time() + SESSION_TTL
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Set-Cookie',
                    f'session={token}; HttpOnly; Path=/; Max-Age={SESSION_TTL}; SameSite=Strict')
                data_out = b'{"ok":true}'
                self.send_header('Content-Length', str(len(data_out)))
                self.end_headers()
                self.wfile.write(data_out)
            else:
                self._json(401, b'{"error":"Invalid username or password"}')
        except Exception as e:
            self._json(400, json.dumps({'error': str(e)}).encode())

    def _handle_logout(self):
        token = self._session_token()
        if token:
            SESSIONS.pop(token, None)
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Set-Cookie', 'session=; HttpOnly; Path=/; Max-Age=0')
        data_out = b'{"ok":true}'
        self.send_header('Content-Length', str(len(data_out)))
        self.end_headers()
        self.wfile.write(data_out)

    def _handle_change_password(self, body):
        try:
            data = json.loads(body)
            cfg  = load_config()
            # Verify current password
            if _hash(data.get('current','')) != cfg['password_hash']:
                self._json(401, b'{"error":"Current password is incorrect"}')
                return
            new_pw = data.get('new','').strip()
            if len(new_pw) < 4:
                self._json(400, b'{"error":"New password must be at least 4 characters"}')
                return
            new_username = data.get('username','').strip() or cfg['username']
            cfg['username']      = new_username
            cfg['password_hash'] = _hash(new_pw)
            save_config(cfg)
            self._json(200, b'{"ok":true}')
        except Exception as e:
            self._json(400, json.dumps({'error': str(e)}).encode())

    # ── File handlers ─────────────────────────────────────────────────────────
    def _send_file(self, path):
        data = path.read_bytes() if path.exists() else b'[]'
        self._json(200, data)

    def _write_json(self, path, body):
        try:
            parsed = json.loads(body)
            path.write_text(json.dumps(parsed, indent=2, ensure_ascii=False))
            self._json(200, b'{"ok":true}')
        except Exception as e:
            self._json(400, json.dumps({'error': str(e)}).encode())

    def _upload(self, body):
        try:
            payload  = json.loads(body)
            filename = Path(payload['filename']).name
            raw      = payload['data']
            if ',' in raw:
                raw = raw.split(',', 1)[1]
            (IMGS / filename).write_bytes(base64.b64decode(raw))
            self._json(200, json.dumps({'ok': True, 'path': f'images/{filename}'}).encode())
        except Exception as e:
            self._json(400, json.dumps({'error': str(e)}).encode())

    # ── Helpers ───────────────────────────────────────────────────────────────
    def _body(self):
        return self.rfile.read(int(self.headers.get('Content-Length', 0)))

    def _cors_ok(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def _json(self, status: int, data: bytes):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Content-Length', str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _redirect(self, location: str):
        self.send_response(302)
        self.send_header('Location', location)
        self.end_headers()


if __name__ == '__main__':
    cfg = load_config()
    srv = http.server.HTTPServer(('', PORT), Handler)
    print(f'\n🎨  Motormouth Admin')
    print(f'    Site   →  http://localhost:{PORT}/')
    print(f'    Admin  →  http://localhost:{PORT}/admin/')
    print(f'    Login  →  username: {cfg["username"]}  password: (set in data/admin-config.json)')
    print(f'    Ctrl+C to stop\n')
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        print('Stopped.')
