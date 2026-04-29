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
      window.addEventListener('DOMContentLoaded', function() {
        send('ui/initialize', {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'nodaro-mcp', version: '1.0.0' }
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

      window.NodaroMCP = {
        openLink: function(url) {
          notify('ui/message', {
            role: 'user',
            content: [{ type: 'text', text: 'Open ' + url + ' in a new tab.' }]
          });
        },
        useAsset: function(assetId, kind) {
          notify('ui/message', {
            role: 'user',
            content: [{ type: 'text', text: 'Use the ' + kind + ' with id ' + assetId + ' as a reference. The user clicked the Use button.' }]
          });
        },
        suggestTool: function(toolName, paramsHint) {
          notify('ui/message', {
            role: 'user',
            content: [{ type: 'text', text: 'Run ' + toolName + ' with these parameters: ' + JSON.stringify(paramsHint) }]
          });
        }
      };
    })();
  </script>`
}
