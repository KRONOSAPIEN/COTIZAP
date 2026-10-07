/**
 * COTIZAP · compras.js — Lista de compras de una cotización: lo que hay que comprar, en piezas enteras.
 *
 * El costo de cada partida usa la FRACCIÓN de material que consume (kg de lámina con su merma, metros de solera, juegos de
 * tornillos con reserva). En la compra real se pagan piezas enteras: hojas, barras de 6 m, tornillos por decena, cartuchos
 * y envases completos. Esta lista junta lo que piden todas las partidas y lo redondea:
 *
 *   hojas    = ⌈ Σ kg brutos ÷ kg de la hoja ⌉                     (por material, espesor y tamaño de hoja)
 *   barras   = acomodo de las piezas (aros de brida, piezas de soportería) en barras: primero las más largas, cada una en la
 *              primera barra donde quepa; un aro más largo que la barra se arma de varios tramos
 *   tornillos= ⌈ Σ juegos con reserva ÷ múltiplo ⌉ × múltiplo        (compras.tornillos_multiplo)
 *   sellador = ⌈ Σ mL ÷ mL del cartucho ⌉;  pintura = ⌈ Σ L ÷ envase ⌉ × envase   (compras.pintura_envase_L)
 *
 * El «sobrante» de cada renglón es lo que cuesta la compra entera menos lo que ya cobran las partidas (nunca negativo). La
 * cotización puede cobrarlo (`piezas_enteras`): cotizador.js lo agrega como una partida automática.
 * Cada renglón dice en qué categoría del control de gastos cae su compra (`categoria`, las de gastos.js): así la lista se
 * puede pasar a gastos y compararse renglón por renglón.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory(require('./util'), require('./precios'));
  } else {
    root.COTIZAP = root.COTIZAP || {};
    root.COTIZAP.compras = factory(root.COTIZAP.util, root.COTIZAP.precios);
  }
}(typeof self !== 'undefined' ? self : this, function (U, PRE) {
  'use strict';

  const EPS = 1e-9;
  const LARGO_BARRA_DEFECTO_MM = 6000; // un perfil sin barra en la lista del proveedor se compra en barras de 6 m

  /**
   * Acomoda piezas (mm) en barras de `largo` mm: primero las más largas, cada una en la primera barra donde quepa.
   * Una pieza más larga que la barra se arma de tramos: ocupa barras completas y su resto se acomoda como otra pieza.
   * Devuelve { barras, empalmes, usado_mm, sobra_mm, cargas } (cargas: lo que lleva cada barra que no va completa, en mm).
   */
  function acomodar(piezas, largo) {
    const resto = [];
    let completas = 0;
    let empalmes = 0;
    piezas.forEach((L) => {
      if (!(L > 0)) return;
      if (L > largo + EPS) {
        const n = Math.floor(L / largo);
        completas += n;
        empalmes += 1;
        const r = L - n * largo;
        if (r > EPS) resto.push(r);
      } else resto.push(L);
    });
    resto.sort((a, b) => b - a);
    const libres = [];
    resto.forEach((L) => {
      const i = libres.findIndex((x) => x + EPS >= L);
      if (i >= 0) libres[i] -= L;
      else libres.push(largo - L);
    });
    const usado = piezas.reduce((s, L) => s + (L > 0 ? L : 0), 0);
    const barras = completas + libres.length;
    return { barras, empalmes, usado_mm: usado, sobra_mm: barras * largo - usado, completas, cargas: libres.map((x) => largo - x) };
  }

  const renglon = (o) => ({ ...o, sobrante: Math.max(0, o.importe_compra - o.costo_cotizado) });

  /** Lista de compras de las partidas calculadas (`filas` con ok: true). Pura: no muta nada. */
  function listaCompras(filas, M) {
    const ok = (filas || []).filter((f) => f && f.ok);
    const laminas = new Map();
    const barras = new Map();
    const tornillos = new Map();
    const pintura = new Map();
    const anclajes = new Map();
    const soldadura = new Map();
    const comprados = [];
    let sellador = null;
    let empaque = null;
    let diluyente = null;

    const grupoBarra = (clave, base, uso) => {
      if (!barras.has(clave)) barras.set(clave, { ...base, piezas: [], costo_cotizado: 0, usos: new Set() });
      const g = barras.get(clave);
      g.usos.add(uso);
      return g;
    };

    ok.forEach((f) => {
      const n = f.entrada.cantidad;
      if (f.familia === 'COMPRADO') {
        comprados.push({
          descripcion: f.descripcion, cantidad: n, unidad: f.compra.unidad, unitario_sin_iva: f.compra.unitario_sin_iva, importe: f.costos.materiales.compra, categoria: f.compra.categoria || 'PROVEEDOR',
        });
        // lo comprado que se atornilla (una brida de placa) trae sus juegos de tornillería, con la reserva de las bridas
        if (f.compra.tornillos > 0) {
          const t = tornillos.get(f.compra.tornillo) || { tipo: f.compra.tornillo, exactos: 0, con_reserva: 0, precio: f.compra.precio_tornillo, costo_cotizado: 0 };
          t.exactos += f.compra.tornillos;
          t.con_reserva += f.compra.tornillos * (1 + f.compra.reserva_tornillos);
          t.costo_cotizado += f.costos.materiales.tornilleria;
          tornillos.set(f.compra.tornillo, t);
        }
        // y el material de su junta: el cordón de Sikaflex (o el empaque) sobre su círculo de barrenos
        if (f.compra.V_sellador_ml > 0) {
          const S = M.herrajes.sellador;
          sellador = sellador || { ml: 0, cartucho_ml: S.cartucho_ml, cartucho_sin_iva: PRE.precioDe(M, S.precio_cartucho_ref), costo_cotizado: 0 };
          sellador.ml += n * f.compra.V_sellador_ml;
          sellador.costo_cotizado += f.costos.materiales.sellador;
        }
        if (f.compra.L_empaque_m > 0) {
          empaque = empaque || { m: 0, costo: 0 };
          empaque.m += n * f.compra.L_empaque_m;
          empaque.costo += f.costos.materiales.empaque;
        }
        return;
      }
      if (f.familia === 'INSTALACION') return;
      if (f.familia === 'SOPORTE') {
        const s = f.soporte;
        const g = grupoBarra(s.barra.id, { id: s.barra.id, descripcion: s.barra.descripcion, largo_mm: s.barra.largo_mm, pieza_sin_iva: s.barra.sin_iva }, 'SOPORTE');
        for (let i = 0; i < n; i += 1) g.piezas.push(s.largo_pieza_mm);
        g.costo_cotizado += f.costos.materiales.perfil;
        if (s.anclajes > 0) {
          const a = anclajes.get(s.articulo_anclaje) || { id: s.articulo_anclaje, descripcion: s.anclaje.descripcion, unidad: s.anclaje.unidad, unitario_sin_iva: s.anclaje.unitario_sin_iva, cantidad: 0, costo: 0 };
          a.cantidad += s.anclajes;
          a.costo += f.costos.materiales.anclajes;
          anclajes.set(s.articulo_anclaje, a);
        }
        if (s.tornillos > 0) {
          const t = tornillos.get(s.tornillo) || { tipo: s.tornillo, exactos: 0, con_reserva: 0, precio: s.precio_tornillo, costo_cotizado: 0 };
          t.exactos += s.tornillos;
          t.con_reserva += s.tornillos;
          t.costo_cotizado += f.costos.materiales.tornilleria;
          tornillos.set(s.tornillo, t);
        }
        return;
      }
      const q = f.qto;
      if (!q) return;
      const pu = f.costos.precios_usados || {};
      // Lámina: hojas de la lista del proveedor, o la hoja estándar (o la del ancho de la yarda) al precio por kg de la tabla
      const pl = pu.lamina;
      if (pl && q.lam.m_bruta_kg > 0) {
        let g;
        if (pl.fuente === 'PROVEEDOR') {
          const h = M.proveedor.hojas[pl.id];
          g = laminas.get(pl.id) || { clave: pl.id, descripcion: pl.descripcion, medida: `${Math.round(h.ancho_mm)} × ${Math.round(h.largo_mm)} mm`, kg_hoja: pl.kg, hoja_sin_iva: pl.sin_iva, precio_kg: pl.precio_kg, kg: 0, costo_cotizado: 0 };
        } else {
          const ancho = (q.PF && q.PF.ancho_hoja_mm) || M.proceso.hoja.ancho_mm;
          const largo = M.proceso.hoja.largo_mm;
          const clave = `${f.entrada.material_id}|${q.e.toFixed(4)}|${ancho}`;
          const kg_hoja = (ancho / 1000) * (largo / 1000) * (q.e / 1000) * q.mat.densidad_kg_m3;
          g = laminas.get(clave) || {
            clave, descripcion: `${q.mat.nombre} · ${q.e.toFixed(2)} mm`, medida: `${Math.round(ancho)} × ${Math.round(largo)} mm`, kg_hoja, hoja_sin_iva: kg_hoja * pl.precio_kg, precio_kg: pl.precio_kg, kg: 0, costo_cotizado: 0,
          };
        }
        g.kg += n * q.lam.m_bruta_kg;
        g.costo_cotizado += f.costos.materiales.lamina;
        laminas.set(g.clave, g);
      }
      // Aros de brida: cada uno es una pieza de solera (o ángulo) que se acomoda en barras
      [...q.her.aros, ...q.her.aros_sueltos].forEach((a) => {
        const pp = (pu.perfiles || {})[a.perfil_id];
        const prov = pp && pp.fuente === 'PROVEEDOR' ? M.proveedor.barras[pp.id] : null;
        const clave = prov ? pp.id : `perfil:${a.perfil_id}`;
        const largo = prov ? Number(prov.largo_mm) : LARGO_BARRA_DEFECTO_MM;
        const pieza = prov ? pp.sin_iva : (a.peso_kg_m * largo / 1000) * (pp ? pp.precio_kg : 0);
        const g = grupoBarra(clave, { id: clave, descripcion: prov ? pp.descripcion : a.descripcion, largo_mm: largo, pieza_sin_iva: pieza }, 'BRIDA');
        for (let i = 0; i < n; i += 1) g.piezas.push(a.L_aro_mm);
        g.costo_cotizado += n * a.m_aro_bruta_kg * (pp ? pp.precio_kg : 0);
      });
      // Tornillería de las bridas (los juegos de la media junta de cada brida, con la reserva)
      const reserva = M.herrajes.uniones.BRIDADO.f_reserva_tornilleria;
      Object.keys(q.her.tornillos_por_tipo).forEach((tipo) => {
        const precio = PRE.precioDe(M, M.herrajes.tornillo_precio_ref[tipo]);
        const t = tornillos.get(tipo) || { tipo, exactos: 0, con_reserva: 0, precio, costo_cotizado: 0 };
        const exactos = n * q.her.tornillos_por_tipo[tipo];
        t.exactos += exactos;
        t.con_reserva += exactos * (1 + reserva);
        t.costo_cotizado += exactos * (1 + reserva) * precio;
        tornillos.set(tipo, t);
      });
      // Sellador, empaque, pintura y soldadura
      if (q.her.V_sellador_ml > 0) {
        const S = M.herrajes.sellador;
        sellador = sellador || { ml: 0, cartucho_ml: S.cartucho_ml, cartucho_sin_iva: PRE.precioDe(M, S.precio_cartucho_ref), costo_cotizado: 0 };
        sellador.ml += n * q.her.V_sellador_ml;
        sellador.costo_cotizado += f.costos.materiales.sellador;
      }
      if (q.her.L_empaque_m > 0) {
        empaque = empaque || { m: 0, costo: 0 };
        empaque.m += n * q.her.L_empaque_m;
        empaque.costo += f.costos.materiales.empaque;
      }
      const omitir = new Set(f.entrada.omitir_operaciones || []);
      if (!omitir.has('pintura')) {
        q.con.pintura.capas.forEach((c) => {
          if (!(c.litros > 0)) return;
          const precio = PRE.precioDe(M, c.precio_ref);
          const g = pintura.get(c.nombre) || { nombre: c.nombre, litros: 0, precio_L: precio, costo_cotizado: 0 };
          g.litros += n * c.litros;
          g.costo_cotizado += n * c.litros * precio;
          pintura.set(c.nombre, g);
        });
        if (q.con.pintura.L_diluyente > 0 && q.con.pintura.L_pintura > 0) {
          const precio = PRE.precioDe(M, M.proceso.pintura.diluyente_precio_ref);
          diluyente = diluyente || { nombre: 'diluyente', litros: 0, precio_L: precio, costo_cotizado: 0 };
          diluyente.litros += n * q.con.pintura.L_diluyente;
          diluyente.costo_cotizado += n * q.con.pintura.L_diluyente * precio;
        }
      }
      if (!omitir.has('soldadura') && q.con.soldadura.kg_alambre > 0) {
        const clave = `${q.mat.alambre_ref}|${q.mat.gas_ref}`;
        const g = soldadura.get(clave) || { alambre_ref: q.mat.alambre_ref, gas_ref: q.mat.gas_ref, kg_alambre: 0, m3_gas: 0, costo: 0 };
        g.kg_alambre += n * q.con.soldadura.kg_alambre;
        g.m3_gas += n * q.con.soldadura.V_gas_m3;
        g.costo += f.costos.consumibles.alambre + f.costos.consumibles.gas;
        soldadura.set(clave, g);
      }
    });

    /* Redondeo a piezas enteras */
    const filasLamina = [...laminas.values()].map((g) => {
      const hojas = Math.ceil(g.kg / g.kg_hoja - EPS);
      return renglon({
        grupo: 'lamina', categoria: 'MATERIAL', clave: g.clave, descripcion: g.descripcion, medida: g.medida, unidad: 'hoja',
        necesario: g.kg / g.kg_hoja, compra: hojas, kg: g.kg, kg_hoja: g.kg_hoja, unitario_sin_iva: g.hoja_sin_iva,
        importe_compra: hojas * g.hoja_sin_iva, costo_cotizado: g.costo_cotizado,
      });
    });
    const filasBarra = [...barras.values()].map((g) => {
      const a = acomodar(g.piezas, g.largo_mm);
      return renglon({
        // la barra que sólo lleva piezas de soportería es soportería; la de los aros (o compartida), material
        grupo: 'barra', categoria: g.usos.size === 1 && g.usos.has('SOPORTE') ? 'SOPORTERIA' : 'MATERIAL', clave: g.id, descripcion: g.descripcion, medida: `${U.redondear(g.largo_mm / 1000, 2)} m`, unidad: 'barra',
        necesario: a.usado_mm / g.largo_mm, compra: a.barras, piezas: g.piezas.length, empalmes: a.empalmes, metros: a.usado_mm / 1000, sobra_m: a.sobra_mm / 1000,
        unitario_sin_iva: g.pieza_sin_iva, importe_compra: a.barras * g.pieza_sin_iva, costo_cotizado: g.costo_cotizado,
      });
    });
    const mult = M.compras.tornillos_multiplo;
    const filasTornillo = [...tornillos.values()].map((t) => {
      const compra = Math.ceil(t.con_reserva / mult - EPS) * mult;
      return renglon({
        grupo: 'tornillo', categoria: 'MATERIAL', clave: t.tipo, descripcion: `Juego de tornillo ${t.tipo}`, unidad: 'juego', necesario: t.exactos, con_reserva: t.con_reserva, compra,
        unitario_sin_iva: t.precio, importe_compra: compra * t.precio, costo_cotizado: t.costo_cotizado,
      });
    });
    const filasSellador = sellador ? [renglon({
      grupo: 'sellador', categoria: 'MATERIAL', clave: 'sellador', descripcion: `Sellador (cartucho de ${sellador.cartucho_ml} mL)`, unidad: 'cartucho', ml: sellador.ml,
      necesario: sellador.ml / sellador.cartucho_ml, compra: Math.ceil(sellador.ml / sellador.cartucho_ml - EPS), unitario_sin_iva: sellador.cartucho_sin_iva,
      importe_compra: Math.ceil(sellador.ml / sellador.cartucho_ml - EPS) * sellador.cartucho_sin_iva, costo_cotizado: sellador.costo_cotizado,
    })] : [];
    const envase = M.compras.pintura_envase_L;
    const filasPintura = [...pintura.values(), ...(diluyente ? [diluyente] : [])].map((g) => {
      const litros = Math.ceil(g.litros / envase - EPS) * envase;
      return renglon({
        grupo: 'pintura', categoria: 'CONSUMIBLE', clave: g.nombre, descripcion: g.nombre === 'diluyente' ? 'Diluyente' : `Pintura: ${g.nombre}`, unidad: 'L', necesario: g.litros, compra: litros,
        unitario_sin_iva: g.precio_L, importe_compra: litros * g.precio_L, costo_cotizado: g.costo_cotizado,
      });
    });
    // Lo que ya se compra entero o por metro: se lista sin sobrante
    const filasEmpaque = empaque ? [renglon({
      grupo: 'empaque', categoria: 'MATERIAL', clave: 'empaque', descripcion: 'Empaque de neopreno', unidad: 'm', necesario: empaque.m, compra: empaque.m,
      unitario_sin_iva: empaque.m > 0 ? empaque.costo / empaque.m : 0, importe_compra: empaque.costo, costo_cotizado: empaque.costo,
    })] : [];
    const filasAnclaje = [...anclajes.values()].map((a) => renglon({
      grupo: 'anclaje', categoria: 'SOPORTERIA', clave: a.id, descripcion: a.descripcion, unidad: a.unidad, necesario: a.cantidad, compra: a.cantidad,
      unitario_sin_iva: a.unitario_sin_iva, importe_compra: a.costo, costo_cotizado: a.costo,
    }));
    const filasComprado = comprados.map((c, i) => renglon({
      grupo: 'comprado', categoria: c.categoria, clave: `comprado-${i}`, descripcion: c.descripcion, unidad: c.unidad, necesario: c.cantidad, compra: c.cantidad,
      unitario_sin_iva: c.unitario_sin_iva, importe_compra: c.importe, costo_cotizado: c.importe,
    }));
    const filasSoldadura = [...soldadura.values()].map((g) => ({
      grupo: 'soldadura', clave: `${g.alambre_ref}|${g.gas_ref}`, alambre_ref: g.alambre_ref, gas_ref: g.gas_ref, kg_alambre: g.kg_alambre, m3_gas: g.m3_gas, costo: g.costo,
    }));

    const renglones = [...filasLamina, ...filasBarra, ...filasTornillo, ...filasSellador, ...filasPintura, ...filasEmpaque, ...filasAnclaje, ...filasComprado];
    const suma = (k) => renglones.reduce((s, r) => s + r[k], 0);
    return {
      renglones,
      laminas: filasLamina, barras: filasBarra, tornillos: filasTornillo, sellador: filasSellador, pintura: filasPintura,
      empaque: filasEmpaque, anclajes: filasAnclaje, comprados: filasComprado, soldadura: filasSoldadura,
      costo_cotizado: suma('costo_cotizado'), importe_compra: suma('importe_compra'), sobrante: suma('sobrante'),
    };
  }

  return { acomodar, listaCompras, LARGO_BARRA_DEFECTO_MM };
}));
