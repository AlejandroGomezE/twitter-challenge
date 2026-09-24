// Where to send a user once they are signed in: the page ProtectedRoute bounced them from
// (`location.state.from`), when it is an in-app path (a single leading slash — never `//host` or
// `/\host`, which browsers treat as protocol-relative and would leave the app), else home.
export function getRedirectTarget(from) {
  const pathname = from?.pathname
  if (
    typeof pathname !== 'string' ||
    !pathname.startsWith('/') ||
    pathname.startsWith('//') ||
    pathname.startsWith('/\\')
  ) {
    return '/'
  }
  return `${pathname}${from.search ?? ''}`
}
