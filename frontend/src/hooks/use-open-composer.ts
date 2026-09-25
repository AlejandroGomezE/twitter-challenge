import { useCallback } from 'react'
import { useLocation, useNavigate } from 'react-router'
import { FOCUS_COMPOSER_STATE, focusComposer } from '@/lib/composer-focus'

// The "New post" action (left rail button, mobile compose button): on Home it focuses the composer
// right away; elsewhere it navigates to `/` with `FOCUS_COMPOSER_STATE`, and Home focuses the
// composer once it has rendered (then clears that state, so a reload or Back doesn't refocus).
export function useOpenComposer() {
  const navigate = useNavigate()
  const { pathname } = useLocation()

  return useCallback(() => {
    if (pathname === '/' && focusComposer()) return
    navigate('/', { state: FOCUS_COMPOSER_STATE })
  }, [navigate, pathname])
}
