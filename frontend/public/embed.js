/**
 * Nodaro Embed Script
 *
 * Usage:
 *   <div id="nodaro-app"></div>
 *   <script src="https://app.nodaro.ai/embed.js"
 *     data-slug="my-app"
 *     data-target="nodaro-app"
 *     data-theme="dark"
 *     data-height="600px">
 *   </script>
 *
 * Or create programmatically:
 *   NodaroEmbed.create({ slug: "my-app", target: "#container", theme: "dark" })
 */
(function () {
  "use strict";

  var EMBED_ORIGIN = (function () {
    var scripts = document.getElementsByTagName("script");
    for (var i = scripts.length - 1; i >= 0; i--) {
      var src = scripts[i].src || "";
      if (src.indexOf("embed.js") !== -1) {
        return new URL(src).origin;
      }
    }
    return "https://app.nodaro.ai";
  })();

  function create(opts) {
    var slug = opts.slug;
    var target = opts.target;
    var theme = opts.theme || "dark";
    var height = opts.height || "600px";
    var width = opts.width || "100%";

    if (!slug) {
      console.error("[Nodaro] data-slug is required");
      return null;
    }

    var container =
      typeof target === "string"
        ? document.getElementById(target) || document.querySelector(target)
        : target;

    if (!container) {
      console.error("[Nodaro] target element not found:", target);
      return null;
    }

    var iframe = document.createElement("iframe");
    iframe.src = EMBED_ORIGIN + "/embed/" + encodeURIComponent(slug) + "?theme=" + theme;
    iframe.style.width = width;
    iframe.style.height = height;
    iframe.style.border = "none";
    iframe.style.borderRadius = "8px";
    iframe.style.colorScheme = "normal";
    iframe.setAttribute("allowfullscreen", "");
    iframe.setAttribute("allow", "clipboard-write");

    container.appendChild(iframe);

    // Forward wheel and touch scroll events from iframe so the parent page scrolls normally
    window.addEventListener("message", function (event) {
      if (event.origin !== EMBED_ORIGIN) return;
      var data = event.data;
      if (!data) return;
      if (data.type === "nodaro:wheel" || data.type === "nodaro:touch") {
        window.scrollBy({ left: data.deltaX, top: data.deltaY });
      }
    });

    return iframe;
  }

  // Auto-init from script tag attributes
  var currentScript =
    document.currentScript ||
    (function () {
      var scripts = document.getElementsByTagName("script");
      return scripts[scripts.length - 1];
    })();

  var slug = currentScript.getAttribute("data-slug");
  if (slug) {
    var targetId = currentScript.getAttribute("data-target");
    // If no target specified, insert after the script tag
    var target;
    if (targetId) {
      target = document.getElementById(targetId) || document.querySelector(targetId);
    }
    if (!target) {
      target = document.createElement("div");
      currentScript.parentNode.insertBefore(target, currentScript.nextSibling);
    }

    // Wait for DOM ready
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", function () {
        create({
          slug: slug,
          target: target,
          theme: currentScript.getAttribute("data-theme") || "dark",
          height: currentScript.getAttribute("data-height") || "600px",
          width: currentScript.getAttribute("data-width") || "100%",
        });
      });
    } else {
      create({
        slug: slug,
        target: target,
        theme: currentScript.getAttribute("data-theme") || "dark",
        height: currentScript.getAttribute("data-height") || "600px",
        width: currentScript.getAttribute("data-width") || "100%",
      });
    }
  }

  // Expose global API
  window.NodaroEmbed = { create: create, EMBED_ORIGIN: EMBED_ORIGIN };
})();
