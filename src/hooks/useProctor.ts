import { useState, useEffect } from 'react'
type ScreenSet = {
  screens: unknown[]
  addEventListener: (s: string, f: () => void) => void
  removeEventListener: (s: string, f: () => void) => void
}
export function useProctor(
  active: boolean,
  required: boolean,
  log: (type: string, meta?: Record<string, unknown>) => void,
) {
  const [full, F] = useState(!!document.fullscreenElement)
  useEffect(() => {
    if (!active) return
    const off: (() => void)[] = [],
      last = new Map<string, number>()
    let blur: ReturnType<typeof setTimeout> | undefined,
      away = false,
      alive = true,
      screenSet: ScreenSet | undefined
    function on(target: EventTarget, name: string, fn: EventListener) {
      target.addEventListener(name, fn, true)
      off.push(() => target.removeEventListener(name, fn, true))
    }
    function record(type: string, detail: string) {
      const now = Date.now()
      if (now - (last.get(type + detail) || 0) < 800) return
      last.set(type + detail, now)
      log(type, { detail, observed_at: new Date(now).toISOString() })
    }
    function leave(kind: string) {
      if (!away) {
        away = true
        record(kind, 'Focus left examination')
      }
    }
    on(document, 'visibilitychange', () => {
      if (document.hidden) {
        clearTimeout(blur)
        leave('tab_switch')
      } else if (document.hasFocus()) away = false
    })
    on(window, 'blur', () => {
      clearTimeout(blur)
      blur = setTimeout(
        () => leave(document.hidden ? 'tab_switch' : 'window_blur'),
        220,
      )
    })
    on(window, 'focus', () => {
      clearTimeout(blur)
      if (!document.hidden) away = false
    })
    on(document, 'fullscreenchange', () => {
      const yes = !!document.fullscreenElement
      F(yes)
      if (!yes && required) record('fullscreen_exit', 'Fullscreen ended')
    })
    for (const name of ['copy', 'cut', 'paste', 'contextmenu'])
      on(document, name, (e) => {
        e.preventDefault()
        record(name === 'contextmenu' ? 'right_click' : 'copy_paste', name)
      })
    on(document, 'keydown', (e) => {
      const k = e as KeyboardEvent,
        key = k.key.toLowerCase(),
        ctrl = k.ctrlKey || k.metaKey
      if (
        key === 'f12' ||
        (ctrl && k.shiftKey && ['i', 'j', 'c'].includes(key)) ||
        (ctrl && key === 'u')
      ) {
        e.preventDefault()
        record('devtools', 'Observed shortcut ' + k.key)
      } else if (key === 'printscreen') {
        record('copy_paste', 'PrintScreen key')
      } else if (k.altKey && key === 'tab') {
        leave('window_blur')
      }
    })
    on(document, 'keyup', (e) => {
      if ((e as KeyboardEvent).key === 'PrintScreen')
        record('copy_paste', 'PrintScreen key')
    })
    const extended = () =>
      Boolean((window.screen as Screen & { isExtended?: boolean }).isExtended)
    let multi = false
    function observe(value: boolean) {
      if (!alive) return
      if (value && !multi) record('multi_display', 'Multiple displays reported')
      multi = value
    }
    const detected = sessionStorage.getItem('cbt-multi') === 'true'
    sessionStorage.removeItem('cbt-multi')
    observe(detected || extended())
    if (window.screen instanceof EventTarget)
      on(window.screen, 'change', () => observe(extended()))
    void (async () => {
      try {
        const permission = await navigator.permissions.query({
          name: 'window-management' as PermissionName,
        })
        const get = (
          window as Window & { getScreenDetails?: () => Promise<ScreenSet> }
        ).getScreenDetails
        if (permission.state === 'granted' && get) {
          const set = await get.call(window)
          if (!alive) return
          screenSet = set
          const update = () => observe(set.screens.length > 1)
          update()
          set.addEventListener('screenschange', update)
          off.push(() => set.removeEventListener('screenschange', update))
        }
      } catch {
        /* Display reporting is optional. */
      }
    })()
    return () => {
      alive = false
      clearTimeout(blur)
      off.forEach((f) => f())
      screenSet = undefined
    }
  }, [active, required, log])
  return active && required && !full
}
