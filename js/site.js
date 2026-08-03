// Triarchs of Olympus — shared site behaviour (nav, atmosphere, reveal-on-scroll)
(function () {
  "use strict";

  document.documentElement.classList.remove("no-js");
  document.documentElement.classList.add("js");

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------- hero champion carousel ---------------- */
  var heroCarousel = document.querySelector(".hero-carousel");
  if (heroCarousel && !reduceMotion) {
    var heroTrack = heroCarousel.querySelector(".hero-band-track");
    var heroBand = heroTrack && heroTrack.querySelector(".hero-band-art");
    if (heroTrack && heroBand) {
      // A matching second set makes the CSS marquee loop without a visible
      // jump when the first set has completely crossed the viewport.
      var duplicateBand = heroBand.cloneNode(true);
      duplicateBand.setAttribute("aria-hidden", "true");
      duplicateBand.querySelectorAll(".bust-popover").forEach(function (popover) {
        popover.remove();
      });
      duplicateBand.querySelectorAll(".bust-trigger").forEach(function (trigger) {
        trigger.setAttribute("tabindex", "-1");
        trigger.removeAttribute("aria-controls");
        trigger.removeAttribute("aria-haspopup");
        trigger.removeAttribute("aria-expanded");
      });
      heroTrack.appendChild(duplicateBand);
      heroCarousel.classList.add("is-ready");
    }
  }

  /* ---------------- nav dropdowns (World / Account / Download) ---------------- */
  var navDrops = document.querySelectorAll(".nav-drop");
  function closeNavDrops(except) {
    navDrops.forEach(function (drop) {
      if (drop === except) return;
      drop.classList.remove("open");
      var t = drop.querySelector(".nav-drop-toggle");
      if (t) t.setAttribute("aria-expanded", "false");
    });
  }
  if (navDrops.length) {
    navDrops.forEach(function (drop) {
      var dropToggle = drop.querySelector(".nav-drop-toggle");
      if (!dropToggle) return;
      dropToggle.addEventListener("click", function () {
        var isOpen = drop.classList.contains("open");
        closeNavDrops(drop);
        drop.classList.toggle("open", !isOpen);
        dropToggle.setAttribute("aria-expanded", String(!isOpen));
      });
      drop.addEventListener("focusout", function (e) {
        if (!drop.contains(e.relatedTarget)) {
          drop.classList.remove("open");
          dropToggle.setAttribute("aria-expanded", "false");
        }
      });
    });
    document.addEventListener("click", function (e) {
      navDrops.forEach(function (drop) {
        if (!drop.contains(e.target)) {
          drop.classList.remove("open");
          var t = drop.querySelector(".nav-drop-toggle");
          if (t) t.setAttribute("aria-expanded", "false");
        }
      });
    });
  }

  /* ---------------- mobile nav toggle ---------------- */
  var toggle = document.querySelector(".nav-toggle");
  var links = document.querySelector(".nav-links");
  if (toggle && links) {
    toggle.addEventListener("click", function () {
      var open = links.classList.toggle("open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      if (!open) closeNavDrops(null);
    });
    links.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () {
        links.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
        closeNavDrops(null);
      });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      var openDrop = document.querySelector(".nav-drop.open");
      if (openDrop) {
        closeNavDrops(null);
        var t = openDrop.querySelector(".nav-drop-toggle");
        if (t) t.focus();
      } else if (links.classList.contains("open")) {
        links.classList.remove("open");
        toggle.setAttribute("aria-expanded", "false");
        toggle.focus();
      }
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
      var closeBtn = pop ? pop.querySelector(".dp-close") : null;
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
