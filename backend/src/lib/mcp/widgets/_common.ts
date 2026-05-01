/**
 * Returns inline JS implementing the MCP UI client protocol over
 * window.parent.postMessage. Loaded inline in every widget HTML.
 *
 * Wire format per the canonical MCP Apps spec (SEP-1865):
 *   ui/initialize          — widget → host on iframe load (handshake)
 *   ui/notifications/initialized      — widget → host (post-init)
 *   ui/notifications/tool-input       — host → widget (tool args, before run)
 *   ui/notifications/tool-input-partial — host → widget (streaming args)
 *   ui/notifications/tool-result      — host → widget (full tool result)
 *   ui/notifications/tool-cancelled   — host → widget (run cancelled)
 *   ui/notifications/host-context-changed — host → widget (theme/locale)
 *   ui/message             — widget → host (push content into chat input)
 *   notifications/progress — host → widget (progress updates)
 *
 * The shim re-emits inbound notifications as DOM CustomEvents so individual
 * widget scripts can hook in without re-parsing the postMessage envelope.
 */
export function uiProtocolShim(): string {
  return `<script>
    (function() {
      'use strict';
      var nextId = 1;
      var pending = new Map();

      function send(method, params) {
        var id = nextId++;
        return new Promise(function(resolve, reject) {
          pending.set(id, { resolve: resolve, reject: reject });
          window.parent.postMessage({ jsonrpc: '2.0', id: id, method: method, params: params }, '*');
          setTimeout(function() {
            if (pending.has(id)) { pending.delete(id); reject(new Error('ui/* timeout')); }
          }, 30000);
        });
      }

      function notify(method, params) {
        window.parent.postMessage({ jsonrpc: '2.0', method: method, params: params }, '*');
      }

      window.addEventListener('message', function(e) {
        var data = e.data;
        if (!data || data.jsonrpc !== '2.0') return;
        if (typeof data.id !== 'undefined' && pending.has(data.id)) {
          var p = pending.get(data.id);
          pending.delete(data.id);
          if (data.error) p.reject(new Error(data.error.message || 'ui error'));
          else p.resolve(data.result);
          return;
        }
        if (!data.method) return;
        // Re-emit known MCP Apps host notifications as DOM CustomEvents.
        var eventMap = {
          'ui/notifications/tool-input':         'mcp-tool-input',
          'ui/notifications/tool-input-partial': 'mcp-tool-input-partial',
          'ui/notifications/tool-result':        'mcp-tool-result',
          'ui/notifications/tool-cancelled':     'mcp-tool-cancelled',
          'ui/notifications/host-context-changed': 'mcp-host-context-changed',
          'ui/message':                          'mcp-ui-message',
          'notifications/progress':              'mcp-progress'
        };
        var eventName = eventMap[data.method];
        if (eventName) {
          window.dispatchEvent(new CustomEvent(eventName, { detail: data.params || {} }));
        }
      });

      // Lifecycle: ui/initialize → ui/notifications/initialized.
      // Per SEP-1865 the host responds to ui/initialize with {hostContext},
      // then we MUST send the initialized notification before any further
      // requests. tool-input/tool-result notifications follow.
      //
      // Field names: spec requires "appCapabilities" + "appInfo" (NOT
      // "capabilities" + "clientInfo" — that's the standard MCP initialize
      // shape, but the ui/initialize handshake uses Apps-specific names).
      // Mismatch causes Claude.ai web to reject the handshake silently and
      // tear the iframe down before tool-result arrives.
      window.addEventListener('DOMContentLoaded', function() {
        send('ui/initialize', {
          // Stable spec version (matches the canonical MCP Apps examples).
          // Older 2025-* versions cause Claude.ai web to drop the handshake.
          protocolVersion: '2026-01-26',
          // Only declare what we actually support. We do NOT expose app-side
          // tools (the iframe doesn't register any), so omit "tools" —
          // declaring an empty/false tools.listChanged confused some hosts
          // into expecting an app->host tools/list response that never arrives.
          appCapabilities: {
            availableDisplayModes: ['inline', 'fullscreen']
          },
          appInfo: { name: 'nodaro-mcp', version: '1.0.0' }
        }).then(function(result) {
          window.__MCP_HOST_CONTEXT__ = (result && result.hostContext) || {};
          notify('ui/notifications/initialized', {});
          window.dispatchEvent(new CustomEvent('mcp-ready', { detail: window.__MCP_HOST_CONTEXT__ }));
        }).catch(function(err) {
          console.warn('ui/initialize failed (probably standalone):', err && err.message);
          // Still emit mcp-ready so widgets render in standalone mode.
          window.dispatchEvent(new CustomEvent('mcp-ready', { detail: {} }));
        });
      });

      // Auto-resize: emit ui/notifications/size-changed whenever the body
      // height changes so the host can grow the iframe to fit content.
      // Without this Claude.ai uses a default small height and the image
      // preview renders cramped.
      function emitSize() {
        var h = document.documentElement.scrollHeight || document.body.scrollHeight || 0;
        var w = document.documentElement.scrollWidth || document.body.scrollWidth || 0;
        if (h > 0) notify('ui/notifications/size-changed', { width: w, height: h });
      }
      var lastEmittedHeight = 0;
      function maybeEmitSize() {
        var h = document.documentElement.scrollHeight || document.body.scrollHeight || 0;
        // Emit on ANY real size change. ResizeObserver only fires on actual
        // dimension changes so we won't spam — but the previous 8 px
        // threshold swallowed the small 1–7 px growth that happens when
        // an <img> finishes decoding, leaving the iframe a few pixels too
        // short and producing a thin scrollbar.
        if (h !== lastEmittedHeight) {
          lastEmittedHeight = h;
          emitSize();
        }
      }
      window.addEventListener('mcp-ready', function() {
        // Initial size after handshake completes.
        setTimeout(maybeEmitSize, 0);
      });
      // ResizeObserver fires on any element growth (image loads, dynamic
      // appends). Falls back to load+interval for ancient browsers.
      try {
        var ro = new ResizeObserver(maybeEmitSize);
        document.addEventListener('DOMContentLoaded', function() {
          ro.observe(document.body);
        });
      } catch (_) {
        window.addEventListener('load', maybeEmitSize);
        setInterval(maybeEmitSize, 1000);
      }
      // Image/video element load events bump the height when media decodes.
      window.addEventListener('load', maybeEmitSize, true);

      window.NodaroMCP = {
        // Ask the host to switch the iframe display mode. Per MCP Apps spec
        // (SEP-1865), the ui/request-display-mode method with
        // mode="fullscreen" tells the host to expand the widget. The host
        // returns the actual mode it ended up applying.
        requestDisplayMode: function(mode) {
          return send('ui/request-display-mode', { mode: mode }).catch(function(err) {
            console.warn('[NodaroMCP.requestDisplayMode] host rejected:', err && err.message);
            return null;
          });
        },
        openLink: function(url) {
          // ui/open-link is a host REQUEST per the MCP Apps spec — returns
          // {isError} so we can detect when the host doesn't honor it.
          // Previously we sent a ui/message notification which Claude.ai
          // rendered as a plain text user message instead of opening the
          // tab.
          send('ui/open-link', { url: url }).catch(function(err) {
            console.warn('[NodaroMCP.openLink] host rejected open-link:', err && err.message);
          });
        },
        // ── ui/message ──
        // CRITICAL: Use send (JSON-RPC request) NOT notify. Per the
        // MCP Apps spec, ui/message is a host REQUEST — the widget asks
        // the host to inject the content into chat input, and the host
        // returns success/failure. Claude.ai only honors the request
        // form; notifications get silently dropped (which is why the
        // Animate / Edit / Recreate buttons appeared to do nothing
        // before — the messages went out as notifications and Claude.ai
        // ignored them).
        useAsset: function(assetId, kind) {
          send('ui/message', {
            role: 'user',
            content: [{ type: 'text', text: 'Use the ' + kind + ' with id ' + assetId + ' as a reference. The user clicked the Use button.' }]
          }).catch(function(err) {
            console.warn('[NodaroMCP.useAsset] host rejected ui/message:', err && err.message);
          });
        },
        suggestTool: function(toolName, paramsHint) {
          send('ui/message', {
            role: 'user',
            content: [{ type: 'text', text: 'Run ' + toolName + ' with these parameters: ' + JSON.stringify(paramsHint) }]
          }).catch(function(err) {
            console.warn('[NodaroMCP.suggestTool] host rejected ui/message:', err && err.message);
          });
        },
        // Push text into chat as a fresh user message (used by the Recreate
        // button and the form-trigger paths). The host treats it as a new
        // turn and the assistant re-derives which tool to call. Bypasses
        // the "Run X with these parameters" wrapper used by suggestTool,
        // which is too explicit for a recreate / open-ended flow.
        pushUserMessage: function(text) {
          send('ui/message', {
            role: 'user',
            content: [{ type: 'text', text: text }]
          }).catch(function(err) {
            console.warn('[NodaroMCP.pushUserMessage] host rejected ui/message:', err && err.message);
          });
        }
      };
    })();
  </script>`
}
