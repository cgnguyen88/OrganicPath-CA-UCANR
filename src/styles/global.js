export const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&family=Lora:ital,wght@0,400;0,600;0,700;1,400;1,600&display=swap');

  :root {
    --u-navy:   #002D54;
    --u-navy-d: #001A31;
    --u-navy-l: #004580;
    --u-gold:   #FDBD10;
    --u-gold-d: #bd8e00;
    --u-gold-l: #fff8e1;
    --u-sky:    #3AA8E4;
    --u-green:  #1B6B2E;
    --u-green-l:#e8f5e9;

    --g950: #001A31;
    --g900: #002D54;
    --g800: #004580;
    --g700: #005FAE;
    --g600: #3AA8E4;
    --g200: #cce9f9;
    --g100: #e5f4fd;
    --g50:  #f8fafc;
    --cream:#f1f5f9;

    --error:   #cc0000;
    --error-bg:#fff0f0;
    --success: #1B6B2E;
    --success-bg:#e8f5e9;
    --warn:    #bd8e00;
    --warn-bg: #fff8e1;

    --glass-bg: rgba(255,255,255,0.65);
    --blur: blur(12px);
    --glass-shadow: 0 8px 32px 0 rgba(31,38,135,0.15);
    --card-radius: 12px;
    --transition: all 0.2s ease;
  }

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  html, body, #root {
    height: 100%;
    font-family: 'Inter', system-ui, sans-serif;
    font-size: 16px;
    line-height: 1.6;
    color: #1a2236;
    background: var(--cream);
  }

  h1, h2, h3, h4 {
    font-family: 'Lora', Georgia, serif;
    line-height: 1.3;
  }

  .glass {
    background: var(--glass-bg);
    backdrop-filter: var(--blur);
    -webkit-backdrop-filter: var(--blur);
    box-shadow: var(--glass-shadow);
  }

  ::-webkit-scrollbar { width: 6px; height: 6px; }
  ::-webkit-scrollbar-track { background: transparent; }
  ::-webkit-scrollbar-thumb { background: rgba(0,45,84,0.25); border-radius: 3px; }


  /* ── Side menu: flat, quiet, one accent ─────────────────────────────── */
  .side-menu { --menu-text: rgba(255,255,255,0.66); --menu-muted: rgba(255,255,255,0.4); --menu-hover: rgba(255,255,255,0.06); --menu-active: rgba(255,255,255,0.1); }
  .nav-item {
    position: relative; width: 100%; display: flex; align-items: center; gap: 10px;
    min-height: 32px; padding: 6px 10px; border: 0; border-radius: 6px; background: transparent;
    color: var(--menu-text); font: 400 13px/1.2 Inter, sans-serif; text-align: left; cursor: pointer;
    transition: background-color .12s ease, color .12s ease;
  }
  .nav-item:hover { background: var(--menu-hover); color: #fff; }
  .nav-item:focus-visible { outline: 2px solid var(--u-sky); outline-offset: -2px; }
  .nav-item[aria-current="page"] { background: var(--menu-active); color: #fff; font-weight: 600; }
  .nav-item[aria-current="page"]::before {
    content: ""; position: absolute; left: 0; top: 7px; bottom: 7px; width: 2px; border-radius: 2px; background: var(--u-gold);
  }
  .nav-item svg { flex-shrink: 0; opacity: .85; }
  .nav-item[aria-current="page"] svg, .nav-item:hover svg { opacity: 1; }
  .nav-group-header {
    width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: 4px 10px; margin: 14px 0 4px; border: 0; background: transparent; cursor: pointer;
    color: var(--menu-muted); font: 600 10.5px/1.2 Inter, sans-serif; letter-spacing: .08em; text-transform: uppercase;
  }
  .nav-group-header:hover { color: rgba(255,255,255,0.7); }
  .nav-group-header:focus-visible { outline: 2px solid var(--u-sky); outline-offset: -2px; border-radius: 4px; }
  .menu-segment { display: inline-flex; padding: 2px; border-radius: 7px; background: rgba(255,255,255,0.06); }
  .menu-segment button {
    border: 0; border-radius: 5px; padding: 4px 10px; background: transparent; cursor: pointer;
    color: var(--menu-muted); font: 500 11px/1 Inter, sans-serif; transition: background-color .12s ease, color .12s ease;
  }
  .menu-segment button:hover { color: #fff; }
  .menu-segment button[aria-pressed="true"] { background: rgba(255,255,255,0.14); color: #fff; font-weight: 600; }
  .menu-segment button:focus-visible { outline: 2px solid var(--u-sky); outline-offset: 1px; }
  .menu-icon-button {
    display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; border: 0; border-radius: 6px;
    background: transparent; color: var(--menu-muted); cursor: pointer; transition: background-color .12s ease, color .12s ease;
  }
  .menu-icon-button:hover { background: var(--menu-hover); color: #fff; }
  .menu-icon-button:focus-visible { outline: 2px solid var(--u-sky); outline-offset: 1px; }
  @media (prefers-reduced-motion: reduce) { .nav-item, .menu-segment button, .menu-icon-button { transition: none; } }

  @media print {
    .no-print { display: none !important; }
    body { background: white; }
  }

  @keyframes caretBlink {
    0%,100% { opacity:1 } 50% { opacity:0 }
  }
  @keyframes bounce {
    0%,80%,100% { transform:scale(0) } 40% { transform:scale(1) }
  }
  @keyframes fadeSlideUp {
    from { opacity:0; transform:translateY(12px) }
    to   { opacity:1; transform:translateY(0) }
  }
`;

export const STEP_COLORS = {
  profile:    '#005FAE',
  eligibility:'#FDBD10',
  land:       '#1B6B2E',
  osp:        '#3AA8E4',
  substances: '#7c3aed',
  certifier:  '#bd8e00',
  registration:'#cc0000',
};
