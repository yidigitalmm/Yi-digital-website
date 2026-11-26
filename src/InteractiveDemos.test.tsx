import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BrowserRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { InteractiveDemos } from './InteractiveDemos';

const reduced = vi.hoisted(() => ({ value: false }));
vi.mock('motion/react', () => ({ useReducedMotion: () => reduced.value }));

describe('interactive transformation', () => {
  beforeEach(() => { reduced.value = false; });
  it('seeks the tea journey from slider input and resets it', async () => {
    const { container } = render(<BrowserRouter><InteractiveDemos locale="en"/></BrowserRouter>);
    let video = container.querySelector('video')!;
    Object.defineProperty(video, 'duration', { configurable:true, value:10 });
    fireEvent.loadedMetadata(video);
    expect(video.currentTime).toBe(0);
    expect(video).toHaveAttribute('src', '/videos/start-end/tea-journey.mp4');
    fireEvent.change(screen.getByRole('slider'), { target:{ value:'80' } });
    expect(video.currentTime).toBe(8);
    await userEvent.click(screen.getByRole('button', { name:'Reset' }));
    expect(video.currentTime).toBe(0);
  });
  it('captures wheel input only inside the frame, supports reverse and leaves zoom alone', async () => {
    const { container } = render(<BrowserRouter><InteractiveDemos locale="en"/></BrowserRouter>);
    const video = container.querySelector('video')!;
    Object.defineProperty(video, 'duration', { configurable:true, value:66 });
    fireEvent.loadedMetadata(video);
    const stage = container.querySelector('.demo-stage')!;
    const wheel = (target: Element | Window, deltaY: number, extra = {}) => {
      const event = new WheelEvent('wheel', { bubbles:true, cancelable:true, deltaY, ...extra });
      fireEvent(target, event);
      return event;
    };
    expect(wheel(stage, 810).defaultPrevented).toBe(true);
    expect(screen.getByRole('slider')).toHaveValue('10');
    expect(wheel(window, 810).defaultPrevented).toBe(false);
    fireEvent.scroll(window);
    expect(screen.getByRole('slider')).toHaveValue('10');
    expect(wheel(stage, 810, { ctrlKey:true }).defaultPrevented).toBe(false);
    expect(screen.getByRole('slider')).toHaveValue('10');
    wheel(stage, -405);
    expect(screen.getByRole('slider')).toHaveValue('5');
    wheel(stage, 81000);
    expect(screen.getByRole('slider')).toHaveValue('100');
    expect(video.currentTime).toBeLessThan(66);
    expect(wheel(stage, 810).defaultPrevented).toBe(false);
    expect(wheel(stage, -810).defaultPrevented).toBe(true);
    expect(screen.getByRole('slider')).toHaveValue('90');
    wheel(stage, -81000);
    expect(wheel(stage, -810).defaultPrevented).toBe(false);
    expect(screen.getByRole('slider')).toHaveValue('0');

  });

  it('leaves wheel scrolling native when reduced motion is enabled', () => {
    reduced.value = true;
    const { container } = render(<BrowserRouter><InteractiveDemos locale="en"/></BrowserRouter>);
    const video = container.querySelector('video')!;
    Object.defineProperty(video, 'duration', { configurable:true, value:66 });
    fireEvent.loadedMetadata(video);
    const event = new WheelEvent('wheel', { bubbles:true, cancelable:true, deltaY:810 });
    fireEvent(container.querySelector('.demo-stage')!, event);
    expect(event.defaultPrevented).toBe(false);
    expect(screen.getByRole('slider')).toHaveValue('0');
  });

});
