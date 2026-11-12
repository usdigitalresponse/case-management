// Placed after a batched list (../hooks/useBatchedResource.ts): loads the next
// batch as it nears the screen. After a failure it waits to be scrolled to again.
import { useEffect, useRef } from 'react';
import type { BatchedList } from '../hooks/useBatchedResource';

type Loading = Pick<BatchedList<unknown, unknown>, 'more' | 'loadingMore' | 'moreFailed' | 'loadMore'>;

export function MoreOnScroll({ list, what }: { list: Loading; what: string }) {
  const marker = useRef<HTMLDivElement>(null);
  const { more, moreFailed, loadMore } = list;
  useEffect(() => {
    const element = marker.current;
    if (!element || !more) return undefined;
    // Out of view once since failing, so coming back is a new scroll.
    let armed = !moreFailed;
    const observer = new IntersectionObserver(
      (entries) => {
        const near = entries.some((entry) => entry.isIntersecting);
        if (near && armed) loadMore();
        if (!near) armed = true;
      },
      { rootMargin: '600px 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [more, moreFailed, loadMore]);
  return (
    <div ref={marker} className="more-on-scroll" role="status">
      {list.loadingMore ? `Loading more ${what}…` : list.moreFailed ? `More ${what} couldn’t be loaded. Scroll down again to try again.` : ''}
    </div>
  );
}
