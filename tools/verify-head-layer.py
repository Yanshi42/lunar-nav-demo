"""Exercise the full Head catalogue on the real globe and navigation canvases."""
import argparse
import csv
import hashlib
import io
import json
from pathlib import Path
from playwright.sync_api import sync_playwright


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--url',required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True);errors=[];report={}
    with sync_playwright() as runtime:
        browser=runtime.chromium.launch(headless=True)
        page=browser.new_page(viewport={'width':1440,'height':1100},accept_downloads=True)
        page.set_default_timeout(60000)
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.goto(args.url,wait_until='networkidle')
        page.wait_for_function("document.querySelector('#lfmHome .head-status')?.textContent.includes('5185')")
        assert page.locator('#lfmHome .head-select option').count()==5186
        assert page.locator('#lfmHome [data-head-enabled]').is_checked()
        assert '非模型预测' in page.locator('#lfmHome .head-catalog').inner_text() or '并非模型预测' in page.locator('#lfmHome .head-catalog').inner_text()
        # Observe the actual layer instance at its draw hook, without adding a debug API to production.
        page.evaluate("""async()=>{const m=await import(new URL('head-catalog.js?v=20261025-head1',location.href));const original=m.HeadCatalogLayer.prototype.drawGlobe;m.HeadCatalogLayer.prototype.drawGlobe=function(...args){window.__head=this;window.__globe=args[0];return original.apply(this,args);};}""")
        page.uncheck('#lfmHome [data-head-enabled]');page.check('#lfmHome [data-head-enabled]')
        page.wait_for_function('window.__head?.stats.globalDrawnIds.length>0')
        seen=set()
        for lat,lon in [(0,0),(0,180),(0,90),(0,-90),(90,0),(-90,0)]:
            visible=page.evaluate("""async([lat,lon])=>{window.__globe.centerOn(lat,lon);await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return window.__head.stats.globalDrawnIds;}""",[lat,lon]);seen.update(visible)
        assert len(seen)==5185, f'Only {len(seen)} source records rendered across six views'
        report['all5185_rendered_across_six_globe_views']=True
        page.evaluate('window.__globe.centerOn(0,0)');page.wait_for_timeout(150)
        page.screenshot(path=str(args.output/'head-global.png'),full_page=True)
        with page.expect_download() as info:page.locator('#lfmHome .head-downloads a').first.click()
        output=args.output/'HeadCraters.csv';info.value.save_as(output);raw=output.read_bytes()
        assert hashlib.sha256(raw).hexdigest()=='6bb968015a43d16874311aedfc43168c57bcc561f37afdc566870958f238e46a'
        assert len(list(csv.DictReader(io.StringIO(raw.decode(),newline=''))))==5185
        report['complete_original_csv_download_verified']=True
        page.fill('#lfmHome .head-search','05185');assert page.locator('#lfmHome .head-select option').count()==2
        page.select_option('#lfmHome .head-select','Head-05185');assert 'Head-05185' in page.locator('#lfmHome .head-detail').inner_text()
        page.fill('#lfmHome .head-search','')
        records=page.evaluate('window.__head.records.map(({id,lon,lat,diameter})=>({id,lon,lat,diameter}))')
        cases=[records[0],max(records,key=lambda r:r['lat']),min(records,key=lambda r:r['lat']),min(records,key=lambda r:abs(abs(r['lon'])-180)),max(records,key=lambda r:r['diameter'])]
        checked=[]
        for index,record in enumerate(cases):
            if index:page.click('#brandButton')
            page.select_option('#lfmHome .head-select',record['id']);page.click('#lfmHome .head-jump')
            page.wait_for_selector('#canvasLoading',state='hidden',timeout=90000);page.wait_for_load_state('networkidle')
            page.wait_for_function('window.__head.tile!==null && window.__head.region.some(r=>r.id===window.__head.selected.id)')
            actual=page.evaluate('({selected:window.__head.selected.id,local:window.__head.region.find(r=>r.id===window.__head.selected.id).localCenter,drawn:window.__head.stats.localDrawnIds})')
            assert actual['selected']==record['id'] and actual['local'] is not None
            detail=page.locator('#lfmPlanner .head-detail').inner_text();assert f"{record['diameter']:.3f}" in detail
            before=page.locator('#terrainCanvas').evaluate('(c)=>c.toDataURL()')
            page.uncheck('#lfmPlanner [data-head-enabled]');page.wait_for_timeout(100)
            assert not page.locator('#lfmHome [data-head-enabled]').is_checked()
            assert page.locator('#terrainCanvas').evaluate('(c)=>c.toDataURL()')!=before,record['id']+' overlay did not change'
            page.check('#lfmPlanner [data-head-enabled]');page.wait_for_timeout(100)
            page.click('[data-view="3d"]');page.wait_for_timeout(100)
            before=page.locator('#terrainCanvas').evaluate('(c)=>c.toDataURL()')
            page.uncheck('#lfmPlanner [data-head-enabled]');page.wait_for_timeout(100)
            assert page.locator('#terrainCanvas').evaluate('(c)=>c.toDataURL()')!=before,record['id']+' 3d overlay did not change'
            page.check('#lfmPlanner [data-head-enabled]');page.wait_for_timeout(100)
            page.screenshot(path=str(args.output/(record['id']+'-3d.png')))
            page.click('[data-view="2d"]')
            if index==0:
                # Query the real centre marker by a shift-click, leaving route selection intact.
                point=page.locator('#terrainCanvas').evaluate('(c,p)=>{const b=c.getBoundingClientRect(),s=Math.min(b.width-32,b.height-32);return{x:b.x+(b.width-s)/2+s*p[0],y:b.y+(b.height-s)/2+s*p[1]}}',actual['local'])
                page.evaluate('window.__head.select("")');page.keyboard.down('Shift');page.mouse.click(point['x'],point['y']);page.keyboard.up('Shift')
                assert record['id'] in page.locator('#lfmPlanner .head-detail').inner_text()
                assert '尚未发布整片预测' in page.locator('#lfmPlanner .lfm-status').inner_text()
                report['query_works_outside_wac_prediction_coverage']=True
            page.screenshot(path=str(args.output/(record['id']+'-2d.png')))
            checked.append(record)
        mobile=browser.new_page(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
        mobile.on('pageerror',lambda e:errors.append('mobile:'+str(e)));mobile.goto(args.url,wait_until='networkidle')
        mobile.wait_for_function("document.querySelector('#lfmHome .head-status')?.textContent.includes('5185')")
        assert mobile.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        mobile.select_option('#lfmHome .head-select','Head-00001');mobile.click('#lfmHome .head-jump');mobile.wait_for_selector('#canvasLoading',state='hidden',timeout=90000)
        assert mobile.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        assert 'Head-00001' in mobile.locator('#lfmPlanner .head-detail').inner_text()
        mobile.screenshot(path=str(args.output/'head-mobile.png'),full_page=True)
        assert not errors,errors
        report.update(status='passed',catalogue_records=5185,errors=errors,checked_navigation_cases=checked,mobile=True,checked_views=['global','2d','3d'],url=args.url)
        browser.close()
    (args.output/'head-browser-verification.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report))


if __name__=='__main__':main()
