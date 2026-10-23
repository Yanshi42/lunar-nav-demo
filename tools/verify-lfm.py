"""Browser regression checks for static LFM map layers and existing routing."""
import argparse
import json
from pathlib import Path
from playwright.sync_api import sync_playwright


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--url',default='http://127.0.0.1:4174/')
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args();args.output.mkdir(parents=True,exist_ok=True)
    errors=[];requests=[];result={}
    with sync_playwright() as p:
        browser=p.chromium.launch(headless=True)
        page=browser.new_page(viewport={'width':1440,'height':1000},accept_downloads=True)
        page.on('pageerror',lambda error:errors.append(str(error)))
        page.on('console',lambda message:errors.append(message.text) if message.type=='error' else None)
        page.on('request',lambda request:requests.append(request.url))
        page.goto(args.url,wait_until='networkidle')
        page.wait_for_selector('#lfmHome select option[value="ice-001"]',state='attached')
        assert not any('/imp-catalog.json' in url or '/prediction.tif' in url for url in requests),'Unexpected eager science loading'
        for task in ('imp','wac','nac'):
            page.locator(f'#lfmHome [data-task="{task}"]').check()
            page.wait_for_selector(f'#lfmHome select option[value="{task}-001"]',state='attached')
        manifest_url=next(url for url in requests if '/assets/lfm-' in url and url.endswith('/manifest.json'))
        manifest=page.request.get(manifest_url).json()
        assert page.locator('#lfmHome select option').count()==1+sum(t['product_count'] for t in manifest['tasks'].values())
        page.screenshot(path=str(args.output/'global-layers.png'))
        base=manifest_url.removesuffix('manifest.json')
        for task in ('imp','wac','nac','ice'):
            identity=task+'-001'
            page.select_option('#lfmHome select',identity)
            page.wait_for_function("document.querySelector('#lfmDetailInfo').textContent.includes('m/px')")
            assert page.locator('#lfmDetailDownload').is_visible()
            meta=page.request.get(base+identity+'/metadata.json').json()
            size=page.locator('#lfmDetailCanvas').evaluate('(c)=>[c.width,c.height]')
            assert size==[meta['width'],meta['height']]
            page.locator('#lfmDetailZoom').fill('2')
            page.locator('#lfmDetailZoom').dispatch_event('input')
            width=page.locator('#lfmDetailCanvas').evaluate('(c)=>c.getBoundingClientRect().width')
            assert width>min(meta['width'],900)
            page.locator('#lfmDetailZoom').fill('1');page.locator('#lfmDetailZoom').dispatch_event('input')
            if meta.get('boxes'):
                box=meta['boxes'][0]['box']
                point=page.locator('#lfmDetailCanvas').evaluate('(c,b)=>{const r=c.getBoundingClientRect();return {x:r.x+(b[0]+b[2])/2/c.width*r.width,y:r.y+(b[1]+b[3])/2/c.height*r.height}}',box)
                page.mouse.click(point['x'],point['y'])
                assert '分数' in page.locator('#lfmDetailProbe').inner_text()
                result[task+'_candidate_count']=len(meta['boxes'])
            if task=='imp':
                before=page.locator('#lfmDetailCanvas').evaluate('(c)=>c.toDataURL()')
                page.locator('#lfmDetailOpacity').fill('0');page.locator('#lfmDetailOpacity').dispatch_event('input')
                assert before!=page.locator('#lfmDetailCanvas').evaluate('(c)=>c.toDataURL()')
                with page.expect_download() as download_info:page.click('#lfmDetailDownload')
                download=download_info.value;download.save_as(args.output/'imp-prediction.tif')
                assert (args.output/'imp-prediction.tif').stat().st_size>1000
            page.screenshot(path=str(args.output/(task+'-detail.png')))
            page.click('#lfmDetailClose')
        if manifest['tasks']['wac'].get('new_region_input_count'):
            catalog=page.request.get(base+'wac-catalog.json').json()['items']
            new_item=next(i for i in catalog if i['input_cohort']=='new_region')
            page.select_option('#lfmHome select',new_item['id'])
            page.wait_for_function("document.querySelector('#lfmDetailInfo').textContent.includes('下游无标注新区域')")
            page.click('#lfmDetailJump');page.wait_for_selector('#canvasLoading',state='hidden',timeout=45000)
            page.wait_for_load_state('networkidle')
            assert page.locator('#lfmPlanner [data-observation="wac"]').is_visible()
            assert page.locator('#lfmPlanner .lfm-products option').count()>1
            page.select_option('#lfmPlanner .lfm-products',new_item['id'])
            page.wait_for_function("document.querySelector('#lfmDetailInfo').textContent.includes('下游无标注新区域')")
            page.click('#lfmDetailClose')
            page.screenshot(path=str(args.output/'wac-new-region-map.png'))
            result['new_region_id']=new_item['label'];page.click('#brandButton')
            # Select a tile containing multiple observations and load exactly the chosen chunk.
            tiles=manifest['tasks']['wac']['vector_tiles'];tile=max(tiles,key=lambda identity:len(tiles[identity]))
            coordinate=page.evaluate("""async id=>{const {tileFromFaceCell}=await import('./sphere-grid.js');const m=id.match(/f(\\d)-r(\\d+)-c(\\d+)/);return tileFromFaceCell(+m[1]-1,+m[2]-1,+m[3]-1)}""",tile)
            page.fill('#latInput',str(coordinate['lat']));page.fill('#lonInput',str(coordinate['lon']))
            page.click('#locateButton');page.click('#enterPlanner');page.wait_for_selector('#canvasLoading',state='hidden',timeout=45000)
            choice=page.locator('#lfmPlanner [data-observation="wac"]')
            assert choice.locator('option').count()==len(tiles[tile])
            alternative=tiles[tile][-1];page.select_option('#lfmPlanner [data-observation="wac"]',alternative['id'])
            page.wait_for_load_state('networkidle');assert any(url.endswith(alternative['file']) for url in requests)
            result['observation_options']=len(tiles[tile]);page.screenshot(path=str(args.output/'wac-observation-map.png'))
            page.click('#brandButton')
        # Both polar mosaics locate into real overlay tiles.
        for identity in ('ice-001','ice-002'):
            page.select_option('#lfmHome select',identity)
            page.wait_for_function("document.querySelector('#lfmDetailInfo').textContent.includes('m/px')")
            page.click('#lfmDetailJump')
            page.wait_for_selector('#canvasLoading',state='hidden',timeout=45000)
            page.wait_for_load_state('networkidle')
            before=page.locator('#terrainCanvas').evaluate('(c)=>c.toDataURL()')
            page.locator('#lfmPlanner [data-task="ice"]').uncheck()
            page.wait_for_timeout(100)
            after=page.locator('#terrainCanvas').evaluate('(c)=>c.toDataURL()')
            assert before!=after,identity+' overlay missing'
            page.locator('#lfmPlanner [data-task="ice"]').check();page.wait_for_load_state('networkidle')
            page.screenshot(path=str(args.output/(identity+'-map.png')))
            page.click('[data-view="3d"]');page.screenshot(path=str(args.output/(identity+'-3d.png')))
            page.click('[data-view="2d"]')
            page.click('#brandButton')
        # A missing scientific region stays navigable, and routing still works.
        page.fill('#latInput','0');page.fill('#lonInput','-170');page.click('#locateButton');page.click('#enterPlanner')
        page.wait_for_selector('#canvasLoading',state='hidden',timeout=45000)
        assert '未覆盖' in page.locator('#lfmPlanner .lfm-status').inner_text()
        def map_click(x,y):
            point=page.locator('#terrainCanvas').evaluate('(c,p)=>{const r=c.getBoundingClientRect(),s=Math.min(r.width-32,r.height-32);return {x:r.x+(r.width-s)/2+s*p[0],y:r.y+(r.height-s)/2+s*p[1]}}',[x,y])
            page.mouse.click(point['x'],point['y'])
        page.click('#chooseStart');map_click(.35,.45)
        page.click('#chooseEnd');map_click(.5,.55)
        page.wait_for_function("document.querySelector('#distanceMetric').textContent!=='—'",timeout=45000)
        result['route_distance']=page.locator('#distanceMetric').inner_text()
        page.screenshot(path=str(args.output/'uncovered-route.png'))
        mobile=browser.new_page(viewport={'width':390,'height':844},is_mobile=True,has_touch=True)
        mobile.on('pageerror',lambda error:errors.append('mobile: '+str(error)))
        mobile.goto(args.url,wait_until='networkidle')
        mobile.wait_for_selector('#lfmHome select option[value="ice-001"]',state='attached')
        assert mobile.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        mobile.select_option('#lfmHome select','ice-001')
        mobile.wait_for_function("document.querySelector('#lfmDetailInfo').textContent.includes('m/px')")
        mobile.screenshot(path=str(args.output/'mobile-detail.png'))
        mobile.click('#lfmDetailJump');mobile.wait_for_selector('#canvasLoading',state='hidden',timeout=45000)
        assert mobile.locator('#lfmPlanner').is_visible()
        assert mobile.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        mobile.screenshot(path=str(args.output/'mobile-map.png'),full_page=True)
        browser.close()
    result.update({'status':'passed' if not errors else 'failed','errors':errors,
                   'checks':['lazy_catalogs','four_layer_controls','native_details','zoom','crater_score_query',
                             'opacity','science_download','north_south_overlays','3d_render','uncovered_status',
                             'existing_route','mobile_controls','mobile_overflow']})
    (args.output/'browser-verification.json').write_text(json.dumps(result,indent=2,ensure_ascii=False)+'\n')
    print(json.dumps(result,ensure_ascii=False));assert not errors


if __name__=='__main__':main()
