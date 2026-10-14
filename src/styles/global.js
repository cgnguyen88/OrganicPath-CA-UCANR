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


  /* ── Side menu: liquid glass ──────────────────────────────────────────
     A translucent, blurred panel floating over a slow color backdrop, with a bright rim and a soft
     inner glow. Solid fallbacks below for no backdrop-filter, reduced transparency and reduced motion. */
  .side-menu {
    --menu-text: rgba(255,255,255,0.78); --menu-muted: rgba(255,255,255,0.56);
    --glass-fill: linear-gradient(155deg, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0.05) 46%, rgba(255,255,255,0.09) 100%);
    --glass-rim: rgba(255,255,255,0.22); --glass-shine: rgba(255,255,255,0.38);
    --glass-ease: cubic-bezier(.22,.8,.24,1);
    position: relative; overflow: hidden; isolation: isolate;
    background: linear-gradient(165deg, #001a31 0%, #002a4e 52%, #00223f 100%);
  }
  .menu-backdrop { position: absolute; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }
  .menu-orb { position: absolute; border-radius: 50%; filter: blur(34px); opacity: .6; will-change: transform; }
  .menu-orb-sky   { width: 210px; height: 210px; left: -70px; top: 40px;  background: radial-gradient(circle at 35% 35%, #3AA8E4, rgba(58,168,228,0) 70%); animation: orb-drift-a 26s ease-in-out infinite; }
  .menu-orb-gold  { width: 170px; height: 170px; right: -70px; top: 62%;  background: radial-gradient(circle at 40% 40%, #FDBD10, rgba(253,189,16,0) 70%); opacity: .28; animation: orb-drift-b 32s ease-in-out infinite; }
  .menu-orb-green { width: 230px; height: 230px; left: -40px; bottom: -70px; background: radial-gradient(circle at 40% 40%, #2fa84f, rgba(47,168,79,0) 70%); opacity: .5; animation: orb-drift-c 29s ease-in-out infinite; }
  @keyframes orb-drift-a { 0%,100% { transform: translate(0,0) } 50% { transform: translate(46px, 70px) } }
  @keyframes orb-drift-b { 0%,100% { transform: translate(0,0) } 50% { transform: translate(-50px,-64px) } }
  @keyframes orb-drift-c { 0%,100% { transform: translate(0,0) } 50% { transform: translate(60px,-44px) } }

  .menu-panel {
    position: relative; z-index: 1; display: flex; flex-direction: column;
    margin: 10px; height: calc(100% - 20px); border-radius: 22px; overflow: hidden;
    background: var(--glass-fill);
    -webkit-backdrop-filter: blur(26px) saturate(165%); backdrop-filter: blur(26px) saturate(165%);
    border: 1px solid var(--glass-rim);
    box-shadow: inset 0 1px 0 var(--glass-shine), inset 0 -1px 0 rgba(255,255,255,0.06), inset 0 0 28px rgba(255,255,255,0.04), 0 18px 40px rgba(0,10,25,0.45);
  }
  .menu-panel::before { /* a soft specular sweep across the top, like light catching the glass */
    content: ""; position: absolute; left: 0; right: 0; top: 0; height: 90px; pointer-events: none; z-index: 0;
    background: radial-gradient(120% 100% at 20% 0%, rgba(255,255,255,0.20), rgba(255,255,255,0) 62%);
  }
  .menu-panel > * { position: relative; z-index: 1; }

  .menu-mark {
    width: 30px; height: 30px; border-radius: 9px; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
    background: linear-gradient(145deg, #ffd24a, #FDBD10 55%, #e9a800);
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.7), inset 0 -1px 0 rgba(0,0,0,0.12), 0 4px 14px rgba(253,189,16,0.35);
  }
  .menu-avatar {
    width: 30px; height: 30px; border-radius: 50%; flex-shrink: 0; display: flex; align-items: center; justify-content: center;
    color: #fff; font-size: 11px; font-weight: 600;
    background: linear-gradient(145deg, rgba(255,255,255,0.28), rgba(255,255,255,0.08));
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.4), 0 2px 8px rgba(0,10,25,0.3);
  }
  .menu-footer {
    margin: 0 10px 10px; padding: 10px; border-radius: 16px;
    background: linear-gradient(160deg, rgba(255,255,255,0.12), rgba(255,255,255,0.04));
    border: 1px solid rgba(255,255,255,0.14); box-shadow: inset 0 1px 0 rgba(255,255,255,0.22);
  }

  .nav-item {
    position: relative; width: 100%; display: flex; align-items: center; gap: 10px;
    min-height: 34px; padding: 6px 12px; border: 1px solid transparent; border-radius: 12px; background: transparent;
    color: var(--menu-text); font: 400 13px/1.2 Inter, sans-serif; text-align: left; cursor: pointer;
    transition: background-color .28s var(--glass-ease), box-shadow .28s var(--glass-ease), border-color .28s var(--glass-ease), color .2s ease;
  }
  .nav-item:hover { background: rgba(255,255,255,0.09); color: #fff; box-shadow: inset 0 1px 0 rgba(255,255,255,0.14); }
  .nav-item:focus-visible { outline: 2px solid #8fd0ff; outline-offset: -2px; }
  .nav-item[aria-current="page"] { /* the current page: a gold-tinted glass pill */
    color: #fff; font-weight: 600; border-color: rgba(253,189,16,0.38);
    background: linear-gradient(135deg, rgba(253,189,16,0.26) 0%, rgba(255,255,255,0.14) 55%, rgba(255,255,255,0.08) 100%);
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.42), inset 0 -1px 0 rgba(255,255,255,0.06), 0 6px 18px rgba(253,189,16,0.14);
  }
  .nav-item svg { flex-shrink: 0; opacity: .85; transition: opacity .2s ease, color .2s ease; }
  .nav-item:hover svg { opacity: 1; }
  .nav-item[aria-current="page"] svg { opacity: 1; color: #ffd24a; }
  .nav-group-header {
    width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: 4px 12px; margin: 14px 0 4px; border: 0; background: transparent; cursor: pointer;
    color: var(--menu-muted); font: 600 10.5px/1.2 Inter, sans-serif; letter-spacing: .09em; text-transform: uppercase;
    transition: color .2s ease;
  }
  .nav-group-header:hover { color: #fff; }
  .nav-group-header:focus-visible { outline: 2px solid #8fd0ff; outline-offset: -2px; border-radius: 6px; }

  .menu-segment {
    display: inline-flex; padding: 3px; border-radius: 999px;
    background: rgba(0,10,25,0.28); box-shadow: inset 0 1px 3px rgba(0,0,0,0.35), 0 1px 0 rgba(255,255,255,0.1);
  }
  .menu-segment button {
    border: 1px solid transparent; border-radius: 999px; padding: 5px 12px; background: transparent; cursor: pointer;
    color: var(--menu-muted); font: 500 11px/1 Inter, sans-serif;
    transition: background-color .28s var(--glass-ease), box-shadow .28s var(--glass-ease), color .2s ease;
  }
  .menu-segment button:hover { color: #fff; }
  .menu-segment button[aria-pressed="true"] {
    color: #fff; font-weight: 600; border-color: rgba(255,255,255,0.22);
    background: linear-gradient(160deg, rgba(255,255,255,0.34), rgba(255,255,255,0.12));
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.5), 0 3px 10px rgba(0,10,25,0.3);
  }
  .menu-segment button:focus-visible { outline: 2px solid #8fd0ff; outline-offset: 1px; }
  .menu-icon-button {
    display: inline-flex; align-items: center; justify-content: center; width: 30px; height: 30px; border: 1px solid transparent; border-radius: 10px;
    background: transparent; color: var(--menu-muted); cursor: pointer;
    transition: background-color .28s var(--glass-ease), color .2s ease, box-shadow .28s var(--glass-ease);
  }
  .menu-icon-button:hover { background: rgba(255,255,255,0.12); color: #fff; box-shadow: inset 0 1px 0 rgba(255,255,255,0.2); }
  .menu-icon-button:focus-visible { outline: 2px solid #8fd0ff; outline-offset: 1px; }

  /* Browsers without backdrop blur: a solid, readable panel instead of broken glass. */
  @supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
    .menu-panel { background: rgba(6,34,64,0.96); }
  }
  /* People who ask for less transparency or less motion get a calm, solid menu. */
  @media (prefers-reduced-transparency: reduce) {
    .menu-panel { background: #06223f; -webkit-backdrop-filter: none; backdrop-filter: none; }
    .menu-orb { display: none; }
  }
  @media (prefers-reduced-motion: reduce) {
    .menu-orb { animation: none; }
    .nav-item, .menu-segment button, .menu-icon-button, .nav-group-header, .nav-item svg { transition: none; }
  }

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
