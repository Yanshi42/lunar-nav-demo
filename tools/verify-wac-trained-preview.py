"""Check the trial map's layer switches, navigation projection UI and full-geometry download."""
import argparse
import json
from pathlib import Path

from playwright.sync_api import sync_playwright


def main():
    p=argparse.ArgumentParser();p.add_argument('--url',default='http://127.0.0.1:4173/');p.add_argument('--output',type=Path,required=True)
    args=p.parse_args();out=args.output;out.mkdir(parents=True,exist_ok=False);errors=[]
    with sync_playwright() as runtime:
        browser=runtime.chromium.launch(headless=True)
        page=browser.new_page(viewport={'width':1440,'height':1080},accept_downloads=True)
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(args.url+'wac-trained-preview.html?model=pilot',wait_until='networkidle')
        page.wait_for_function('!!window.wacTrial',timeout=30000)
        data=page.evaluate('window.wacTrial.data');assert data['summary']['jobs']==95
        assert len(data['layers']['large'])==26 and len(data['layers']['small'])==559
        assert '100.0%' in page.locator('#status').inner_text()
        page.screenshot(path=str(out/'large.png'),full_page=True)
        initial=page.locator('canvas').evaluate('(c)=>c.toDataURL()')
        page.select_option('#mode','original');assert page.locator('canvas').evaluate('(c)=>c.toDataURL()')!=initial
        page.screenshot(path=str(out/'original.png'),full_page=True)
        page.select_option('#mode','combined');page.screenshot(path=str(out/'combined.png'),full_page=True)
        page.select_option('#mode','large');page.check('#uncertain');page.screenshot(path=str(out/'uncertain.png'),full_page=True);page.uncheck('#uncertain')
        line=next(line for f in data['layers']['large'] for line in f['lines'] if len(line)>1)
        a,b=line[0],line[1];x,y=(a[0]+b[0])/2,(a[1]+b[1])/2
        page.locator('canvas').scroll_into_view_if_needed();r=page.locator('canvas').bounding_box()
        page.mouse.click(r['x']+x*r['width'],r['y']+y*r['height']);assert '分数' in page.locator('#detail').inner_text()
        page.mouse.move(r['x']+r['width']/2,r['y']+r['height']/2);page.mouse.wheel(0,-300)
        assert page.locator('canvas').evaluate('(c)=>c.toDataURL()')!=initial
        page.click('#reset');assert page.locator('canvas').evaluate('(c)=>c.toDataURL()')==initial
        with page.expect_download() as event:page.click('#largeDownload')
        download=out/'large.geojson';event.value.save_as(download);features=json.loads(download.read_text())['features']
        assert len(features)==26 and sum(f['properties']['crosses_navigation_boundary'] for f in features)==11
        assert all(f['properties']['geometry_clipped_to_navigation_tile'] is False for f in features)
        page.select_option('#model','followup')
        page.wait_for_function('window.wacTrial?.model === "followup"')
        followup=page.evaluate('window.wacTrial.data')
        assert len(followup['layers']['large'])==41 and len(followup['layers']['uncertain'])==8
        assert followup['summary']['checkpoint_sha256']=='f4a90f5d9b559e92a00033a698e38939fe8d829f5c60e282357fc03138f61d29'
        page.screenshot(path=str(out/'followup-large.png'),full_page=True)
        page.select_option('#mode','combined');page.screenshot(path=str(out/'followup-combined.png'),full_page=True)
        page.select_option('#mode','large')
        with page.expect_download() as event:page.click('#largeDownload')
        followup_download=out/'followup-large.geojson';event.value.save_as(followup_download)
        followup_features=json.loads(followup_download.read_text())['features']
        assert len(followup_features)==41 and sum(f['properties']['crosses_navigation_boundary'] for f in followup_features)==19
        assert all(f['properties']['geometry_clipped_to_navigation_tile'] is False for f in followup_features)
        page.reload(wait_until='networkidle');page.wait_for_function('window.wacTrial?.model === "followup"')
        page.select_option('#model','pilot');page.wait_for_function('window.wacTrial?.model === "pilot"')
        assert len(page.evaluate('window.wacTrial.data.layers.large'))==26
        page.select_option('#model','complete');page.wait_for_function('window.wacTrial?.model === "complete"')
        complete=page.evaluate('window.wacTrial.data')
        assert complete['summary']['total_inference_jobs']==186
        assert complete['summary']['small_source_mode']=='verified_native_windows'
        assert len(complete['layers']['large'])==26 and len(complete['layers']['small'])==918
        assert len(complete['layers']['uncertain'])==353
        assert '186' in page.locator('#status').inner_text() and '原生推理小坑' in page.locator('#status').inner_text()
        page.select_option('#mode','combined');page.screenshot(path=str(out/'complete-combined.png'),full_page=True)
        with page.expect_download() as event:page.click('#combinedDownload')
        complete_download=out/'complete-combined.geojson';event.value.save_as(complete_download)
        complete_features=json.loads(complete_download.read_text())['features']
        assert len(complete_features)==944 and len({f['id'] for f in complete_features})==944
        assert all(f['properties']['geometry_clipped_to_navigation_tile'] is False for f in complete_features)
        assert {f['properties']['checkpoint_sha256'] for f in complete_features if f['properties']['detector_route']=='large'}=={'169b9bdff30be5f5f838253a4b6efd03b9081ce4e51baa5afa49c2f197633d5c'}
        page.select_option('#mode','large');page.screenshot(path=str(out/'complete-large.png'),full_page=True)
        page.check('#uncertain');page.screenshot(path=str(out/'complete-uncertain.png'),full_page=True);page.uncheck('#uncertain')
        page.set_viewport_size({'width':390,'height':844});page.goto(args.url+'wac-trained-preview.html',wait_until='networkidle');page.wait_for_function('!!window.wacTrial')
        assert page.evaluate('window.wacTrial.model')=='complete'
        assert page.evaluate('document.documentElement.scrollWidth<=window.innerWidth+1')
        page.screenshot(path=str(out/'mobile.png'),full_page=True)
        page.set_viewport_size({'width':1440,'height':1080});page.goto(args.url,wait_until='networkidle')
        page.wait_for_selector('#lfmHome input[data-task="ice"]')
        assert page.locator('#lfmHome input[data-task="ice"]').is_checked()
        assert page.locator('#lfmHome input[data-task="wac"]').is_checked()
        assert page.locator('#lfmHome a[href="wac-trained-preview.html"]').count()==1
        page.screenshot(path=str(out/'main-preserved.png'),full_page=True)
        assert not errors,errors
        browser.close()
    result={'status':'passed','layer_switching':True,'zoom_reset':True,'candidate_inspection':True,
        'full_geometry_download_count':26,'cross_boundary_download_count':11,'mobile_layout':True,
        'model_switching':True,'followup_download_count':41,'followup_cross_boundary_count':19,
        'model_selection_survives_reload':True,
        'complete_native_tile':True,'complete_download_count':944,'complete_uncertain_count':353,
        'main_water_ice_and_wac_enabled':True,'main_trial_link':True,'page_errors':errors}
    (out/'result.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))


if __name__=='__main__':main()
