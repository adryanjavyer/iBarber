/* iBarber · seletor de aparência. Isolado do agendamento e do painel. */
(() => {
  'use strict';
  const KEY = 'ibarber:color-theme';
  const root = document.documentElement;
  const button = document.getElementById('themeToggle');
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  const schemeMeta = document.querySelector('meta[name="color-scheme"]');
  const system = window.matchMedia?.('(prefers-color-scheme: dark)');
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
  const COLORS = { dark: '#0b0d11', light: '#f3f4f6' };
  let runningTransition = null;

  // Se o armazenamento não estiver disponível, o tema continua funcionando nesta aba.
  const readPreference = () => {
    try {
      const value = localStorage.getItem(KEY);
      return value === 'dark' || value === 'light' ? value : null;
    } catch { return null; }
  };
  const savePreference = value => {
    try { localStorage.setItem(KEY, value); } catch { /* armazenamento privado */ }
  };

  function paint(theme) {
    root.dataset.theme = theme;
    root.style.colorScheme = theme === 'light' ? 'only light' : 'dark';
    if (themeMeta) themeMeta.content = COLORS[theme];
    if (schemeMeta) schemeMeta.content = 'light dark';
    if (button) {
      const isLight = theme === 'light';
      button.setAttribute('aria-pressed', String(isLight));
      button.setAttribute('aria-label', isLight ? 'Ativar modo escuro' : 'Ativar modo claro');
      button.title = isLight ? 'Ativar modo escuro' : 'Ativar modo claro';
    }
  }

  function changeTheme(theme, animate = true) {
    if (root.dataset.theme === theme) { paint(theme); return; }
    const canAnimate = animate && !reducedMotion?.matches && !document.hidden;
    if (!canAnimate) { paint(theme); return; }

    // A animação de temas não disputa o mesmo frame de uma troca de etapa.
    // Uma nova escolha rápida substitui a anterior sem deixar o tema travado.
    if (runningTransition) {
      runningTransition.skipTransition();
      runningTransition = null;
      root.classList.remove('theme-view-switch');
    }
    if (typeof document.startViewTransition === 'function' &&
        !document.activeViewTransition && !root.dataset.ibarberDirection) {
      root.classList.add('theme-view-switch');
      try {
        const transition = document.startViewTransition(() => paint(theme));
        runningTransition = transition;
        transition.finished.catch(() => {}).finally(() => {
          if (runningTransition === transition) {
            runningTransition = null;
            root.classList.remove('theme-view-switch');
          }
        });
      } catch (error) {
        root.classList.remove('theme-view-switch');
        runningTransition = null;
        paint(theme);
      }
      return;
    }

    // Fallback acessível para navegadores sem a View Transition API.
    root.classList.add('theme-color-switch');
    requestAnimationFrame(() => {
      paint(theme);
      window.setTimeout(() => root.classList.remove('theme-color-switch'), 460);
    });
  }

  // Sincroniza UI/metadados também na inicialização.
  paint(root.dataset.theme === 'light' ? 'light' : 'dark');

  button?.addEventListener('click', () => {
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    root.dataset.themePreference = 'manual';
    savePreference(next);
    changeTheme(next);
  });

  // Acompanhar mudanças de aparência do celular APENAS sem escolha manual.
  const systemChange = event => {
    if (readPreference()) return;
    root.dataset.themePreference = 'system';
    changeTheme(event.matches ? 'dark' : 'light');
  };
  if (system?.addEventListener) system.addEventListener('change', systemChange);
  else system?.addListener?.(systemChange);

  // Se outra aba alterar a preferência, esta acompanha sem criar novos fluxos.
  window.addEventListener('storage', event => {
    if (event.key !== KEY) return;
    const preferred = readPreference();
    root.dataset.themePreference = preferred ? 'manual' : 'system';
    changeTheme(preferred || (system?.matches ? 'dark' : 'light'));
  });
})();
