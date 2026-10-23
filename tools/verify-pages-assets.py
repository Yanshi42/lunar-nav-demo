"""Verify the portable LFM browser closure without the original server data disk."""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parents[1]
base = root / 'dist/assets/lfm-pages-native12'
proof = json.loads((base / 'pages-bundle.json').read_text())
for name, expected in proof['checksums'].items():
    actual = hashlib.sha256((base / name).read_bytes()).hexdigest()
    if actual != expected:
        raise ValueError('Portable science asset differs: ' + name)
manifest = json.loads((base / 'manifest.json').read_text())
assert manifest['version'] == proof['source_version']
assert manifest['tasks']['wac']['product_count'] == 16
assert manifest['tasks']['wac']['candidate_count'] == 18575
assert manifest['tasks']['ice']['product_count'] == 2
for task in manifest['tasks'].values():
    catalog = json.loads((base / task['catalog']).read_text())
    for item in catalog['items']:
        for field in ('input', 'prediction', 'metadata', 'download'):
            if item.get(field):
                assert item[field] in proof['checksums'], (item['id'], field)
    for entries in task.get('vector_tiles', {}).values():
        for entry in entries:
            assert entry['file'] in proof['checksums']
assert "const BASE = 'assets/lfm-pages-native12/';" in (root / 'dist/lfm-layers.js').read_text()
print(f"Verified {len(proof['checksums'])} portable files:16 WAC cells,18575 candidates,2 ice mosaics")
