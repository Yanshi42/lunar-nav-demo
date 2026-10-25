"""Package every row of the pinned DeepMoon copy of Head et al. (2010)."""
import argparse
import csv
import hashlib
import io
import json
import math
from pathlib import Path
import shutil

SOURCE_SHA256 = '6bb968015a43d16874311aedfc43168c57bcc561f37afdc566870958f238e46a'
SOURCE_URL = 'https://raw.githubusercontent.com/silburt/DeepMoon/0bccc9790bbf02b3c1df33bd0f452d87b136dc9d/catalogues/HeadCraters.csv'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', type=Path, required=True)
    parser.add_argument('--output', type=Path, default=Path('dist/assets/head-catalog'))
    args = parser.parse_args()
    raw = args.source.read_bytes()
    if hashlib.sha256(raw).hexdigest() != SOURCE_SHA256:
        raise ValueError('Pinned source CSV differs')
    table = list(csv.DictReader(io.StringIO(raw.decode(), newline='')))
    if len(table) != 5185:
        raise ValueError('Requires all5185 source records')
    records = []
    for row in table:
        lon, lat, diameter = (float(row[key]) for key in ('Lon', 'Lat', 'Diam_km'))
        if not all(math.isfinite(v) for v in (lon, lat, diameter)) or not (-180 <= lon <= 180 and -90 <= lat <= 90 and 20 <= diameter < math.pi * 1737.4):
            raise ValueError('Invalid source record')
        records.append([lon, lat, diameter])
    args.output.mkdir(parents=True, exist_ok=False)
    shutil.copyfile(args.source, args.output / 'HeadCraters.csv')
    shutil.copyfile(args.source.parent / 'LICENSE.md', args.output / 'DeepMoon-LICENSE.md')
    data = dict(body='Moon', radius_km=1737.4, count=len(records), columns=['longitude_east_deg', 'latitude_deg', 'diameter_km'],
                records=records, source_url=SOURCE_URL, source_sha256=SOURCE_SHA256,
                citation='Head et al. (2010), Science329,1504–1507, doi:10.1126/science.1195050',
                paper_url='https://doi.org/10.1126/science.1195050', source_variant='DeepMoon converted CSV, pinned commit0bccc9790bbf02b3c1df33bd0f452d87b136dc9d',
                identifier_policy='Head-00001 onwards are source data-row identifiers assigned by this viewer, not IAU crater names.',
                geometry_note='Reference circles derived from published centres and diameters on a1737.4km sphere; not mapped crater rims or model predictions.')
    (args.output / 'head.json').write_text(json.dumps(data, ensure_ascii=False, separators=(',', ':')) + '\n')
    print(json.dumps(dict(records=len(records), source_sha256=SOURCE_SHA256, bytes=(args.output / 'head.json').stat().st_size)))


if __name__ == '__main__':
    main()
