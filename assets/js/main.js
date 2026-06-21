/**
 * Averixor Cloud — progressive enhancements.
 * The site remains usable without JavaScript.
 */

(() => {
  'use strict';

  const year = document.getElementById('year');
  if (year) {
    year.textContent = String(new Date().getFullYear());
  }

  const header = document.querySelector('[data-header]');
  const nav = document.querySelector('[data-nav]');
  const toggle = document.querySelector('[data-nav-toggle]');
  const navLinks = Array.from(document.querySelectorAll('.nav-list a[href^="#"]'));
  const sections = Array.from(document.querySelectorAll('main section[id]'));
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  const getScrollBehavior = () => (
    prefersReducedMotion.matches ? 'auto' : 'smooth'
  );

  const scrollToTarget = (target, updateHash = true) => {
    if (!target) return;

    const headerHeight = header ? header.offsetHeight : 0;
    const top = target.getBoundingClientRect().top + window.scrollY - headerHeight - 18;

    window.scrollTo({ top: Math.max(0, top), behavior: getScrollBehavior() });

    if (updateHash) {
      const hash = `#${target.id}`;
      if (location.hash !== hash) {
        history.pushState(null, '', hash);
      }
    }
  };

  const setMenuState = (isOpen) => {
    if (!nav || !toggle) return;

    toggle.setAttribute('aria-expanded', String(isOpen));
    toggle.querySelector('.sr-only').textContent = isOpen ? 'Закрити меню' : 'Відкрити меню';
    nav.classList.toggle('is-open', isOpen);
    document.body.classList.toggle('nav-open', isOpen);

    if (!isOpen) {
      document.querySelectorAll('.nav-dropdown.is-open').forEach((dropdown) => {
        dropdown.classList.remove('is-open');
        const btn = dropdown.previousElementSibling;
        if (btn) btn.setAttribute('aria-expanded', 'false');
      });
    }
  };

  if (nav && toggle) {
    toggle.addEventListener('click', () => {
      setMenuState(toggle.getAttribute('aria-expanded') !== 'true');
    });

    nav.addEventListener('click', (event) => {
      const target = event.target.closest('a');
      if (target && !target.classList.contains('nav-dropdown-toggle')) {
        setMenuState(false);
      }
    });

    document.addEventListener('click', (event) => {
      if (!nav.classList.contains('is-open')) return;
      if (nav.contains(event.target) || toggle.contains(event.target)) return;
      setMenuState(false);
    });

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;

      if (nav.classList.contains('is-open')) {
        setMenuState(false);
        toggle.focus();
        return;
      }

      document.querySelectorAll('.nav-dropdown.is-open').forEach((dropdown) => {
        dropdown.classList.remove('is-open');
        const btn = dropdown.previousElementSibling;
        if (btn) {
          btn.setAttribute('aria-expanded', 'false');
          btn.focus();
        }
      });
    });

    const media = window.matchMedia('(min-width: 821px)');
    const closeOnDesktop = () => {
      if (media.matches) setMenuState(false);
    };

    if (typeof media.addEventListener === 'function') {
      media.addEventListener('change', closeOnDesktop);
    } else if (typeof media.addListener === 'function') {
      media.addListener(closeOnDesktop);
    }
  }

  document.querySelectorAll('[data-dropdown-toggle]').forEach((button) => {
    const dropdown = button.nextElementSibling;
    if (!dropdown || !dropdown.classList.contains('nav-dropdown')) return;

    button.addEventListener('click', (event) => {
      event.stopPropagation();
      const isOpen = button.getAttribute('aria-expanded') === 'true';

      document.querySelectorAll('[data-dropdown-toggle]').forEach((other) => {
        if (other === button) return;
        other.setAttribute('aria-expanded', 'false');
        const otherMenu = other.nextElementSibling;
        if (otherMenu) otherMenu.classList.remove('is-open');
      });

      button.setAttribute('aria-expanded', String(!isOpen));
      dropdown.classList.toggle('is-open', !isOpen);
    });
  });

  document.addEventListener('click', (event) => {
    if (event.target.closest('[data-dropdown-toggle]') || event.target.closest('.nav-dropdown')) return;

    document.querySelectorAll('[data-dropdown-toggle]').forEach((button) => {
      button.setAttribute('aria-expanded', 'false');
      const dropdown = button.nextElementSibling;
      if (dropdown) dropdown.classList.remove('is-open');
    });
  });

  document.addEventListener('click', (event) => {
    const link = event.target.closest('a[href^="#"]');
    if (!link) return;
    if (event.defaultPrevented) return;
    if (event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const href = link.getAttribute('href');
    if (!href || href === '#') return;

    const target = document.querySelector(href);
    if (!target) return;

    event.preventDefault();
    scrollToTarget(target);
  });

  const scrollToInitialHash = () => {
    const { hash } = location;
    if (!hash || hash === '#') return;

    const target = document.querySelector(hash);
    if (!target) return;

    requestAnimationFrame(() => {
      scrollToTarget(target, false);
    });
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scrollToInitialHash, { once: true });
  } else {
    scrollToInitialHash();
  }

  if ('IntersectionObserver' in window && navLinks.length && sections.length) {
    const activeById = new Map(navLinks.map((link) => [link.getAttribute('href').slice(1), link]));

    const observer = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

      if (!visible) return;

      navLinks.forEach((link) => link.removeAttribute('aria-current'));
      const activeLink = activeById.get(visible.target.id);
      if (activeLink) activeLink.setAttribute('aria-current', 'location');
    }, {
      rootMargin: '-30% 0px -55% 0px',
      threshold: [0.1, 0.25, 0.5, 0.75]
    });

    sections.forEach((section) => observer.observe(section));
  }

  document.querySelectorAll('[data-faq-toggle]').forEach((button) => {
    button.addEventListener('click', () => {
      const item = button.closest('.faq-item');
      if (!item) return;

      const isOpen = item.classList.contains('is-open');
      const list = item.closest('.faq-list');

      if (list) {
        list.querySelectorAll('.faq-item.is-open').forEach((openItem) => {
          if (openItem !== item) {
            openItem.classList.remove('is-open');
            openItem.querySelector('[data-faq-toggle]')?.setAttribute('aria-expanded', 'false');
          }
        });
      }

      item.classList.toggle('is-open', !isOpen);
      button.setAttribute('aria-expanded', String(!isOpen));
    });
  });

  const sideNavLinks = Array.from(document.querySelectorAll('.side-nav a[href^="#"]'));
  const contentBlocks = Array.from(document.querySelectorAll('.content-block[id]'));

  if ('IntersectionObserver' in window && sideNavLinks.length && contentBlocks.length) {
    const sideActive = new Map(sideNavLinks.map((link) => [link.getAttribute('href').slice(1), link]));

    const sideObserver = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

      if (!visible) return;

      sideNavLinks.forEach((link) => link.removeAttribute('aria-current'));
      const active = sideActive.get(visible.target.id);
      if (active) active.setAttribute('aria-current', 'true');
    }, {
      rootMargin: '-25% 0px -60% 0px',
      threshold: [0.15, 0.4, 0.7]
    });

    contentBlocks.forEach((block) => sideObserver.observe(block));
  }
})();
