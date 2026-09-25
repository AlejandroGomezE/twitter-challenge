import { useEffect, useRef } from 'react';

// Focus management for deleting a post from a list (the feed, a profile). The deleted card
// unmounts — and with it the delete dialog's return-focus target, the "…" button — so focus would
// drop to <body> and a keyboard user would lose their place. Instead, once the post has actually
// left the rendered list (after the dialog's focus trap is torn down), focus moves to the
// neighbouring post's link (the next post, else the previous one), or to the main content when
// none is left. Same approach as PostDetail's comments.
//
// `items` are the posts currently rendered; returns `handleDeleted(postId)` for PostCard's
// `onDeleted`.
export function usePostRemovalFocus(items) {
  // The deleted post still on screen, waiting to leave the list, and where focus goes then.
  const pendingRef = useRef(null);
  // The last committed items (updated in an effect, so it matches what's on screen).
  const renderedRef = useRef(undefined);

  useEffect(() => {
    renderedRef.current = items;
    const pending = pendingRef.current;
    if (!pending || !items || items.some((item) => item.id === pending.postId)) return;
    pendingRef.current = null;
    focusPostOrMain(pending.neighbourId);
  }, [items]);

  return function handleDeleted(postId) {
    const rendered = renderedRef.current ?? [];
    const index = rendered.findIndex((item) => item.id === postId);
    if (index === -1) {
      focusPostOrMain(null);
      return;
    }
    const neighbourId = (rendered[index + 1] ?? rendered[index - 1])?.id ?? null;
    pendingRef.current = { postId, neighbourId };
  };
}

function focusPostOrMain(postId) {
  const card = [...document.querySelectorAll('article[data-post-id]')].find(
    (article) => article.dataset.postId === postId,
  );
  const target = card?.querySelector('[data-post-link]') ?? document.getElementById('main-content');
  target?.focus();
}
