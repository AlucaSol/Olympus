// Triarchs of Olympus — shared site behaviour (nav, download popover, atmosphere, reveal-on-scroll)
(function () {
  "use strict";

  document.documentElement.classList.remove("no-js");
  document.documentElement.classList.add("js");

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------- mobile nav toggle ---------------- */
  var toggle = document.querySelector(".nav-toggle");
  var links = document.querySelector(".nav-links");
  if (toggle && links) {
    toggle.addEventListener("click", function () {
      var open = links.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
    });
    links.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () {
        links.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
      });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && links.classList.contains("open")) {
        links.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.focus();
      }
    });
  }

  /* ---------------- download placeholder popover ---------------- */
  var dlBtn = document.getElementById("download-trigger");
  var dlPop = document.getElementById("download-popover");
  if (dlBtn && dlPop) {
    var closeBtn = dlPop.querySelector(".dp-close");

    function openPop() {
      dlPop.hidden = false;
      dlBtn.setAttribute("aria-expanded", "true");
      if (closeBtn) closeBtn.focus();
    }
    function closePop(returnFocus) {
      dlPop.hidden = true;
      dlBtn.setAttribute("aria-expanded", "false");
      if (returnFocus) dlBtn.focus();
    }
    dlBtn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (dlPop.hidden) openPop(); else closePop(false);
    });
    if (closeBtn) closeBtn.addEventListener("click", function () { closePop(true); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !dlPop.hidden) closePop(true);
    });
    document.addEventListener("click", function (e) {
      if (!dlPop.hidden && !dlPop.contains(e.target) && e.target !== dlBtn) closePop(false);
    });
  }

  /* ---------------- hero bust name popovers ---------------- */
  var bustWraps = document.querySelectorAll(".bust-wrap");
  if (bustWraps.length) {
    var openBustWrap = null;

    function closeBustPop(returnFocus) {
      if (!openBustWrap) return;
      var wrap = openBustWrap;
      var trigger = wrap.querySelector(".bust-trigger");
      var pop = wrap.querySelector(".bust-popover");
      pop.hidden = true;
      trigger.setAttribute("aria-expanded", "false");
      openBustWrap = null;
      if (returnFocus) trigger.focus();
    }

    bustWraps.forEach(function (wrap) {
      var trigger = wrap.querySelector(".bust-trigger");
      var pop = wrap.querySelector(".bust-popover");
      var closeBtn = pop.querySelector(".dp-close");
      if (!trigger || !pop) return;

      trigger.addEventListener("click", function (e) {
        e.stopPropagation();
        var wasOpen = openBustWrap === wrap;
        closeBustPop(false);
        if (!wasOpen) {
          pop.hidden = false;
          trigger.setAttribute("aria-expanded", "true");
          openBustWrap = wrap;
          if (closeBtn) closeBtn.focus();
        }
      });
      if (closeBtn) closeBtn.addEventListener("click", function () { closeBustPop(true); });
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && openBustWrap) closeBustPop(true);
    });
    document.addEventListener("click", function (e) {
      if (openBustWrap && !openBustWrap.contains(e.target)) closeBustPop(false);
    });
  }

  /* ---------------- ember particles (atmosphere) ---------------- */
  if (!reduceMotion) {
    document.querySelectorAll(".atmosphere[data-embers]").forEach(function (layer) {
      var count = parseInt(layer.getAttribute("data-embers"), 10) || 0;
      for (var i = 0; i < count; i++) {
        var e = document.createElement("span");
        e.className = "ember";
        e.style.left = (Math.random() * 100) + "%";
        e.style.setProperty("--drift", (Math.random() * 80 - 40) + "px");
        e.style.animationDelay = (Math.random() * 9) + "s";
        e.style.animationDuration = (7 + Math.random() * 6) + "s";
        layer.appendChild(e);
      }
    });
  }

  /* ---------------- reveal-on-scroll ---------------- */
  var revealEls = document.querySelectorAll(".reveal");
  if (revealEls.length) {
    if ("IntersectionObserver" in window && !reduceMotion) {
      var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("in-view");
            io.unobserve(entry.target);
          }
        });
      }, { threshold: 0.15 });
      revealEls.forEach(function (el) { io.observe(el); });
    } else {
      revealEls.forEach(function (el) { el.classList.add("in-view"); });
    }
  }
})();
