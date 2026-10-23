"""Copy browser-required LFM assets byte-for-byte into a portable Pages bundle."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    source = args.source.resolve()
    output = args.output.resolve()
    if output.exists():
        raise ValueError('Use a new output directory')
    read = lambda name: json.loads((source / name).read_text())
    manifest = read('manifest.json')
    expected = read('checksums.json')['files']
    names = {'manifest.json', 'navigation-coverage.json'}
    for task in manifest['tasks'].values():
        names.add(task['catalog'])
        for item in read(task['catalog'])['items']:
            for field in ('input', 'prediction', 'metadata', 'download'):
                if item.get(field):
                    names.add(item[field])
        for entries in task.get('vector_tiles', {}).values():
            names.update(entry['file'] for entry in entries)
    names.update(str(p.relative_to(source)) for p in (source / 'ice-tiles').glob('*.png'))
    checksums = {}
    for name in sorted(names):
        relative = Path(name)
        if relative.is_absolute() or '..' in relative.parts:
            raise ValueError('Asset path escapes bundle')
        original = source / relative
        actual = digest(original)
        if actual != expected[name]:
            raise ValueError('Source asset changed: ' + name)
        target = output / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(original, target)
        if digest(target) != actual:
            raise ValueError('Copied asset differs: ' + name)
        checksums[name] = actual
    proof = dict(source_version=manifest['version'], scope='Browser asset closure; exact scientific candidates and ice prediction downloads.',
                 source_manifest_sha256=digest(source / 'manifest.json'),
                 file_count=len(names), bytes=sum((output / name).stat().st_size for name in names),
                 excluded='Unreferenced source rasters, intermediate results and full scientific archives remain on the original data disk.',
                 checksums=checksums)
    (output / 'pages-bundle.json').write_text(json.dumps(proof, indent=2) + '\n')
    print(json.dumps({k: v for k, v in proof.items() if k != 'checksums'}))


if __name__ == '__main__':
    main()
