import argparse,json
from pathlib import Path
from playwright.sync_api import sync_playwright


def main():
    p=argparse.ArgumentParser();p.add_argument('--url',required=True);p.add_argument('--output',type=Path,required=True)
    args=p.parse_args();args.output.mkdir(parents=True,exist_ok=True);errors=[]
    with sync_playwright() as runtime:
        browser=runtime.chromium.launch(headless=True);page=browser.new_page(viewport={'width':1500,'height':1100})
        page.on('pageerror',lambda e:errors.append(str(e)));page.goto(args.url,wait_until='networkidle');page.wait_for_function('window.finetuneAuditReady === true')
        base=args.url.rstrip('/')+'/';data=page.request.get(base+'display.json').json();assert len(data['cases'])==100
        assert page.locator('#sample option').count()==100 and page.locator('#metrics tr').count()==3
        assert page.locator('#metrics').inner_text().count('0.25669')>=1
        for i in [0,49,99]:
            page.select_option('#sample',str(i));page.wait_for_function('(id)=>document.querySelector("#caseInfo").textContent.includes(id)',arg=data['cases'][i]['id'])
            assert str(len(data['cases'][i]['ground_truth']['boxes']))+' 个标注框'==page.locator('#gtInfo').inner_text()
        page.click('#largest');largest=max(data['cases'],key=lambda c:c['largest_gt_box_size_proxy_km'])
        page.wait_for_function('(id)=>document.querySelector("#caseInfo").textContent.includes(id)',arg=largest['id'])
        before=page.locator('#newCanvas').evaluate('(c)=>c.toDataURL()');page.check('#overlay')
        assert page.locator('#newCanvas').evaluate('(c)=>c.toDataURL()')!=before
        width=page.locator('#newCanvas').evaluate('(c)=>c.getBoundingClientRect().width');page.locator('#zoom').fill('2');page.locator('#zoom').dispatch_event('input')
        assert page.locator('#newCanvas').evaluate('(c)=>c.getBoundingClientRect().width')>width*1.9
        page.locator('#zoom').fill('1');page.locator('#zoom').dispatch_event('input');page.screenshot(path=str(args.output/'largest-labelled-crater.png'),full_page=True)
        for item in data['cases']:assert page.request.get(base+item['image']).ok
        assert page.locator('input[type=range]').count()==1,'Unexpected threshold control'
        mobile=browser.new_page(viewport={'width':390,'height':844},is_mobile=True,has_touch=True);mobile.on('pageerror',lambda e:errors.append(str(e)))
        mobile.goto(base+'?sample=100',wait_until='networkidle');mobile.wait_for_function('window.finetuneAuditReady === true')
        assert mobile.locator('#sample').input_value()=='99';assert mobile.evaluate('document.documentElement.scrollWidth<=innerWidth+1')
        mobile.click('#previous');mobile.wait_for_function('(id)=>document.querySelector("#caseInfo").textContent.includes(id)',arg=data['cases'][98]['id'])
        mobile.screenshot(path=str(args.output/'mobile-audit.png'),full_page=True);assert not errors,errors;browser.close()
    result={'status':'passed','errors':errors,'cases':100,'checks':['metrics_table','all_100_images_available','case_picker','largest_gt_case','gt_overlay','zoom','no_threshold_control','mobile_no_overflow','deep_link','previous_next']}
    (args.output/'browser-verification.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))


if __name__=='__main__':main()
