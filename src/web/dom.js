/**
 * COTIZAP · web/dom.js — Ayudantes de DOM, formato e íconos (script clásico; sin dependencias).
 * Todo texto dinámico entra por textContent/createTextNode: nunca por innerHTML.
 */
(function (root) {
  'use strict';

  const W = (root.COTIZAP = root.COTIZAP || {}).web = root.COTIZAP.web || {};

  /** Crea un elemento. attrs: class, dataset, onXxx, html (sólo SVG estático propio), resto = atributos. */
  W.h = function h(tag, attrs, ...hijos) {
    const el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach((k) => {
        const v = attrs[k];
        if (v === undefined || v === null || v === false) return;
        if (k === 'class') el.className = v;
        else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k === 'html') el.innerHTML = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
      });
    }
    hijos.flat(Infinity).forEach((c) => {
      if (c === null || c === undefined || c === false) return;
      el.append(c.nodeType ? c : document.createTextNode(String(c)));
    });
    return el;
  };

  /* ---------------- Formato (es-MX) ---------------- */
  const fMXN = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });
  W.mxn = (x) => fMXN.format(x);
  W.num = (x, d) => Number(x).toLocaleString('es-MX', {
    minimumFractionDigits: d === undefined ? 2 : d,
    maximumFractionDigits: d === undefined ? 2 : d,
  });
  W.pct = (x, d) => `${W.num(x * 100, d === undefined ? 1 : d)} %`;

  /* ---------------- Unidades de captura ---------------- */
  W.MM_IN = 25.4;
  /** Interpreta "12", "12.5", "12,5", "12 1/2", "3/8" → número; NaN si no es válido. */
  W.leerNumero = function leerNumero(txt) {
    const s = String(txt === undefined || txt === null ? '' : txt).trim().replace(',', '.');
    if (s === '') return NaN;
    const m = s.match(/^(-?\d+(?:\.\d+)?)?\s*(?:(\d+)\s*\/\s*(\d+))?$/);
    if (!m || (m[1] === undefined && m[2] === undefined)) return NaN;
    const entero = m[1] === undefined ? 0 : Number(m[1]);
    if (m[2] === undefined) return entero;
    const frac = Number(m[2]) / Number(m[3]);
    return entero < 0 ? entero - frac : entero + frac;
  };

  /* ---------------- Íconos ---------------- */
  const svg = (inner, vb, cls) => `<svg class="${cls || 'ico'}" viewBox="${vb || '0 0 24 24'}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${inner}</svg>`;
  W.icono = (nombre) => W.h('span', { class: 'icono', html: svg(W.ICONOS[nombre] || '') });
  W.ICONOS = {
    mas: '<path d="M12 5v14M5 12h14"/>',
    editar: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13.5 6.5l4 4"/>',
    copiar: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
    basura: '<path d="M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13"/>',
    aviso: '<path d="M12 4l9 16H3z"/><path d="M12 10v5M12 18v.4"/>',
    error: '<circle cx="12" cy="12" r="9"/><path d="M12 7v6M12 16.5v.4"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.4"/>',
    cerrar: '<path d="M6 6l12 12M18 6L6 18"/>',
    bajar: '<path d="M12 4v11M7 11l5 5 5-5M5 20h14"/>',
    subir: '<path d="M12 16V5M7 9l5-5 5 5M5 20h14"/>',
    buscar: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4 4"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    imprimir: '<path d="M7 9V4h10v5M7 17H5v-6h14v6h-2M8 14h8v6H8z"/>',
    reiniciar: '<path d="M4 12a8 8 0 1 0 3-6.2M4 4v4h4"/>',
  };

  /** Siluetas de familia (48 × 32) para el selector y la lista. */
  const FAM = {
    RECTO: '<rect x="9" y="9" width="30" height="14" rx="1"/><path d="M9 5v22M39 5v22"/>',
    CODO: '<path d="M7 29V19A13 13 0 0 1 20 6h21"/><path d="M19 29v-6a4 4 0 0 1 4-4h18"/><path d="M7 21l12 1M10 13l9 8M18 8l5 9"/>',
    REDUCCION: '<path d="M6 5h6l26 7v8l-26 7H6z"/><path d="M12 5v22"/>',
    TRANSICION: '<rect x="5" y="6" width="14" height="20" rx="1"/><circle cx="37" cy="16" r="7"/><path d="M19 6l12 4M19 26l12-4"/>',
    RAMAL: '<path d="M4 16h40M4 26h40M17 16L29 4M25 16L37 4"/>',
    PANTALON: '<path d="M20 29V19M28 29V19M20 19L9 6M28 19l11-13M9 6h6M33 6h6"/>',
    PERSONALIZADO: '<path d="M10 25l15-15 6 6-15 15H10z"/><path d="M28 7l3-3 6 6-3 3"/>',
    COMPRADO: '<path d="M8 11l16-7 16 7v14l-16 6-16-6z"/><path d="M8 11l16 6 16-6M24 17v14"/>',
  };
  W.iconoFamilia = (fam) => W.h('span', { class: 'icono-fam', html: svg(FAM[fam] || '', '0 0 48 32', 'ico-fam') });
}(typeof self !== 'undefined' ? self : this));
