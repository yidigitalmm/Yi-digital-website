import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useBufferedVideo } from './useBufferedVideo';
afterEach(()=>vi.unstubAllGlobals());
it('downloads once near the viewport, exposes a local seekable URL and releases it',async()=>{
 let enter:IntersectionObserverCallback=()=>{};
 const disconnect=vi.fn();
 vi.stubGlobal('IntersectionObserver',class {constructor(cb:IntersectionObserverCallback){enter=cb;} observe(){} disconnect=disconnect;});
 const fetcher=vi.fn().mockResolvedValue({ok:true,blob:async()=>new Blob(['video'],{type:'video/mp4'})});
 vi.stubGlobal('fetch',fetcher);
 const create=vi.fn().mockReturnValue('blob:tea');const revoke=vi.fn();
 vi.stubGlobal('URL',{createObjectURL:create,revokeObjectURL:revoke});
 const frame={current:document.createElement('div')};
 const {result,unmount}=renderHook(()=>useBufferedVideo('/tea.mp4',frame));
 expect(fetcher).not.toHaveBeenCalled();
 act(()=>enter([{isIntersecting:true}] as IntersectionObserverEntry[],{} as IntersectionObserver));
 await waitFor(()=>expect(result.current.src).toBe('blob:tea'));
 act(()=>enter([{isIntersecting:true}] as IntersectionObserverEntry[],{} as IntersectionObserver));
 expect(fetcher).toHaveBeenCalledTimes(1);
 expect(result.current.loading).toBe(false);
 unmount();expect(revoke).toHaveBeenCalledWith('blob:tea');
 expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
});
it('starts background loading before the final demo enters view, without duplicate downloads', async () => {
 vi.useFakeTimers();
 let enter: IntersectionObserverCallback = () => {};
 vi.stubGlobal('IntersectionObserver', class { constructor(cb: IntersectionObserverCallback) { enter = cb; } observe() {} disconnect() {} });
 const fetcher = vi.fn().mockResolvedValue({ok:true,blob:async()=>new Blob(['video'],{type:'video/mp4'})});
 vi.stubGlobal('fetch', fetcher);
 vi.stubGlobal('URL', {createObjectURL:vi.fn().mockReturnValue('blob:tea'),revokeObjectURL:vi.fn()});
 try {
  const frame = {current:document.createElement('div')};
  const {result,unmount} = renderHook(()=>useBufferedVideo('/tea.mp4',frame,true));
  expect(fetcher).not.toHaveBeenCalled();
  await act(async()=>{await vi.advanceTimersByTimeAsync(1500);});
  expect(result.current.src).toBe('blob:tea');
  act(()=>enter([{isIntersecting:true}] as IntersectionObserverEntry[],{} as IntersectionObserver));
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0][1].priority).toBe('low');
  unmount();
 } finally { vi.useRealTimers(); }
});
it('cancels the scheduled background download when leaving the page', async () => {
 vi.useFakeTimers();
 vi.stubGlobal('IntersectionObserver',class {observe(){} disconnect(){}});
 const fetcher=vi.fn();vi.stubGlobal('fetch',fetcher);
 try {
  const frame={current:null};
  const {unmount}=renderHook(()=>useBufferedVideo('/tea.mp4',frame,true));
  unmount();await vi.advanceTimersByTimeAsync(1500);
  expect(fetcher).not.toHaveBeenCalled();
 } finally {vi.useRealTimers();}
});
