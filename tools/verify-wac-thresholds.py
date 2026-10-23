"""Browser QA for actual threshold sweeps, image views, query and mobile display."""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright


def main():
    p = argparse.ArgumentParser()
    p.add_argument('--url', required=True)
    p.add_argument('--output', type=Path, required=True)
    args = p.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    errors, checked = [], []
    with sync_playwright() as runtime:
        browser = runtime.chromium.launch(headless=True)
        page = browser.new_page(viewport={'width': 1500, 'height': 1100}, accept_downloads=True)
        page.on('pageerror', lambda e: errors.append(str(e)))
        page.goto(args.url, wait_until='networkidle')
        page.wait_for_function('window.thresholdPageReady === true')
        data = page.request.get(args.url.split('?')[0].rstrip('/') + '/display.json').json()
        assert page.locator('#countsTable tr').count() == 10
        for integer in range(1, 11):
            key = f'{integer / 10:.1f}'
            page.get_by_role('button', name='阈值 ' + key, exact=True).click()
            assert page.locator('#thresholdValue').inner_text() == key
            assert page.locator('[data-threshold="' + str(integer) + '"]').get_attribute('aria-pressed') == 'true'
            for version in ['baseline', 'multiscale']:
                assert int(page.locator('#' + version + 'Count').inner_text()) == data['sets'][version][key]['stats']['count']
                assert all(c['score'] >= integer / 10 for c in data['sets'][version][key]['candidates'])
            if integer in [1, 3, 5, 7, 9, 10]:
                page.screenshot(path=str(args.output / ('threshold-' + key + '.png')), full_page=True)
            checked.append(key)
        page.get_by_role('button', name='阈值 0.3', exact=True).click()
        before = page.locator('#baselineCanvas').evaluate('(c)=>c.toDataURL()')
        page.select_option('#background', 'wac')
        assert page.locator('#baselineCanvas').evaluate('(c)=>c.toDataURL()') != before
        page.select_option('#background', 'dem')
        page.select_option('#view', 'Bunsen A')
        assert '0.884' in page.locator('#multiscaleReference').inner_text()
        assert int(page.locator('#baselineCount').inner_text()) == 587
        width = page.locator('#baselineCanvas').evaluate('(c)=>c.getBoundingClientRect().width')
        page.locator('#zoom').fill('2'); page.locator('#zoom').dispatch_event('input')
        assert page.locator('#baselineCanvas').evaluate('(c)=>c.getBoundingClientRect().width') > width * 1.9
        page.locator('#zoom').fill('1'); page.locator('#zoom').dispatch_event('input')
        page.screenshot(path=str(args.output / 'bunsen-a-03.png'), full_page=True)
        page.select_option('#view', 'all')
        candidate = data['sets']['baseline']['0.3']['candidates'][0]
        line = candidate['lines'][0]
        x, y = sum(v[0] for v in line) / len(line), sum(v[1] for v in line) / len(line)
        crop = data['crop']
        point = page.locator('#baselineCanvas').evaluate('(c,p)=>{const r=c.getBoundingClientRect();return {x:r.x+p[0]/c.width*r.width,y:r.y+p[1]/c.height*r.height}}', [x - crop[0], y - crop[1]])
        page.mouse.click(point['x'], point['y'])
        assert '分数' in page.locator('#baselineProbe').inner_text()
        with page.expect_download() as download:
            page.get_by_role('link', name='下载统计 CSV').click()
        file = args.output / 'downloaded-statistics.csv'
        download.value.save_as(file)
        assert len(file.read_text().splitlines()) == 21
        for name in ['baseline-threshold-contact-sheet.png', 'multiscale-threshold-contact-sheet.png', 'threshold-statistics.png']:
            assert page.request.get(args.url.split('?')[0].rstrip('/') + '/' + name).ok
        # Deep links and mobile do not depend on the desktop state.
        mobile = browser.new_page(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True)
        mobile.on('pageerror', lambda e: errors.append('mobile: ' + str(e)))
        mobile.goto(args.url.split('?')[0].rstrip('/') + '/?t=0.7&view=Bunsen', wait_until='networkidle')
        mobile.wait_for_function('window.thresholdPageReady === true')
        assert mobile.locator('#thresholdValue').inner_text() == '0.7'
        assert mobile.locator('#view').input_value() == 'Bunsen'
        assert mobile.evaluate('document.documentElement.scrollWidth <= innerWidth + 1')
        mobile.screenshot(path=str(args.output / 'mobile-07-bunsen.png'), full_page=True)
        mobile.get_by_role('button', name='阈值 1.0', exact=True).click()
        assert mobile.locator('#baselineCount').inner_text() == mobile.locator('#multiscaleCount').inner_text() == '0'
        assert not errors, errors
        browser.close()
    result = {'status': 'passed', 'thresholds': checked, 'errors': errors,
              'checks': ['all_twenty_counts_and_scores', 'threshold_buttons', 'background_switch', 'crop_keeps_whole_tile_stats',
                         'large_crater_comparison', 'zoom', 'candidate_query', 'csv_download', 'contact_sheet_downloads',
                         'mobile_no_overflow', 'deep_link_state', 'strict_1p0_zero_candidates']}
    (args.output / 'browser-verification.json').write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n')
    print(json.dumps(result, ensure_ascii=False))


if __name__ == '__main__':
    main()
