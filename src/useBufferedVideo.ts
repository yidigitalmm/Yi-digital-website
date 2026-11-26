import { useEffect, useState, type RefObject } from 'react';

/** Fetch once: local blob seeking avoids servers that ignore HTTP Range requests. */
export function useBufferedVideo(url: string, frame: RefObject<HTMLElement | null>, background = false) {
  const [state, setState] = useState({ src: '', loading: true, failed: false });
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl = '', started = false;
    setState({ src: '', loading: true, failed: false });
    const load = async () => {
      if (started) return;
      started = true;
      try {
        const response = await fetch(url, { signal: controller.signal, priority: 'low' });
        if (!response.ok) throw new Error('Video download failed');
        const blob = await response.blob();
        if (controller.signal.aborted) return;
        if (!blob.size || !blob.type.startsWith('video/')) throw new Error('Invalid video response');
        objectUrl = URL.createObjectURL(blob);
        setState({ src: objectUrl, loading: false, failed: false });
      } catch {
        if (!controller.signal.aborted) setState({ src: '', loading: false, failed: true });
      }
    };
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) { observer.disconnect(); void load(); }
    }, { rootMargin: '400px' });
    if (frame.current) observer.observe(frame.current);
    // Prepare the final demo while visitors explore the earlier sections.
    // Give the initial page assets a head start; entering the frame still loads immediately.
    const timer = background ? window.setTimeout(() => { void load(); }, 1500) : undefined;
    return () => { window.clearTimeout(timer); observer.disconnect(); controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [url, frame, background]);
  return state;
}
