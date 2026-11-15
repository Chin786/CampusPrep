export function candidateReturnPath(value: string | null): string {
  if (!value) return '/'
  try {
    const u = new URL(value, window.location.origin)
    if (u.origin !== window.location.origin) return '/'
    if (!/^\/(instructions|exam|result)\/[\da-f-]{36}$/i.test(u.pathname))
      return '/'
    return u.pathname + u.search
  } catch {
    return '/'
  }
}
