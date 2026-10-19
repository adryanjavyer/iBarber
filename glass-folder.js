/* iBarber — Glass Folder interaction. Independent enhancement of original booking flow. */
(() => {
  "use strict";
  const folder = document.getElementById("glassBookingFolder");
  const toggle = document.getElementById("glassFolderToggle");
  const key = document.getElementById("glassFolderMore");
  const hint = document.getElementById("folderFeatureHint");
  if (!folder || !toggle || !key) return;
  const reducedMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  let open = false;

  function setOpen(value) {
    open = Boolean(value);
    folder.dataset.folderOpen = String(open);
    toggle.setAttribute("aria-expanded", String(open));
    toggle.setAttribute("aria-label", open ? "Fechar sua pasta de agendamento" : "Abrir sua pasta de agendamento");
    key.setAttribute("aria-label", open ? "Fechar pasta" : "Abrir pasta");
    if (hint) hint.textContent = open ? "Escolha uma etapa para continuar seu agendamento." : "Toque na pasta para explorar as etapas ↗";
    const fileMenu = document.getElementById("folderQuickLinks");
    fileMenu?.setAttribute("aria-hidden", String(!open));
    folder.closest(".folder-feature")?.classList.toggle("folder-is-open", open);
    fileMenu?.querySelectorAll("button").forEach(button => { button.tabIndex = open ? 0 : -1; });
  }
  setOpen(false);

  const scaleToFit = () => {
    const w = Math.min(330, Math.max(188, folder.parentElement?.clientWidth - 8 || 300));
    const mobile = window.matchMedia("(max-width: 600px)").matches;
    const target = mobile ? Math.min(w, window.innerWidth < 360 ? 212 : 248) : Math.min(w, 306);
    folder.style.width = target + "px";
    folder.style.height = Math.round((326 / 340) * target) + "px";
    folder.style.setProperty("--folder-scale", (target / 340).toFixed(4));
  };
  scaleToFit();
  window.addEventListener("resize", scaleToFit, { passive: true });

  toggle.addEventListener("click", () => setOpen(!open));
  key.addEventListener("click", () => {setOpen(!open); toggle.focus({preventScroll:true});});

  const chooseStep = (index) => {
    // The source app controls the state and all original validations.
    const result = window.iBarberOpenBookingStage?.(index);
    if (result !== false) {
      setOpen(false);
      const main = document.querySelector(".progress-area");
      if (main) main.scrollIntoView({ behavior: reducedMotion ? "instant" : "smooth", block: "start" });
    } else {
      if (hint) hint.textContent = "Conclua a etapa anterior para avançar.";
    }
  };
  document.querySelectorAll("[data-folder-go]").forEach(button => {
    button.addEventListener("click", () => chooseStep(Number(button.dataset.folderGo)));
  });

  document.addEventListener("pointerdown", (event) => {
    if (open && !folder.closest(".folder-feature")?.contains(event.target)) setOpen(false);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && open) { setOpen(false); toggle.focus(); }
  });

  if (window.matchMedia?.("(pointer: fine)").matches && !reducedMotion) {
    let raf = 0;
    folder.addEventListener("pointermove", e => {
      const r = folder.getBoundingClientRect();
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        folder.style.setProperty("--gf-px", ((e.clientX - r.left) / r.width * 2 - 1).toFixed(3));
        folder.style.setProperty("--gf-py", ((e.clientY - r.top) / r.height * 2 - 1).toFixed(3));
      });
    }, {passive:true});
    folder.addEventListener("pointerleave", () => {
      folder.style.setProperty("--gf-px", "0");
      folder.style.setProperty("--gf-py", "0");
    });
  }
})();
