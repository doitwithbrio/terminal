# Rendering Ownership Runbook

## Summary

cmux has two independent content renderers that share the same window/split/workspace orchestration:

- Terminal panes render through `GhosttyTerminalView` and `TerminalWindowPortal`
- T3 panes render through `BrowserPanel` plus `T3CodeWebSupport`

Both can appear blank when selection, visibility, host ownership, and focus recovery get out of order during split churn or cross-window movement.

The invariants in this file are the ones that matter when debugging or editing these paths.

## Runtime Paths

### Terminal

- Surface creation and host claiming live in [GhosttyTerminalView.swift](/Users/tim/Desktop/terminal/Sources/GhosttyTerminalView.swift)
- Portal attach/detach/sync lives in [TerminalWindowPortal.swift](/Users/tim/Desktop/terminal/Sources/TerminalWindowPortal.swift)
- Panel activation/selection and visibility reconciliation live in [Workspace.swift](/Users/tim/Desktop/terminal/Sources/Workspace.swift)

### T3

- Live T3 opens as a chromeless `BrowserPanel` from [AppDelegate.swift](/Users/tim/Desktop/terminal/Sources/AppDelegate.swift)
- Host theme/runtime tagging support lives in [T3CodeWebSupport.swift](/Users/tim/Desktop/terminal/Sources/Panels/T3CodeWebSupport.swift)
- The only live editable asset tree is [Resources/t3code-server/client](/Users/tim/Desktop/terminal/Resources/t3code-server/client)
- The host-owned stylesheet is [cmux-ernest-theme.css](/Users/tim/Desktop/terminal/Resources/t3code-server/client/cmux-ernest-theme.css)

## Ownership Model

The important ownership states are:

- `detached`: the pane’s AppKit host exists but is not attached to a window yet
- `claiming`: a host is attempting to become the owner for a pane
- `bound`: the hosted view/web view is attached to the correct portal host in the correct window
- `visible`: the bound host is the one currently allowed to show content
- `focusable`: AppKit first responder can safely move into this bound host
- `stale`: an older host instance still exists but must not mutate visibility or focus

The critical rule is:

- **Selection is not readiness.**

Changing the selected tab/pane in the model must not hide the old visible host until the new host is actually `bound`.

## What “Host Ownership” Means

For terminals:

- one `GhosttySurfaceScrollView` must have exactly one owning portal host in one window
- stale same-pane hosts in other windows must not reclaim ownership once the visible host is bound
- a successful host transfer needs an immediate redraw even if the frame did not change

For BrowserPanel/T3:

- one `WKWebView` must be bound to the correct portal anchor in one window
- if a `WKWebView` is recreated, it must preserve the panel’s original script/chromeless contract
- T3 tagging is best-effort and must not decide whether the page is allowed to render

## Why Global Window Fallbacks Are Unsafe Here

These rendering paths must prefer:

1. the pane’s own window
2. the pane’s own workspace/context
3. the pane’s bound host window

They must not recover rendering through:

- `NSApp.keyWindow`
- `NSApp.mainWindow`
- global active `tabManager`

except for broad menu/command routing outside render ownership.

During reparenting, those global values can describe the wrong window for the pane that is actually trying to bind.

## T3 Theme/Tagging Rules

The T3 host theme is additive and fail-open:

- vendor T3 rendering is always a valid fallback
- the theme may be disabled panel-locally if the shell never mounts
- missing tags must degrade to vendor styling for that one element
- tagger failures must never blank the pane

Do not:

- edit `t3code-web`
- append custom CSS into compiled `assets/index-*.css`
- use broad minified utility-chain selectors as the primary control path
- treat generic text/buttons as proof that T3 mounted correctly

## Logs To Inspect

### Blank terminal / flicker / can’t type

Look for:

- `terminal.portal.host.claim`
- `terminal.portal.host.skip`
- `ws.hostState.deferApply`
- `ws.hostState.rebindOnUpdate`
- `ws.hostState.rebindOnGeometry`
- `portal.bind`
- `portal.sync.result`
- `portal.hostTransfer.*`
- `focus.surface.refresh`

Healthy transfer shape:

1. one valid claim
2. bind
3. immediate host-transfer refresh
4. no repeated host ping-pong

### Blank T3

Look for:

- `t3open.serverReady`
- `t3open.createPanel`
- `t3theme.verify`
- `t3theme.autodisable`
- `browser.webcontent.terminated`
- `browser.webview.replace.begin`
- `browser.webview.replace.end`

Healthy replacement shape:

1. replacement webview created
2. original scripts reapplied
3. shell markers found
4. no premature autodisable

### Focus misrouting

Look for:

- `focus.split.*`
- `focus.ensure.*`
- `focus.handoff.*`
- `shortcut.sync.*`

## What Not To Do

- Do not reintroduce `Resources/t3code-web`
- Do not use focus hacks as a substitute for redraw/bind readiness
- Do not hide the old visible host before the new host is bound
- Do not let T3’s tagger or theme observer participate in readiness decisions
- Do not broaden CSS ownership over generic `pre`, `code`, `button`, `svg`, `img`, or minified utility chains

## Safe Editing Checklist

1. If you touch terminal host claiming, verify stale-host suppression still exists.
2. If you touch portal bind/rebind, preserve the immediate redraw-on-transfer invariant.
3. If you touch selection logic, verify deselected hosts are only hidden after selected host readiness.
4. If you touch BrowserPanel replacement, verify initial scripts and chromeless state survive recreation.
5. If you touch T3 theming, verify the page still renders with theme disabled.
6. If you touch logs, keep them DEBUG-only and make sure they identify pane, host, and window.
