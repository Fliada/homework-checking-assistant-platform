"""Install pinned JPlag and a repository-local Java runtime; never changes system Java."""
import hashlib, json, platform, tarfile, ssl, urllib.request
import certifi
TLS = ssl.create_default_context(cafile=certifi.where())
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
VENDOR = ROOT / 'backend' / 'vendor'
VENDOR.mkdir(parents=True, exist_ok=True)
def fetch(url, path, checksum=None):
    if path.exists() and (not checksum or hashlib.sha256(path.read_bytes()).hexdigest() == checksum): return
    print("Downloading", path.name, flush=True)
    with urllib.request.urlopen(url, context=TLS, timeout=120) as response, path.open("wb") as output:
        import shutil
        shutil.copyfileobj(response, output)
    if checksum and hashlib.sha256(path.read_bytes()).hexdigest() != checksum:
        path.unlink()
        raise RuntimeError('Download checksum mismatch')
fetch('https://github.com/jplag/JPlag/releases/download/v6.3.0/jplag-6.3.0-jar-with-dependencies.jar', VENDOR / 'jplag.jar', '5f2c21e8b88ed77134effcb3a5a3ab13d188f6a3e16d401387f7479e92db9aa2')
java_root = VENDOR / 'java'
if not list(java_root.glob('**/bin/java')):
    arch = 'aarch64' if platform.machine() in ('arm64','aarch64') else 'x64'
    os_name = 'mac' if platform.system() == 'Darwin' else 'linux'
    url = 'https://api.github.com/repos/adoptium/temurin25-binaries/releases/latest'
    with urllib.request.urlopen(url, context=TLS, timeout=60) as r: release = json.load(r)
    asset = next(a for a in release['assets'] if f'jre_{arch}_{os_name}_hotspot' in a['name'] and a['name'].endswith('.tar.gz'))
    checksum = asset.get('digest', '').removeprefix('sha256:')
    if not checksum: raise RuntimeError('Java asset has no SHA-256 digest')
    archive = VENDOR / 'java.tar.gz'
    fetch(asset['browser_download_url'], archive, checksum)
    java_root.mkdir(exist_ok=True)
    with tarfile.open(archive) as t:
        root = java_root.resolve()
        for member in t.getmembers():
            target = (root / member.name).resolve()
            if not target.is_relative_to(root) or member.isdev(): raise RuntimeError('Unsafe Java archive')
            if member.issym() and not (target.parent / member.linkname).resolve().is_relative_to(root): raise RuntimeError('Unsafe Java symlink')
            if member.islnk() and not (root / member.linkname).resolve().is_relative_to(root): raise RuntimeError('Unsafe Java hardlink')
        t.extractall(java_root)
    archive.unlink()
print('JPlag 6.3.0:', VENDOR / 'jplag.jar')
print('Java:', next(java_root.glob('**/bin/java')))
