/**
 * Returns inline JS implementing the MCP UI client protocol over
 * window.parent.postMessage. Loaded inline in every widget HTML.
 *
 * Wire format reference (extracted from [redacted-reference]'s production bundle, see
 * specs/superpowers/oss-readiness/06-mcp-server.md A2):
 *   ui/initialize: widget → host on iframe load
 *   ui/message: widget → host with {role: "user", content: [...]} for actions
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
        if (data.id && pending.has(data.id)) {
          var p = pending.get(data.id);
          pending.delete(data.id);
          if (data.error) p.reject(new Error(data.error.message || 'ui error'));
          else p.resolve(data.result);
          return;
        }
        if (data.method === 'ui/message' && data.params) {
          window.dispatchEvent(new CustomEvent('mcp-ui-message', { detail: data.params }));
        }
        if (data.method === 'notifications/progress' && data.params) {
          window.dispatchEvent(new CustomEvent('mcp-progress', { detail: data.params }));
        }
      });

      window.addEventListener('DOMContentLoaded', function() {
        send('ui/initialize', {
          appInfo: { name: 'nodaro-mcp', version: '1.0.0' },
          appCapabilities: { tools: { listChanged: false }, experimental: {} },
          protocolVersion: '2025-11-21'
        }).catch(function(err) { console.warn('ui/initialize failed:', err); });
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
