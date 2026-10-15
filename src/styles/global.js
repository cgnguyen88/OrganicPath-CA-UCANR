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
    width: 290px; min-width: 290px; height: 100vh; height: 100dvh; flex-shrink: 0;
    --menu-text: rgba(255,255,255,0.92); --menu-muted: rgba(255,255,255,0.72);
    --glass-fill: linear-gradient(155deg, rgba(14,38,64,0.55) 0%, rgba(5,18,34,0.62) 55%, rgba(8,24,42,0.58) 100%);
    --glass-rim: rgba(255,255,255,0.13); --glass-shine: rgba(255,255,255,0.20);
    --glass-ease: cubic-bezier(.22,.8,.24,1);
    position: relative; overflow: hidden; isolation: isolate;
    background: linear-gradient(165deg, #010c19 0%, #031a31 55%, #02121f 100%);
  }
  .menu-backdrop { position: absolute; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }
  .menu-orb { position: absolute; border-radius: 50%; filter: blur(48px); opacity: .14; }
  .menu-orb-sky   { width: 240px; height: 240px; left: -90px; top: 10px;     background: radial-gradient(circle at 40% 40%, #3AA8E4, rgba(58,168,228,0) 70%); }
  .menu-orb-green { width: 260px; height: 260px; left: -60px; bottom: -110px; background: radial-gradient(circle at 40% 40%, #2fa84f, rgba(47,168,79,0) 70%); opacity: .12; }

  .menu-panel {
    position: relative; z-index: 1; display: flex; flex-direction: column;
    margin: 10px; height: calc(100% - 20px); border-radius: 20px; overflow: hidden;
    background: var(--glass-fill);
    -webkit-backdrop-filter: blur(24px) saturate(140%); backdrop-filter: blur(24px) saturate(140%);
    border: 1px solid var(--glass-rim);
    box-shadow: inset 0 1px 0 var(--glass-shine), inset 0 0 22px rgba(255,255,255,0.025), 0 14px 32px rgba(0,5,15,0.5);
  }
  .menu-panel::before { /* a very soft sheen along the top edge */
    content: ""; position: absolute; left: 0; right: 0; top: 0; height: 70px; pointer-events: none; z-index: 0;
    background: radial-gradient(120% 100% at 20% 0%, rgba(255,255,255,0.06), rgba(255,255,255,0) 65%);
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
    background: linear-gradient(160deg, rgba(255,255,255,0.07), rgba(255,255,255,0.02));
    border: 1px solid rgba(255,255,255,0.12); box-shadow: inset 0 1px 0 rgba(255,255,255,0.14);
  }

  .nav-item {
    position: relative; width: 100%; display: flex; align-items: center; gap: 10px;
    min-height: 33px; padding: 6px 12px; border: 1px solid transparent; border-radius: 10px; background: transparent;
    color: var(--menu-text); font: 400 13px/1.2 Inter, sans-serif; text-align: left; cursor: pointer;
    transition: background-color .28s var(--glass-ease), box-shadow .28s var(--glass-ease), border-color .28s var(--glass-ease), color .2s ease;
  }
  .nav-item:hover { background: rgba(255,255,255,0.10); color: #fff; box-shadow: inset 0 1px 0 rgba(255,255,255,0.14); }
  .nav-item:focus-visible { outline: 2px solid #8fd0ff; outline-offset: -2px; }
  .nav-item[aria-current="page"] { /* the current page: a gold-tinted glass pill */
    color: #fff; font-weight: 600; border-color: rgba(253,189,16,0.30);
    background: linear-gradient(135deg, rgba(253,189,16,0.24) 0%, rgba(255,255,255,0.09) 60%, rgba(255,255,255,0.05) 100%);
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.30), 0 4px 12px rgba(253,189,16,0.08);
  }
  .nav-item svg { flex-shrink: 0; opacity: .9; transition: opacity .2s ease, color .2s ease; }
  .nav-item:hover svg { opacity: 1; }
  .nav-item[aria-current="page"] svg { opacity: 1; color: #ffd24a; }

  /* Each main section is a card of its own: a clear title, a small tinted icon, a hairline of its accent. */
  .nav-section {
    --section-accent: #9fb4cc; position: relative; margin: 10px 0 0; overflow: hidden; border-radius: 14px;
    background: rgba(0,6,16,0.34); border: 1px solid rgba(255,255,255,0.10); box-shadow: inset 0 1px 0 rgba(255,255,255,0.06);
  }
  .nav-section::before {
    content: ""; position: absolute; left: 14px; right: 14px; top: 0; height: 1px; pointer-events: none;
    background: linear-gradient(90deg, rgba(255,255,255,0), var(--section-accent), rgba(255,255,255,0)); opacity: .6;
  }
  .nav-section-header {
    width: 100%; display: flex; align-items: center; gap: 8px; padding: 9px 10px 8px; border: 0; background: transparent; cursor: pointer;
    color: #fff; font: 600 12.5px/1.2 Inter, sans-serif; text-align: left;
    transition: background-color .2s ease;
  }
  .nav-section-header:hover { background: rgba(255,255,255,0.06); }
  .nav-section-header:focus-visible { outline: 2px solid #8fd0ff; outline-offset: -2px; }
  .nav-section-icon {
    width: 20px; height: 20px; flex-shrink: 0; display: inline-flex; align-items: center; justify-content: center; border-radius: 6px;
    background: rgba(255,255,255,0.1); color: var(--section-accent);
  }
  @supports (background: color-mix(in srgb, red 20%, transparent)) {
    .nav-section-icon { background: color-mix(in srgb, var(--section-accent) 20%, transparent); }
  }
  .nav-section-title { flex: 1; letter-spacing: .01em; }
  .nav-section-count { min-width: 18px; padding: 2px 6px; border-radius: 9px; background: rgba(255,255,255,0.14); color: #fff; font-size: 10.5px; font-weight: 600; line-height: 1; text-align: center; }
  .nav-section-chevron { flex-shrink: 0; color: rgba(255,255,255,0.65); }
  .nav-section-body { padding: 0 6px 6px; }
  /* The list scrolls under the account card: fade its last few pixels so that is obvious. */
  .side-menu .menu-nav { -webkit-mask-image: linear-gradient(to bottom, #000 calc(100% - 22px), transparent); mask-image: linear-gradient(to bottom, #000 calc(100% - 22px), transparent); }

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
    background: rgba(0,4,12,0.45); box-shadow: inset 0 1px 3px rgba(0,0,0,0.5), 0 1px 0 rgba(255,255,255,0.08);
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
    .menu-panel { background: rgba(5,20,38,0.97); }
  }
  /* People who ask for less transparency or less motion get a calm, solid menu. */
  @media (prefers-reduced-transparency: reduce) {
    .menu-panel { background: #051426; -webkit-backdrop-filter: none; backdrop-filter: none; }
    .menu-orb { display: none; }
  }
  @media (prefers-reduced-motion: reduce) {
    .nav-item, .menu-segment button, .menu-icon-button, .nav-group-header, .nav-section-header, .nav-item svg { transition: none; }
  }


  /* ── App frame: menu + page; on a phone a top bar and a slide-out menu ───────────────────── */
  .app-shell { display: flex; height: 100vh; height: 100dvh; overflow: hidden; }
  .app-main { flex: 1; min-width: 0; overflow-y: auto; background: var(--cream); position: relative; -webkit-overflow-scrolling: touch; }
  .app-shell--phone { flex-direction: column; }

  .mobile-topbar {
    position: relative; z-index: 20; flex-shrink: 0; display: flex; align-items: center; gap: 10px;
    min-height: 56px; padding: 8px 14px; padding-top: max(8px, env(safe-area-inset-top));
    background: linear-gradient(165deg, #010c19 0%, #031a31 100%); color: #fff;
    box-shadow: 0 2px 10px rgba(0,10,25,0.25);
  }
  .mobile-topbar .menu-mark { width: 28px; height: 28px; }
  .mobile-topbar-button {
    display: inline-flex; align-items: center; justify-content: center; width: 44px; height: 44px; margin-left: -6px;
    border: 0; border-radius: 12px; background: transparent; color: #fff; cursor: pointer;
  }
  .mobile-topbar-button:focus-visible { outline: 2px solid #8fd0ff; outline-offset: 0; }
  .mobile-topbar-title { flex: 1; min-width: 0; font: 600 16px/1.2 Lora, serif; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .side-menu--drawer {
    position: fixed; top: 0; bottom: 0; left: 0; z-index: 1001; width: min(86vw, 320px); min-width: 0; height: 100%;
    transform: translateX(-102%); visibility: hidden; box-shadow: none;
    transition: transform .28s var(--glass-ease), visibility 0s linear .28s;
    padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom);
  }
  .side-menu--drawer.is-open { transform: none; visibility: visible; box-shadow: 8px 0 30px rgba(0,8,20,0.35); transition: transform .28s var(--glass-ease); }
  .side-menu--drawer .nav-item, .side-menu--drawer .nav-section-header { min-height: 44px; font-size: 15px; }
  .side-menu--drawer .menu-segment button { padding: 9px 14px; font-size: 13px; }
  .side-menu--drawer .menu-icon-button { width: 40px; height: 40px; }
  .menu-scrim { position: fixed; inset: 0; z-index: 1000; background: rgba(0,10,25,0.5); animation: fadeIn .2s ease; }
  @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
  @media (prefers-reduced-motion: reduce) {
    .side-menu--drawer { transition: none; }
    .menu-scrim { animation: none; }
  }


  /* ── Phones ─────────────────────────────────────────────────────────────────────────────────
     The pages are styled with inline styles, so these rules need !important, and where a page has no
     class of its own they match what React writes into the style attribute ("grid-template-columns:
     1fr 1fr", "padding: 40px"). */
  @media (max-width: 767px) {
    /* Every page: phone margins, and room at the bottom so the chat button never covers the last line. */
    .app-shell--phone .app-main > :not(.page-bleed) { padding: 20px 16px 96px !important; }

    /* The dashboard's photo runs edge to edge, so it is laid out here rather than by the page rule. */
    .app-shell--phone .dashboard-hero { height: auto !important; min-height: 240px; padding: 28px 16px 24px !important; }
    .app-shell--phone .dashboard-hero h1 { font-size: 28px !important; }
    .app-shell--phone .dashboard-body { padding: 24px 16px 0 !important; }

    /* Step bars show the current step by name and the others by number (their names stay for screen readers). */
    .osp-steps .osp-step-label[data-current="false"] { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

    /* A list beside its details becomes a strip of choices you swipe sideways, above the details. */
    .code-subparts { flex-direction: column !important; gap: 12px !important; }
    .code-subpart-list { width: auto !important; display: flex; gap: 6px; overflow-x: auto; padding-bottom: 4px; -webkit-overflow-scrolling: touch; }
    .code-subpart-list > button { width: auto !important; flex: 0 0 auto; max-width: 180px; margin-bottom: 0 !important; }
    .code-subparts > :last-child { min-width: 0; }

    /* Columns that sit side by side on a computer are stacked. */
    .app-main [style*="grid-template-columns: 1fr 1fr"],
    .app-main [style*="grid-template-columns: repeat(3, 1fr)"],
    .app-main [style*="grid-template-columns: minmax(0, 1fr) minmax(0, 1fr)"],
    .app-main [style*="minmax(340px"], .app-main [style*="minmax(330px"],
    .app-main [style*="minmax(320px"], .app-main [style*="minmax(300px"] {
      grid-template-columns: minmax(0, 1fr) !important;
    }

    /* Generous computer padding inside cards and panels becomes phone padding. */
    .app-main [style*="padding: 40px"], .app-main [style*="padding: 32px"], .app-main [style*="padding: 28px"] { padding: 18px 16px !important; }

    /* Page titles that suit a wide screen are scaled down. */
    .app-main h1 { font-size: 24px !important; line-height: 1.25 !important; }

    /* Form fields at 16px, so iPhones do not zoom in when one is tapped. */
    .app-main input:not([type="checkbox"]):not([type="radio"]):not([type="range"]), .app-main select, .app-main textarea,
    .chat-panel textarea { font-size: 16px !important; }

    /* Long words, links and codes wrap instead of pushing the page sideways ("break-word", not "anywhere",
       so table columns are not squeezed until words break letter by letter). */
    .app-main { overflow-wrap: break-word; }

    /* Jimmy's chat: nearly full screen, above the keyboard, and its button tucked into the corner. */
    .chat-panel { left: 8px !important; right: 8px !important; width: auto !important; bottom: 84px !important; height: min(560px, calc(100dvh - 96px)) !important; }
    .chat-toggle { right: 16px !important; bottom: 16px !important; width: 54px !important; height: 54px !important; }
  }

  /* ── Reports: the page shown on screen, and what the browser prints or saves as PDF ───────── */
  /* A page keeps its width and scrolls sideways in a small window, rather than crushing its columns. */
  .report-doc { box-sizing: border-box; min-width: 860px; background: #fff; color: #0f172a; font: 12px/1.45 Inter, sans-serif; padding: 28px 32px; border: 1px solid #e2e8f0; border-radius: 10px; }
  .report-doc h1 { font: 700 22px/1.2 Lora, serif; margin: 0 0 14px; color: #0f172a; }
  .report-doc h2 { font: 700 14px/1.3 Lora, serif; margin: 22px 0 8px; color: #0f172a; break-after: avoid; }
  .report-meta { margin: 0 0 18px; display: grid; grid-template-columns: max-content 1fr; gap: 3px 16px; }
  .report-meta > div { display: contents; }
  .report-meta dt { font-weight: 600; color: #475569; }
  .report-meta dd { margin: 0; overflow-wrap: anywhere; }
  .report-doc table { width: 100%; border-collapse: collapse; margin: 0 0 6px; font-size: 11px; }
  .report-doc th { text-align: left; background: #e2e8f0; font-weight: 600; padding: 5px 7px; border: 1px solid #cbd5e1; }
  .report-doc td { padding: 5px 7px; border: 1px solid #cbd5e1; vertical-align: top; overflow-wrap: anywhere; }
  .report-doc td.report-date { white-space: nowrap; }
  .report-doc .report-summary { width: auto; min-width: 280px; margin-bottom: 8px; }
  .report-doc .report-note { color: #64748b; font-style: italic; margin: 10px 0; }
  .report-sign { display: grid; grid-template-columns: 5fr 5fr 3fr; gap: 24px; margin-top: 40px; font-size: 11px; color: #475569; break-inside: avoid; }
  .report-line { display: block; height: 28px; border-bottom: 1px solid #0f172a; margin-bottom: 4px; }
  .report-foot { margin: 22px 0 0; font-size: 10px; color: #64748b; }
  .print-only { display: none; }
  @page report { size: landscape; margin: 12mm; }

  @media print {
    .no-print { display: none !important; }
    body { background: white; }
    /* Printing a report: show only the report (the class is set just while the print window is open). */
    body.printing-report > *:not(.print-only) { display: none !important; }
    body.printing-report .print-only { display: block !important; page: report; }
    .print-only .report-doc { min-width: 0; border: 0; border-radius: 0; padding: 0; font-size: 9pt; }
    .print-only .report-doc table { font-size: 8.5pt; }
    .print-only .report-doc tr { break-inside: avoid; }
    .print-only .report-doc thead { display: table-header-group; }
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
