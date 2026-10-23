"""Browser checks for complete-cell WAC replacement and retained navigation."""
import argparse,json
from pathlib import Path
from playwright.sync_api import sync_playwright


def main():
    p=argparse.ArgumentParser();p.add_argument('--url',default='http://127.0.0.1:4174/');p.add_argument('--output',type=Path,required=True)
    args=p.parse_args();args.output.mkdir(parents=True,exist_ok=True);errors=[];requests=[];result={}
    with sync_playwright() as runtime:
        browser=runtime.chromium.launch(headless=True);page=browser.new_page(viewport={'width':1440,'height':1000},accept_downloads=True)
        page.on('pageerror',lambda e:errors.append(str(e)));page.on('console',lambda m:errors.append(m.text) if m.type=='error' else None)
        page.on('request',lambda r:requests.append(r.url));page.goto(args.url,wait_until='networkidle')
        page.wait_for_selector('#lfmHome .lfm-products option[value^="wac-f"]',state='attached')
        assert page.locator('#lfmHome [data-task]').count()==1
        manifest_url=next(u for u in requests if '/lfm-' in u and u.endswith('/manifest.json'));base=manifest_url.removesuffix('manifest.json')
        manifest=page.request.get(manifest_url).json();assert manifest['presentation']=='complete_navigation_tiles'
        catalog=page.request.get(base+'wac-catalog.json').json()['items'];assert len(catalog)==manifest['tasks']['wac']['product_count']
        assert all(i['product_kind']=='complete_navigation_tile' and i['coverage_fraction']==1 for i in catalog)
        assert page.locator('#lfmHome .lfm-products option').count()==len(catalog)+1
        assert '完整导航片' in page.locator('#lfmHome .lfm-status').inner_text()
        page.screenshot(path=str(args.output/'complete-global.png'))
        item=catalog[0];page.select_option('#lfmHome .lfm-products',item['id'])
        page.wait_for_function("document.querySelector('#lfmDetailInfo').textContent.includes('完整导航分片')")
        meta=page.request.get(base+item['metadata']).json();assert page.locator('#lfmDetailCanvas').evaluate('(c)=>[c.width,c.height]')==[item['width'],item['height']]
        assert len(meta['boxes'])==item['candidate_count']>0
        width=page.locator('#lfmDetailCanvas').evaluate('(c)=>c.getBoundingClientRect().width')
        page.locator('#lfmDetailZoom').fill('2');page.locator('#lfmDetailZoom').dispatch_event('input')
        assert page.locator('#lfmDetailCanvas').evaluate('(c)=>c.getBoundingClientRect().width')>width*1.9
        page.locator('#lfmDetailZoom').fill('1');page.locator('#lfmDetailZoom').dispatch_event('input')
        box=meta['boxes'][0]['box'];point=page.locator('#lfmDetailCanvas').evaluate('(c,b)=>{const r=c.getBoundingClientRect();return {x:r.x+(b[0]+b[2])/2/c.width*r.width,y:r.y+(b[1]+b[3])/2/c.height*r.height}}',box)
        page.mouse.click(point['x'],point['y']);assert '分数' in page.locator('#lfmDetailProbe').inner_text()
        with page.expect_download() as info:page.click('#lfmDetailDownload')
        download=args.output/'complete-candidates.geojson';info.value.save_as(download);data=json.loads(download.read_text())
        assert data['body']=='Moon' and len(data['features'])==item['candidate_count']
        assert all(f['properties']['navigation_tile']==item['navigation_tile'] for f in data['features'])
        page.screenshot(path=str(args.output/'complete-detail.png'));page.click('#lfmDetailJump')
        page.wait_for_selector('#canvasLoading',state='hidden',timeout=45000);page.wait_for_load_state('networkidle')
        assert item['navigation_tile'].upper() in page.locator('#plannerRegionName').inner_text()
        assert '100.00%' in page.locator('#lfmPlanner .lfm-status').inner_text()
        assert page.locator('#lfmPlanner .lfm-products option').count()==2
        assert page.locator('#lfmPlanner [data-observation]').count()==0
        before=page.locator('#terrainCanvas').evaluate('(c)=>c.toDataURL()');page.locator('#lfmPlanner [data-task="wac"]').uncheck();page.wait_for_timeout(150)
        assert page.locator('#terrainCanvas').evaluate('(c)=>c.toDataURL()')!=before
        page.locator('#lfmPlanner [data-task="wac"]').check();page.wait_for_load_state('networkidle');page.screenshot(path=str(args.output/'complete-navigation.png'))
        page.click('[data-view="3d"]');page.screenshot(path=str(args.output/'complete-3d.png'));page.click('[data-view="2d"]')
        page.click('#brandButton');page.fill('#latInput','0');page.fill('#lonInput','-170');page.click('#locateButton');page.click('#enterPlanner')
        page.wait_for_selector('#canvasLoading',state='hidden',timeout=45000);assert '尚未发布整片预测' in page.locator('#lfmPlanner .lfm-status').inner_text()
        assert page.locator('#lfmPlanner .lfm-products option').count()==1
        def click_map(x,y):
            point=page.locator('#terrainCanvas').evaluate('(c,p)=>{const r=c.getBoundingClientRect(),s=Math.min(r.width-32,r.height-32);return {x:r.x+(r.width-s)/2+s*p[0],y:r.y+(r.height-s)/2+s*p[1]}}',[x,y]);page.mouse.click(point['x'],point['y'])
        page.click('#chooseStart');click_map(.35,.45);page.click('#chooseEnd');click_map(.5,.55)
        page.wait_for_function("document.querySelector('#distanceMetric').textContent!=='—'",timeout=45000);result['route_distance']=page.locator('#distanceMetric').inner_text()
        page.screenshot(path=str(args.output/'unpublished-navigation.png'))
        mobile=browser.new_page(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
        mobile.on('pageerror',lambda e:errors.append('mobile: '+str(e)));mobile.goto(args.url,wait_until='networkidle')
        mobile.wait_for_selector('#lfmHome .lfm-products option[value^="wac-f"]',state='attached');assert mobile.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        mobile.select_option('#lfmHome .lfm-products',item['id']);mobile.wait_for_function("document.querySelector('#lfmDetailInfo').textContent.includes('完整导航分片')")
        mobile.screenshot(path=str(args.output/'mobile-complete-detail.png'));mobile.click('#lfmDetailJump');mobile.wait_for_selector('#canvasLoading',state='hidden',timeout=45000)
        assert mobile.locator('#lfmPlanner').is_visible() and mobile.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        mobile.screenshot(path=str(args.output/'mobile-complete-navigation.png'),full_page=True)
        assert not any('/lfm-20261022-wac1/' in u or '/lfm-20261021-' in u for u in requests),'Legacy patch data requested'
        result.update({'status':'passed' if not errors else 'failed','errors':errors,'complete_tiles':len(catalog),'tile':item['navigation_tile'],
                       'candidate_count':item['candidate_count'],'checks':['complete_cell_only_catalog','no_legacy_patch_requests','whole_cell_detail',
                        'candidate_score_query','science_download','tile_navigation_100percent','overlay_toggle','3d','unpublished_empty','existing_route','mobile']})
        browser.close()
    (args.output/'browser-verification.json').write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\n');print(json.dumps(result,ensure_ascii=False));assert not errors

if __name__=='__main__':main()
