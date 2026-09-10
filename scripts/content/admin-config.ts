import { readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
const text = (name: string, label: string, extra = {}) => ({ name, label, widget: 'string', ...extra });
const long = (name: string, label: string, extra = {}) => text(name, label, { widget: 'text', ...extra });
const list = (name: string, label: string) => ({ name, label, widget: 'list', field: long('item', 'Text'), required: false });
const articleFields = [text('title','Title'),text('category','Category'),long('summary','Summary'),text('imageAlt','Image description'),text('readTime','Reading time'),long('intro','Introduction'),{name:'sections',label:'Sections',widget:'list',min:1,summary:'{{fields.heading}}',fields:[text('heading','Heading'),{...list('paragraphs','Paragraphs'),required:true,min:1}]},list('checklist','Checklist'),long('closing','Closing paragraph')];
const projectFields = [text('title','Project name'),text('type','Business type'),long('summary','Summary'),text('packageName','Package'),list('addons','Add-ons'),list('delivered','Delivered'),long('outcome','Outcome')];
const languages = (fields: any[]) => ['en','my'].map(name=>({name,label:name==='en'?'English':'Myanmar',widget:'object',collapsed:true,fields}));
const image = (name:string,label:string,required=true) => ({name,label,widget:'image',required,allow_multiple:false});
const ordering = {name:'order',label:'Display order',widget:'number',value_type:'int',min:0,default:100,hint:'Lower numbers appear first.'};
const identifier = (name:string,label:string) => text(name,label,{pattern:['^[a-z0-9]+(?:-[a-z0-9]+)*$','Use lowercase letters, numbers and hyphens.'],hint:'Keep this unchanged after publishing to preserve links.'});
const pages=[];
for(const file of (await readdir('content/pages')).filter(file=>file.endsWith('.json')).sort()){
  const data=JSON.parse(await readFile(`content/pages/${file}`,'utf8'));
  const groups=['strings','numbers','flags'].map(group=>({name:group,label:group==='strings'?'Text':group==='numbers'?'Values':'Options',widget:data[group].length?'list':'hidden',default:[],allow_add:false,allow_delete:false,collapsed:true,summary:'{{fields.label}}',fields:[{name:'key',widget:'hidden'},{name:'label',widget:'hidden'},...['en','my'].map(name=>({name,label:name==='en'?'English':'Myanmar',widget:group==='strings'?'text':group==='numbers'?'number':'boolean',...(group==='numbers'?{value_type:'float'}:{}),required:name==='en'}))]}));
  pages.push({name:file.slice(0,-5),label:data.title,file:`content/pages/${file}`,fields:[{name:'title',widget:'hidden'},...groups]});
}
const business=JSON.parse(await readFile('content/settings/business.json','utf8'));
const title=(s:string)=>s.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,c=>c.toUpperCase());
const config={backend:{name:'github',repo:'yidigitalmm/Yi-digital-website',branch:'main',base_url:'https://yidigitalmm.com',auth_endpoint:'api/cms/auth'},publish_mode:'editorial_workflow',media_folder:'public/uploads',public_folder:'/uploads',site_url:'https://yidigitalmm.com',display_url:'https://yidigitalmm.com',logo_url:'/brand/yi-digital-horizontal-light.svg',local_backend:true,collections:[
  {name:'journal',label:'Journal',folder:'content/journal',create:true,format:'json',extension:'json',identifier_field:'slug',slug:'{{slug}}',summary:'{{en.title}}',preview_path:'journal/{{slug}}',editor:{preview:false},fields:[identifier('slug','Article address'),ordering,image('image','Cover image'),...languages(articleFields)]},
  {name:'work',label:'Our Work',folder:'content/work',create:true,format:'json',extension:'json',identifier_field:'id',slug:'{{fields.id}}',summary:'{{en.title}}',preview_path:'our-work',editor:{preview:false},fields:[identifier('id','Project ID'),ordering,image('image','Cover image'),{name:'websitePreview',label:'Show scrollable website preview',widget:'boolean',default:false},image('scrollImage','Full website screenshot',false),text('url','Website URL',{required:false}),...languages(projectFields)]},
  {name:'pages',label:'Page text & pricing',editor:{preview:false},files:pages},
  {name:'settings',label:'Business & images',editor:{preview:false},files:[
    {name:'business',label:'Contact & social links',file:'content/settings/business.json',fields:Object.keys(business).map(key=>text(key,title(key)))},
    {name:'media',label:'Website images',file:'content/settings/media.json',fields:[{name:'items',label:'Images',widget:'list',allow_add:false,allow_delete:false,collapsed:true,summary:'{{fields.label}}',fields:[{name:'key',widget:'hidden'},{name:'label',widget:'hidden'},image('url','Image')]}]},
  ]},
]};
await mkdir('public/admin',{recursive:true});
// JSON is valid YAML and avoids a second configuration format/dependency.
await writeFile('public/admin/config.yml',JSON.stringify(config,null,2)+'\n');
console.log('Generated Decap editor configuration.');
