"""Publish this repository/release using an existing Git credential in memory.

Never prints or persists credentials. Does not initiate interactive authentication.
"""
import argparse
import hashlib
import json
import os
import pathlib
import subprocess
import urllib.error
import urllib.parse
import urllib.request

ROOT = pathlib.Path(__file__).resolve().parent.parent
ENV = {**os.environ, 'GIT_TERMINAL_PROMPT': '0', 'GCM_INTERACTIVE': 'Never'}

def credential():
    p = subprocess.run(['git', 'credential', 'fill'], input='protocol=https\nhost=github.com\n\n', text=True, capture_output=True, env=ENV, check=False)
    values = dict(line.split('=', 1) for line in p.stdout.splitlines() if '=' in line)
    if not values.get('password'):
        raise SystemExit('No noninteractive GitHub credential is available.')
    return values['password']

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('action', choices=['identity', 'create', 'release', 'upload'])
    parser.add_argument('--repository', default='OpenInterview-AI')
    parser.add_argument('--tag', default='v0.1.0')
    parser.add_argument('--file')
    args = parser.parse_args()
    token = credential()
    def request(path, method='GET', payload=None, binary=None):
        url = path if path.startswith('https://') else 'https://api.github.com' + path
        body = binary if binary is not None else (json.dumps(payload).encode() if payload is not None else None)
        headers = {'Authorization': 'Bearer '+token, 'Accept': 'application/vnd.github+json', 'User-Agent': 'OpenInterview-release', 'X-GitHub-Api-Version': '2022-11-28'}
        if body is not None: headers['Content-Type'] = 'application/octet-stream' if binary is not None else 'application/json'
        req = urllib.request.Request(url, data=body, method=method, headers=headers)
        with urllib.request.urlopen(req, timeout=600 if binary is not None else 60) as response: return json.load(response)
    user = request('/user')['login']
    repo = user + '/' + args.repository
    if args.action == 'identity':
        print(json.dumps({'login': user})); return
    if args.action == 'create':
        try: result = request('/repos/' + repo)
        except urllib.error.HTTPError as error:
            if error.code != 404: raise
            result = request('/user/repos', 'POST', {'name': args.repository, 'description': 'Local-first open-source interview preparation: Next.js, Electron and FastAPI', 'private': False, 'auto_init': False, 'has_issues': True})
        print(json.dumps({'repository': result['full_name'], 'url': result['html_url'], 'clone_url': result['clone_url'], 'id': result['id']})); return
    try: release = request('/repos/' + repo + '/releases/tags/' + args.tag)
    except urllib.error.HTTPError as error:
        if error.code != 404: raise
        notes = (ROOT / 'docs' / 'RELEASE_NOTES.md').read_text(encoding='utf-8')
        release = request('/repos/'+repo+'/releases', 'POST', {'tag_name': args.tag, 'name': 'OpenInterview AI '+args.tag+' — initial community release', 'body': notes, 'draft': False, 'prerelease': False})
    if args.action == 'upload':
        path = pathlib.Path(args.file).resolve()
        with path.open('rb') as source:
            checksum = hashlib.file_digest(source, 'sha256').hexdigest()
        existing = next((a for a in release['assets'] if a['name'] == path.name), None)
        if existing:
            if existing.get('state') != 'uploaded' or existing['size'] != path.stat().st_size or (existing.get('digest') and existing['digest'] != 'sha256:' + checksum):
                raise SystemExit('The existing release asset is incomplete or differs; refusing to reuse it.')
            print(json.dumps({'url': existing['browser_download_url'], 'size': existing['size'], 'sha256': checksum, 'providerDigest': existing.get('digest'), 'existing': True})); return
        url = release['upload_url'].split('{')[0] + '?name=' + urllib.parse.quote(path.name)
        asset = request(url, 'POST', binary=path.read_bytes())
        if asset['size'] != path.stat().st_size or (asset.get('digest') and asset['digest'] != 'sha256:' + checksum):
            raise SystemExit('The uploaded release asset failed size or checksum verification.')
        print(json.dumps({'url': asset['browser_download_url'], 'size': asset['size'], 'sha256': checksum, 'providerDigest': asset.get('digest')})); return
    print(json.dumps({'url': release['html_url'], 'id': release['id']}))

if __name__ == '__main__':
    try: main()
    except urllib.error.HTTPError as error:
        raise SystemExit('GitHub operation failed with HTTP ' + str(error.code)) from None
