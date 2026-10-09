/**
 * Validador mínimo de JSON Schema para las pruebas: $ref, anyOf, const, enum, type, required, properties,
 * additionalProperties, items, minItems, minimum, maximum, multipleOf y pattern. Devuelve la lista de errores (vacía si cumple).
 */
'use strict';

function validarEsquema(valor, esquema) {
  const validar = (v, s, ruta, errores) => {
    if (s.$ref) return validar(v, s.$ref.split('/').slice(1).reduce((o, k) => o[k], esquema), ruta, errores);
    if (s.anyOf) {
      if (!s.anyOf.some((alt) => !validar(v, alt, ruta, []).length)) errores.push(`${ruta}: no cumple ninguna alternativa`);
      return errores;
    }
    if (s.const !== undefined && v !== s.const) errores.push(`${ruta}: ${JSON.stringify(v)} ≠ ${JSON.stringify(s.const)}`);
    const tipos = s.type === undefined ? null : [].concat(s.type);
    const tipoDe = (x) => (x === null ? 'null' : Array.isArray(x) ? 'array' : Number.isInteger(x) ? 'integer' : typeof x);
    if (tipos && !tipos.some((t) => t === tipoDe(v) || (t === 'number' && tipoDe(v) === 'integer'))) { errores.push(`${ruta}: tipo ${tipoDe(v)}, se esperaba ${tipos}`); return errores; }
    if (s.enum && !s.enum.includes(v)) errores.push(`${ruta}: ${JSON.stringify(v)} no está en ${JSON.stringify(s.enum)}`);
    if (typeof v === 'number') {
      if (s.minimum !== undefined && v < s.minimum) errores.push(`${ruta}: ${v} < ${s.minimum}`);
      if (s.maximum !== undefined && v > s.maximum) errores.push(`${ruta}: ${v} > ${s.maximum}`);
      if (s.multipleOf !== undefined && Math.abs(v / s.multipleOf - Math.round(v / s.multipleOf)) > 1e-9) errores.push(`${ruta}: ${v} no es múltiplo de ${s.multipleOf}`);
    }
    if (typeof v === 'string' && s.pattern && !new RegExp(s.pattern).test(v)) errores.push(`${ruta}: «${v}» no cumple ${s.pattern}`);
    if (Array.isArray(v)) {
      if (s.minItems !== undefined && v.length < s.minItems) errores.push(`${ruta}: menos de ${s.minItems} elementos`);
      if (s.items) v.forEach((x, i) => validar(x, s.items, `${ruta}[${i}]`, errores));
    }
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      (s.required || []).forEach((k) => { if (!(k in v)) errores.push(`${ruta}: falta ${k}`); });
      Object.keys(v).forEach((k) => {
        if (s.properties && s.properties[k]) validar(v[k], s.properties[k], `${ruta}.${k}`, errores);
        else if (s.additionalProperties === false) errores.push(`${ruta}: sobra ${k}`);
      });
    }
    return errores;
  };
  return validar(valor, esquema, '$', []);
}

module.exports = { validarEsquema };
