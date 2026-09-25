// The Home composer's textarea id, so "New post" buttons (left rail, mobile compose button) can
// focus it without holding a ref across the shell.
export const COMPOSER_TEXTAREA_ID = 'composer'

// Router state that asks Home to focus the composer once it has rendered (see `useOpenComposer`).
export const FOCUS_COMPOSER_STATE = { focusComposer: true }

// Focuses the composer if it's on the page (and brings it into view). Returns whether it was found.
export function focusComposer() {
  const textarea = document.getElementById(COMPOSER_TEXTAREA_ID)
  if (!textarea) return false
  textarea.focus({ preventScroll: true })
  textarea.scrollIntoView?.({ block: 'center' })
  return true
}
