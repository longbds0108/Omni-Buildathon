// xlmflow docs: mobile menu, collapsible contents on small screens, and the current section in the contents.
(() => {
  const $ = (s, el = document) => el.querySelector(s);

  // Mobile menu (same behaviour as the homepage).
  const toggle = $(".nav__toggle");
  const mnav = $("#mnav");
  const setMenu = (open) => {
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    mnav.hidden = !open;
    document.body.style.overflow = open ? "hidden" : "";
  };
  toggle.addEventListener("click", () => setMenu(mnav.hidden));
  mnav.addEventListener("click", (e) => e.target.closest("a") && setMenu(false));
  document.addEventListener("keydown", (e) => e.key === "Escape" && !mnav.hidden && (setMenu(false), toggle.focus()));
  window.addEventListener("resize", () => window.innerWidth > 860 && !mnav.hidden && setMenu(false));

  // Contents: always open on wide screens; on narrow screens closed by default and closed again after a jump.
  const toc = $(".toc");
  const narrow = window.matchMedia("(max-width: 960px)");
  const syncToc = () => (toc.open = !narrow.matches);
  syncToc();
  narrow.addEventListener("change", syncToc);
  $(".toc__head").addEventListener("click", (e) => !narrow.matches && e.preventDefault());
  toc.addEventListener("click", (e) => e.target.closest("nav a") && narrow.matches && (toc.open = false));

  // Highlight the section being read.
  const links = [...toc.querySelectorAll("nav a")];
  const byId = new Map(links.map((a) => [a.getAttribute("href").slice(1), a]));
  const sections = [...byId.keys()].map((id) => document.getElementById(id)).filter(Boolean);
  let current = null;
  const mark = () => {
    const line = window.innerHeight * 0.3;
    let active = sections[0];
    for (const s of sections) if (s.getBoundingClientRect().top <= line) active = s;
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) active = sections[sections.length - 1];
    if (active === current) return;
    current = active;
    links.forEach((a) => a.classList.toggle("is-active", byId.get(active.id) === a));
  };
  let ticking = false;
  window.addEventListener(
    "scroll",
    () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => ((ticking = false), mark()));
    },
    { passive: true },
  );
  mark();
})();
