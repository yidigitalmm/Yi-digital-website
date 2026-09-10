import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { renderContent } from '../scripts/content/model';
const read=(file:string)=>JSON.parse(readFileSync(file,'utf8'));
const folder=(path:string)=>readdirSync(path).filter(file=>file.endsWith('.json')).map(file=>({id:file.slice(0,-5),data:read(`${path}/${file}`)}));
const input=()=>({pages:folder('content/pages'),articles:folder('content/journal').map(item=>item.data),work:folder('content/work').map(item=>item.data),business:read('content/settings/business.json'),media:read('content/settings/media.json')});
describe('Git content and Decap configuration',()=>{
  it('connects file content edits to the website without CMS network calls',()=>{
    const data=input();data.articles[0].en.title='Updated in Git';
    const content=renderContent(data);
    expect(content.articles.some(article=>article.en.title==='Updated in Git')).toBe(true);
  });
  it('rejects external image dependencies and invalid content',()=>{
    const data=input();data.articles[0].image='https://cdn.sanity.io/image.jpg';
    expect(()=>renderContent(data)).toThrow('local image');
    const invalid=input();invalid.work[0].order=-1;expect(()=>renderContent(invalid)).toThrow('Display order');
  });
  it('serves every content image locally',()=>{
    const serialized=JSON.stringify(input());expect(serialized).not.toContain('cdn.sanity.io');
    const content=renderContent(input());
    for(const path of [...content.media.map(item=>item.url),...content.articles.map(item=>item.en.image),...content.work.flatMap(item=>[item.en.image,...(item.en.scrollImage?[item.en.scrollImage]:[])])])expect(existsSync(`public${path}`)).toBe(true);
  });
  it('exposes existing files and hides internal keys in Decap',()=>{
    const config=read('public/admin/config.yml');
    expect(config.backend).toMatchObject({name:'github',repo:'yidigitalmm/Yi-digital-website',branch:'main',auth_endpoint:'api/cms/auth'});
    expect(config.publish_mode).toBe('editorial_workflow');
    for(const collection of config.collections)for(const file of collection.files??[])expect(existsSync(file.file)).toBe(true);
    const page=config.collections.find((c:any)=>c.name==='pages').files[0];
    expect(page.fields.find((f:any)=>f.name==='strings').fields.find((f:any)=>f.name==='key').widget).toBe('hidden');
  });
});
