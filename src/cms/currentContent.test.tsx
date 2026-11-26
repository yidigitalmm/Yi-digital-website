import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { normalizeSite } from '../../scripts/content/siteNormalize';

afterEach(() => { cleanup(); vi.doUnmock('./snapshot.json'); vi.resetModules(); });

describe('current website CMS connections', () => {
  it('publishes package price, name, service text and imagery to the rendered cards', async () => {
    vi.resetModules();
    vi.doMock('./snapshot.json', () => ({default: {pages:[
      {id:'site-offerings',entries:[
        {key:'["options",0,"price"]',en:'US$225',kind:'string'},
        {key:'["options",0,"name"]',en:'Starter website',kind:'string'},
      ]},
      {id:'site-services-details',entries:[{key:JSON.stringify(['Make your website do more.']),en:'Systems for your business',kind:'string'}]},
    ],media:[{key:'serviceShop',url:'/uploads/custom-shop.jpg'}]}}));
    const { ServicePackages } = await import('../ServicePackages');
    const {container}=render(<MemoryRouter><ServicePackages locale="en"/></MemoryRouter>);
    expect(screen.getByText('US$225')).toBeInTheDocument();
    expect(screen.getByRole('heading',{name:'Starter website'})).toBeInTheDocument();
    expect(screen.getByRole('heading',{name:'Systems for your business'})).toBeInTheDocument();
    expect(container.querySelector('.art-shop')).toHaveAttribute('src','/uploads/custom-shop.jpg');
    expect(screen.getAllByRole('link',{name:'Discuss this package'})[0]).toHaveAttribute('href','/contact?package=Starter%20website#contact-form');
  });
  it('publishes Myanmar tea text and video replacements without changing the layout', async () => {
    vi.resetModules();
    vi.doMock('./snapshot.json',()=>({default:{pages:[{id:'site-tea',entries:[{key:JSON.stringify(['Product journeys']),en:'Supply chains',my:'ထုတ်ကုန်အသစ်',kind:'string'}]}],media:[{key:'teaJourneyVideo',url:'/uploads/new-tea.mp4'}]}}));
    const {editorialText}=await import('./editorialText');
    const {getMedia}=await import('./siteContent');
    expect(editorialText('tea','my','Product journeys','fallback')).toBe('ထုတ်ကုန်အသစ်');
    expect(getMedia('teaJourneyVideo','old.mp4')).toBe('/uploads/new-tea.mp4');
  });
  it('rejects incompatible video uploads while accepting replacements',()=>{
    expect(()=>normalizeSite({media:[{key:'teaJourneyVideo',url:'/uploads/photo.jpg'}]})).toThrow('Expected .mp4');
    expect(normalizeSite({media:[{key:'teaJourneyVideo',url:'/uploads/replacement.mp4'}]}).media[0].url).toBe('/uploads/replacement.mp4');
  });
  it('removes the legacy MMK packages and private draft fields from the editor',()=>{
    const old=JSON.parse(readFileSync('content/pages/site-packages.json','utf8'));
    expect(old.strings.every((r:{key:string})=>JSON.parse(r.key)[0]==='connectedPresence')).toBe(true);
    const current=JSON.parse(readFileSync('content/pages/site-offerings.json','utf8'));
    expect(current.strings.find((r:{key:string})=>r.key==='["options",0,"price"]').en).toBe('US$200');
    expect(current.strings.some((r:{key:string})=>JSON.parse(r.key)[0]==='rows')).toBe(false);
    expect(current.strings.some((r:{key:string})=>r.key==='["addons",7,1]')).toBe(false);
  });
});
