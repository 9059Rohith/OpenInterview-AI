"""Fail on common accidentally embedded secrets without printing their values."""
import pathlib
import re
import subprocess
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
RULES = {
    'OpenAI key': re.compile(rb'sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{40,}'),
    'Google API key': re.compile(rb'AIza[0-9A-Za-z_-]{30,}'),
    'GitHub access token': re.compile(rb'(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{45,})'),
    'Private key': re.compile(rb'-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----'),
    'AWS access key': re.compile(rb'AKIA[A-Z0-9]{16}'),
}
files = subprocess.run(['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard'], cwd=ROOT, capture_output=True, check=True).stdout.split(b'\0')
findings = []
for name in dict.fromkeys(files):
    if not name: continue
    path = ROOT / name.decode('utf-8')
    if not path.is_file() or path.stat().st_size > 5_000_000: continue
    data = path.read_bytes()
    for label, pattern in RULES.items():
        for match in pattern.finditer(data):
            line = data[:match.start()].count(b'\n') + 1
            findings.append(f'{path.relative_to(ROOT)}:{line}: possible {label}')
if findings:
    print('\n'.join(findings)); sys.exit(1)
print(f'Public-source credential-pattern scan passed ({len(files)-1} candidate files).')
