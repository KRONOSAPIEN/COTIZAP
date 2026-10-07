/**
 * COTIZAP · material.js — Peso de lámina, merma y herrajes de unión.
 *
 * Merma (φ): fracción del material COMPRADO que no queda en la pieza.
 *     m_bruta = m_neta / (1 − φ)        (NO es m_neta · (1 + φ))
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./util'));
  } else {
    root.COTIZAP = root.COTIZAP || {};
    root.COTIZAP.material = factory(root.COTIZAP.util);
  }
}(typeof self !== 'undefined' ? self : this, function (U) {
  'use strict';

  const { PI } = U;
  const DENSIDAD_ACERO_PERFIL_G_CM3 = 7.85;

  function exigir(cond, msg) {
    if (!cond) throw new U.ErrorValidacion([msg]);
  }

  /** Espesor (mm) a partir del calibre y la tabla del material; `espesor_mm` manda si se captura (placa). */
  function espesorMm(M, mat, p) {
    if (p.espesor_mm > 0) return p.espesor_mm;
    const tabla = M.calibres[mat.tabla_calibre];
    exigir(tabla, `Tabla de calibres inexistente: ${mat.tabla_calibre}`);
    const pulg = tabla[p.calibre];
    exigir(pulg !== undefined, `El calibre ${p.calibre} no existe en la tabla ${mat.tabla_calibre} (capturar espesor_mm para placa).`);
    return pulg * U.MM_POR_PULGADA;
  }

  /**
   * Propiedades derivadas de un perfil de brida (el aro se rola "de canto": el ancho queda en el plano radial).
   *   SOLERA : barra plana ancho × espesor → área = b·t ; centroide radial = b/2 ; gramil = b/2 (barreno al centro).
   *   ANGULO : ala radial de un ángulo de lados iguales → área = t·(2b − t) ; centroide medido desde el dorso.
   */
  function perfilDerivado(M, id) {
    const base = M.herrajes.perfiles[id];
    exigir(base, `Perfil inexistente: ${id}`);
    const b = base.ancho_mm;
    const t = base.esp_mm;
    exigir(b > 0 && t > 0, `El perfil ${id} necesita ancho_mm y esp_mm mayores que 0.`);
    const solera = base.tipo === 'SOLERA';
    const area = solera ? b * t : t * (2 * b - t);
    return {
      id,
      ...base,
      gramil_mm: base.gramil_mm === undefined ? b / 2 : base.gramil_mm,
      area_mm2: area,
      peso_kg_m: (area * DENSIDAD_ACERO_PERFIL_G_CM3) / 1000,
      c_centroide_mm: solera ? b / 2 : (b * t + b * b - t * t) / (2 * (2 * b - t)),
    };
  }

  function seleccionarPerfil(M, dim_mayor_mm, id_forzado) {
    if (id_forzado) return perfilDerivado(M, id_forzado);
    const fila = M.herrajes.seleccion_perfil.find((f) => dim_mayor_mm <= f.hasta_mm);
    return perfilDerivado(M, (fila || M.herrajes.seleccion_perfil[M.herrajes.seleccion_perfil.length - 1]).perfil);
  }

  /** Peso neto, merma y peso bruto de lámina para el área neta total (incluye prolongación de espiga). */
  function lamina(PF, A_extra_m2, p, mat, e, M) {
    const A = PF.A_neta_m2 + A_extra_m2;
    const kg_m2 = (mat.densidad_kg_m3 * e) / 1000;
    const hayOverride = p.merma_pct !== undefined && p.merma_pct !== null && p.merma_pct !== '';
    const phi = hayOverride ? Number(p.merma_pct) : (A > 0 ? M.merma[PF.familia] : 0); // sin lámina (bridas sueltas) no hay merma de lámina
    exigir(phi >= 0 && phi < 1, 'La merma debe estar en el intervalo [0, 1).');
    const m_neta = A * kg_m2;
    const m_bruta = m_neta / (1 - phi);
    return {
      A_neta_m2: A, kg_m2, m_neta_kg: m_neta, phi, m_bruta_kg: m_bruta, m_merma_kg: m_bruta - m_neta, A_bruta_m2: m_bruta / kg_m2,
    };
  }

  /** Geometría del aro de brida y del patrón de tornillos para un extremo. */
  function geometriaAro(ext, perfil, holgura_mm, puntas_mm) {
    const c = perfil.c_centroide_mm;
    const g = perfil.gramil_mm;
    const b = perfil.ancho_mm;
    const t = perfil.esp_mm;
    // Costura de cierre del aro: la solera se suelda a tope en una sola sección (b); el ángulo en sus dos alas (2b).
    const seccion_cierre = perfil.tipo === 'SOLERA' ? b : 2 * b;
    if (ext.forma === 'REDONDA') {
      const D = ext.D_ext_mm;
      const Dre = D + 2 * b;
      return {
        L_aro_mm: PI * (D + 2 * c) + holgura_mm + (puntas_mm || 0), // + las puntas que la roladora no curva (se cortan)
        P_perno_mm: PI * (D + 2 * g),
        L_cierre_mm: seccion_cierre,
        A_pintura_m2: ((PI / 2) * (Dre * Dre - D * D) + PI * Dre * t) / 1e6,
      };
    }
    const a = ext.a_ext_mm;
    const h = ext.b_ext_mm;
    return {
      L_aro_mm: 2 * (a + h) + 8 * c + 4 * holgura_mm,
      P_perno_mm: 2 * (a + h) + 8 * g,
      L_cierre_mm: 4 * seccion_cierre,
      A_pintura_m2: (2 * ((a + 2 * b) * (h + 2 * b) - a * h) + 2 * ((a + 2 * b) + (h + 2 * b)) * t) / 1e6,
    };
  }

  /**
   * Herrajes de unión por unidad de partida.
   *   BRIDADO: aros (solera o ángulo) + tornillería + la junta de la cara de la brida (+ sellador según clase). Toda brida sale de
   *            taller como aro terminado (rolado, con el cierre soldado, barrenado y pintado). Las de taller (`PF.extremos`) además
   *            se arman y se sueldan al ducto; las SUELTAS (`PF.extremos_sueltos`) no se unen al ducto: se mandan con sus tornillos
   *            y el material de su junta para soldarlas en obra donde se corta el tramo.
   *            La junta (`uniones.BRIDADO.junta`) es SELLADOR —el taller pone Sikaflex en lugar del empaque: un cordón de
   *            `ml_sellador_junta_m` mL por metro sobre el círculo de barrenos, que es también el sello de la junta transversal (no
   *            se suma el cordón de la clase C en esa junta)— o EMPAQUE (cinta de neopreno, y aparte el cordón de la clase).
   *   ESPIGA : prolongación macho + fijaciones + sellador.
   *   LISO   : sin herraje.
   * Cada junta se comparte entre dos extremos: se asigna 0.5 junta de tornillería, de cordón de la junta (o empaque) y de sellador
   * por extremo.
   */
  function herrajes(PF, p, mat, e, M) {
    const tipo = p.tipo_union || 'BRIDADO';
    const U_ = M.herrajes.uniones[tipo];
    exigir(U_, `Tipo de unión desconocido: ${tipo}`);
    const clase = p.clase_sellado === undefined ? 'C' : p.clase_sellado;
    exigir(['NINGUNA', 'A', 'B', 'C'].includes(clase), `Clase de sellado desconocida: ${clase}`);

    const out = {
      tipo_union: tipo,
      clase_sellado: clase,
      n_aros: 0,
      aros: [],
      L_aros_m: 0,
      m_aros_neta_kg: 0,
      m_aros_bruta_kg: 0,
      aros_sueltos: [], // aros terminados que el taller manda sueltos (sin unirlos al ducto) para soldarlos en obra
      m_aros_sueltos_neta_kg: 0,
      m_aros_sueltos_bruta_kg: 0,
      tornillos_por_tipo: {},
      n_tornillos_asignados: 0,
      n_barrenos: 0,
      n_juntas_asignadas: 0,
      junta: null, // con qué se sella la cara de la brida: SELLADOR o EMPAQUE (sólo BRIDADO)
      L_empaque_m: 0,
      L_junta_sellador_m: 0, // cordón de sellador sobre el círculo de barrenos, en lugar del empaque
      V_sellador_junta_ml: 0,
      L_sellado_m: 0,
      V_sellador_ml: 0,
      n_espigas: 0,
      n_fijaciones: 0,
      A_espiga_m2: 0,
      L_corte_extra_m: 0,
      sold_aros: { filete_m: 0, cierres: [] }, // cierres: costura a tope del aro, con el espesor del PERFIL (no el de la lámina)
      A_pintura_aros_m2: 0,
    };

    if (tipo === 'BRIDADO') {
      const holgura = M.proceso.aros.holgura_corte_mm;
      const conSellador = (U_.junta || 'EMPAQUE') === 'SELLADOR';
      out.junta = conSellador ? 'SELLADOR' : 'EMPAQUE';
      // Una brida del extremo `ext`. Toda brida se fabrica como aro terminado —se rola la solera, se suelda el cierre del aro, se
      // barrena y se pinta— y lleva el material de su media junta: tornillería y cordón de Sikaflex (o empaque). La de taller
      // además se arma y se suelda al ducto y, con empaque, sella su media junta con el cordón de la clase. La SUELTA sale igual
      // de terminada pero no se une al ducto (ahí se corta y se ajusta en campo): sin ajuste, sin filete aro–ducto y sin el cordón
      // de la clase (la junta se arma en obra).
      const brida = (ext, suelta) => {
        const dim_mayor = ext.forma === 'REDONDA' ? ext.D_ext_mm : Math.max(ext.a_ext_mm, ext.b_ext_mm);
        const perfil = seleccionarPerfil(M, dim_mayor, p.perfil_id);
        const g = geometriaAro(ext, perfil, holgura, M.proceso.aros.puntas_rolado_mm);
        const n_raw = Math.ceil(g.P_perno_mm / U_.paso_tornillo_mm - 1e-9);
        const n_tornillos = U.techoMultiplo(Math.max(U_.n_min_tornillos, n_raw), U_.multiplo_tornillos);
        const L_aro_m = g.L_aro_mm / 1000;
        const m_aro = L_aro_m * perfil.peso_kg_m;
        const aro = {
          perfil_id: perfil.id, tipo: perfil.tipo, descripcion: perfil.descripcion, ancho_mm: perfil.ancho_mm, esp_mm: perfil.esp_mm,
          tornillo: perfil.tornillo, tornillo_desc: perfil.tornillo_desc || perfil.tornillo, diam_barreno_mm: perfil.diam_barreno_mm, barreno_desc: perfil.barreno_desc,
          precio_ref: perfil.precio_ref, L_aro_mm: g.L_aro_mm, P_perno_mm: g.P_perno_mm, n_tornillos,
          m_aro_kg: m_aro, m_aro_bruta_kg: m_aro / (1 - M.merma.PERFIL), c_centroide_mm: perfil.c_centroide_mm, gramil_mm: perfil.gramil_mm, peso_kg_m: perfil.peso_kg_m,
          suelta,
        };
        // Material de la junta que lleva toda brida: media tornillería y medio cordón de la junta o medio empaque (la otra mitad es
        // del extremo con que se une)
        out.tornillos_por_tipo[perfil.tornillo] = (out.tornillos_por_tipo[perfil.tornillo] || 0) + 0.5 * n_tornillos;
        out.n_tornillos_asignados += 0.5 * n_tornillos;
        out.n_juntas_asignadas += 0.5;
        if (p.usa_empaque !== false) {
          if (conSellador) out.L_junta_sellador_m += (0.5 * g.P_perno_mm) / 1000;
          else out.L_empaque_m += (0.5 * g.P_perno_mm * (1 + U_.f_traslape_empaque)) / 1000;
        }
        // Fabricación del aro (toda brida): barrenos, cierre soldado del aro y pintura
        out.n_barrenos += n_tornillos;
        out.sold_aros.cierres.push({ L_m: g.L_cierre_mm / 1000, esp_mm: perfil.esp_mm });
        out.A_pintura_aros_m2 += g.A_pintura_m2;
        if (suelta) {
          out.aros_sueltos.push(aro);
          out.m_aros_sueltos_neta_kg += m_aro;
          out.m_aros_sueltos_bruta_kg += aro.m_aro_bruta_kg;
          return;
        }
        // Unión al ducto (sólo la brida de taller): ajuste del aro, filete aro–ducto y media junta de sellador
        out.aros.push(aro);
        out.n_aros += 1;
        out.L_aros_m += L_aro_m;
        out.m_aros_neta_kg += m_aro;
        // con la junta de sellador, ese cordón ya sella la junta transversal: no se suma el de la clase C
        if (clase !== 'NINGUNA' && !(conSellador && p.usa_empaque !== false)) out.L_sellado_m += (0.5 * ext.P_ext_mm) / 1000;
        out.sold_aros.filete_m += (U_.f_cont_soldadura_aro * ext.P_ext_mm) / 1000;
      };
      PF.extremos.forEach((ext) => brida(ext, false));
      (PF.extremos_sueltos || []).forEach((ext) => brida(ext, true));
      out.m_aros_bruta_kg = out.aros.reduce((acc, a) => acc + a.m_aro_bruta_kg, 0);
    }

    if (tipo === 'ESPIGA') {
      const n_esp = p.n_espigas === undefined ? PF.espigas_defecto : Math.min(p.n_espigas, PF.extremos.length);
      const prof = U_.prof_espiga_mm;
      PF.extremos.slice(0, n_esp).forEach((ext) => {
        out.n_espigas += 1;
        out.A_espiga_m2 += (ext.P_med_mm * prof) / 1e6;
        out.L_corte_extra_m += (2 * prof) / 1000;
        out.n_fijaciones += Math.max(U_.n_min_fijaciones, Math.ceil(ext.P_ext_mm / U_.paso_fijacion_mm - 1e-9));
        out.n_juntas_asignadas += 1;
        if (clase !== 'NINGUNA') out.L_sellado_m += ext.P_ext_mm / 1000;
      });
    }

    // Sellado por clase (SMACNA): C = juntas transversales (también las engargoladas entre yardas); B = C + costuras longitudinales
    // no soldadas; A = B + penetraciones.
    if (clase !== 'NINGUNA') out.L_sellado_m += PF.engargolado_circ_m;
    if (clase === 'B' || clase === 'A') out.L_sellado_m += PF.engargolado_long_m;
    if (clase === 'A') out.L_sellado_m += p.L_penetraciones_m || 0;
    const S = M.herrajes.sellador;
    if (out.L_junta_sellador_m > 0) out.V_sellador_junta_ml = out.L_junta_sellador_m * U_.ml_sellador_junta_m * (1 + S.f_merma);
    out.V_sellador_ml = out.L_sellado_m * S.ml_por_m * (1 + S.f_merma) + out.V_sellador_junta_ml;
    return out;
  }

  /** Dónde va instalado el ducto; de eso depende el sistema de pintura. */
  const UBICACIONES = ['INTERIOR', 'EXTERIOR'];

  /**
   * Superficie a pintar y manos de pintura, por PARTE: el cuerpo del ducto y los aros de brida (los de taller y los sueltos).
   * El sistema de cada parte sale de:
   *   · la partida, si pide uno (`pintura`): vale para todo lo que se pinta;
   *   · si no, el del material según dónde va instalado el ducto (`ubicacion`: interior o exterior): `pintura_cuerpo` para el
   *     ducto y `pintura_bridas` para los aros. Regla del taller: el acero al carbón se pinta (interior: sólo pintura; exterior:
   *     primario y pintura); el galvanizado no se pinta más que las bridas; el inoxidable no se pinta.
   * `caras_pintadas` (1 ó 2) cuenta las caras del ducto que se pintan; los aros llevan sus dos caras y el canto.
   * Devuelve { ubicacion, sistema (del cuerpo), sistema_bridas, capas (manos distintas que se aplican), caras, A_pint_m2,
   * partes: [{ id: 'cuerpo' | 'bridas', sistema, capas, A_m2 }] }.
   */
  function pintura(PF, her, p, mat, M) {
    const P = M.proceso.pintura;
    const ubicacion = p.ubicacion || P.ubicacion_defecto || 'INTERIOR';
    exigir(UBICACIONES.includes(ubicacion), `La ubicación de la instalación «${ubicacion}» no existe (use ${UBICACIONES.join(', ')}).`);
    const delMaterial = (campo) => (mat[campo] && mat[campo][ubicacion]) || 'NINGUNA';
    const caras = p.caras_pintadas === 2 ? 2 : 1;
    const parte = (id, sistema, A_m2) => {
      const capas = P.sistemas[sistema];
      exigir(capas, `Sistema de pintura desconocido: ${sistema}`);
      return { id, sistema, capas, A_m2: capas.length ? A_m2 : 0 };
    };
    const partes = [
      parte('cuerpo', p.pintura || delMaterial('pintura_cuerpo'), PF.A_ext_m2 * caras),
      parte('bridas', p.pintura || delMaterial('pintura_bridas'), her.A_pintura_aros_m2),
    ];
    const manos = [];
    partes.forEach((x) => x.capas.forEach((c) => { if (!manos.includes(c)) manos.push(c); }));
    return {
      ubicacion,
      sistema: partes[0].sistema,
      sistema_bridas: partes[1].sistema,
      capas: manos,
      caras,
      A_pint_m2: partes.reduce((s, x) => s + x.A_m2, 0),
      partes,
    };
  }

  return {
    UBICACIONES, espesorMm, perfilDerivado, seleccionarPerfil, lamina, geometriaAro, herrajes, pintura,
  };
}));
