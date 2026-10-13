/**
 * Vocabulary for farm records: kinds, statuses, sources, and the fields of each kind.
 * This is the single source of truth. Validation, forms, tables and (later) the
 * extraction agent are all derived from KIND_FIELDS. The database CHECK constraints
 * mirror these lists, and a test keeps them in sync.
 */

export const RECORD_KINDS = Object.freeze([
  'activity', 'purchase', 'note', 'seed', 'planting', 'amendment', 'harvest', 'input', 'inventory',
]);

/** draft/needs_info: still being completed · pending_review: waiting for an owner/manager · voided: withdrawn, never deleted. */
export const RECORD_STATUSES = Object.freeze(['draft', 'needs_info', 'pending_review', 'approved', 'rejected', 'voided']);

export const RECORD_SOURCES = Object.freeze(['manual', 'web_upload', 'telegram', 'whatsapp', 'email', 'import']);

export const OMRI_STATUSES = Object.freeze(['listed', 'not_listed', 'unknown', 'not_applicable']);

const opt = (value, en, es) => Object.freeze({ value, en, es });
const field = (key, type, en, es, extra = {}) => Object.freeze({ key, type, label: Object.freeze({ en, es }), ...extra });

const OMRI_OPTIONS = Object.freeze([
  opt('listed', 'OMRI listed', 'Listado en OMRI'),
  opt('not_listed', 'Not listed', 'No listado'),
  opt('unknown', 'Unknown', 'Desconocido'),
  opt('not_applicable', 'Not applicable', 'No aplica'),
]);

const AREA_UNITS = Object.freeze([opt('acre', 'Acres', 'Acres'), opt('hectare', 'Hectares', 'Hectáreas'), opt('sq_ft', 'Sq ft', 'Pies²')]);

const omriField = () => field('omri_status', 'select', 'OMRI status', 'Estado OMRI', { options: OMRI_OPTIONS });
const notesField = () => field('notes', 'textarea', 'Notes', 'Notas');

export const KIND_FIELDS = Object.freeze({
  activity: Object.freeze([
    field('activity_type', 'select', 'Activity type', 'Tipo de actividad', {
      required: true,
      options: [
        opt('spray', 'Spray', 'Aplicación (spray)'),
        opt('irrigation', 'Irrigation', 'Riego'),
        opt('cultivation', 'Cultivation', 'Cultivo / labranza'),
        opt('scouting', 'Scouting', 'Monitoreo'),
        opt('pruning', 'Pruning', 'Poda'),
        opt('mowing', 'Mowing', 'Siega'),
        opt('other', 'Other', 'Otro'),
      ],
    }),
    field('field', 'text', 'Field / block', 'Campo / bloque', { required: true }),
    field('product', 'text', 'Product', 'Producto', { requiredWhen: { activity_type: 'spray' } }),
    field('rate', 'text', 'Mix rate', 'Dosis de mezcla', { requiredWhen: { activity_type: 'spray' } }),
    field('target', 'text', 'Target pest / disease', 'Plaga o enfermedad objetivo', { requiredWhen: { activity_type: 'spray' } }),
    field('area', 'number', 'Area', 'Superficie'),
    field('area_unit', 'select', 'Area unit', 'Unidad de superficie', { options: AREA_UNITS }),
    field('applicator', 'text', 'Applicator', 'Aplicador'),
    field('equipment', 'text', 'Equipment', 'Equipo'),
    omriField(),
    notesField(),
  ]),
  purchase: Object.freeze([
    field('supplier', 'text', 'Supplier', 'Proveedor', { required: true }),
    field('product', 'text', 'Product', 'Producto', { required: true }),
    field('category', 'select', 'Category', 'Categoría', {
      options: [
        opt('fertilizer', 'Fertilizer', 'Fertilizante'),
        opt('pest_control', 'Pesticide / herbicide', 'Pesticida / herbicida'),
        opt('seed', 'Seed / transplant', 'Semilla / trasplante'),
        opt('amendment', 'Soil amendment', 'Enmienda del suelo'),
        opt('cover_crop', 'Cover crop', 'Cultivo de cobertura'),
        opt('equipment', 'Equipment', 'Equipo'),
        opt('livestock_feed', 'Livestock feed', 'Alimento para ganado'),
        opt('other', 'Other input', 'Otro insumo'),
      ],
    }),
    omriField(),
    field('quantity', 'number', 'Quantity', 'Cantidad'),
    field('unit', 'text', 'Unit', 'Unidad'),
    field('total_cost', 'number', 'Total cost', 'Costo total'),
    field('invoice_number', 'text', 'Invoice #', 'N.º de factura'),
    notesField(),
  ]),
  note: Object.freeze([
    field('text', 'textarea', 'Note', 'Nota', { required: true }),
    field('category', 'select', 'Category', 'Categoría', {
      options: [
        opt('general', 'General', 'General'),
        opt('observation', 'Observation', 'Observación'),
        opt('inspection', 'Inspection', 'Inspección'),
        opt('training', 'Training', 'Capacitación'),
        opt('other', 'Other', 'Otro'),
      ],
    }),
  ]),
  seed: Object.freeze([
    field('crop', 'text', 'Crop', 'Cultivo', { required: true }),
    field('variety', 'text', 'Variety', 'Variedad', { required: true }),
    field('supplier', 'text', 'Supplier', 'Proveedor'),
    field('lot_number', 'text', 'Lot number', 'N.º de lote'),
    field('quantity', 'number', 'Quantity', 'Cantidad'),
    field('unit', 'text', 'Unit', 'Unidad'),
    field('organic_status', 'select', 'Seed status', 'Estado de la semilla', {
      options: [
        opt('organic', 'Certified organic', 'Orgánica certificada'),
        opt('untreated', 'Untreated, non-organic', 'Sin tratar, no orgánica'),
        opt('treated', 'Treated', 'Tratada'),
        opt('unknown', 'Unknown', 'Desconocido'),
      ],
    }),
    notesField(),
  ]),
  planting: Object.freeze([
    field('crop', 'text', 'Crop', 'Cultivo', { required: true }),
    field('variety', 'text', 'Variety', 'Variedad'),
    field('field', 'text', 'Field / block', 'Campo / bloque', { required: true }),
    field('area', 'number', 'Area', 'Superficie'),
    field('area_unit', 'select', 'Area unit', 'Unidad de superficie', { options: AREA_UNITS }),
    field('method', 'select', 'Method', 'Método', {
      options: [opt('direct_seed', 'Direct seeded', 'Siembra directa'), opt('transplant', 'Transplant', 'Trasplante'), opt('other', 'Other', 'Otro')],
    }),
    field('seed_lot', 'text', 'Seed lot', 'Lote de semilla'),
    notesField(),
  ]),
  amendment: Object.freeze([
    field('material', 'text', 'Material', 'Material', { required: true }),
    field('field', 'text', 'Field / block', 'Campo / bloque', { required: true }),
    field('rate', 'text', 'Application rate', 'Dosis de aplicación'),
    field('quantity', 'number', 'Quantity', 'Cantidad'),
    field('unit', 'text', 'Unit', 'Unidad'),
    field('method', 'select', 'Method', 'Método', {
      options: [
        opt('broadcast', 'Broadcast', 'Al voleo'),
        opt('banded', 'Banded', 'En banda'),
        opt('fertigation', 'Fertigation', 'Fertirriego'),
        opt('foliar', 'Foliar', 'Foliar'),
        opt('other', 'Other', 'Otro'),
      ],
    }),
    field('supplier', 'text', 'Supplier', 'Proveedor'),
    field('lot_number', 'text', 'Lot number', 'N.º de lote'),
    omriField(),
    notesField(),
  ]),
  harvest: Object.freeze([
    field('crop', 'text', 'Crop', 'Cultivo', { required: true }),
    field('field', 'text', 'Field / block', 'Campo / bloque', { required: true }),
    field('quantity', 'number', 'Quantity', 'Cantidad', { required: true }),
    field('unit', 'text', 'Unit', 'Unidad', { required: true }),
    field('lot_number', 'text', 'Lot number', 'N.º de lote'),
    field('destination', 'text', 'Destination / buyer', 'Destino / comprador'),
    notesField(),
  ]),
  input: Object.freeze([
    field('product', 'text', 'Product', 'Producto', { required: true }),
    field('category', 'select', 'Category', 'Categoría', {
      options: [
        opt('fertilizer', 'Fertilizer', 'Fertilizante'),
        opt('pest_control', 'Pest control', 'Control de plagas'),
        opt('seed_treatment', 'Seed treatment', 'Tratamiento de semilla'),
        opt('cleaner', 'Cleaner / sanitizer', 'Limpiador / desinfectante'),
        opt('other', 'Other', 'Otro'),
      ],
    }),
    field('manufacturer', 'text', 'Manufacturer', 'Fabricante'),
    field('supplier', 'text', 'Supplier', 'Proveedor'),
    field('active_ingredients', 'textarea', 'Active ingredients', 'Ingredientes activos'),
    omriField(),
    field('omri_listing_number', 'text', 'OMRI listing #', 'N.º de listado OMRI'),
    notesField(),
  ]),
  inventory: Object.freeze([
    field('item', 'text', 'Item', 'Artículo', { required: true }),
    field('quantity', 'number', 'Quantity on hand', 'Cantidad disponible', { required: true }),
    field('unit', 'text', 'Unit', 'Unidad', { required: true }),
    field('location', 'text', 'Location', 'Ubicación'),
    field('lot_number', 'text', 'Lot number', 'N.º de lote'),
    notesField(),
  ]),
});

const meta = (en, es, pluralEn, pluralEs, icon, color) =>
  Object.freeze({ label: Object.freeze({ en, es }), plural: Object.freeze({ en: pluralEn, es: pluralEs }), icon, color });

/** Display metadata. `icon` names a lucide-react icon; `plural` is the page title. */
export const KIND_META = Object.freeze({
  activity: meta('Activity', 'Actividad', 'Activities', 'Actividades', 'ListChecks', '#0ea5e9'),
  purchase: meta('Purchase', 'Compra', 'Purchases', 'Compras', 'ShoppingCart', '#ec4899'),
  note: meta('Note', 'Nota', 'Notes', 'Notas', 'StickyNote', '#64748b'),
  seed: meta('Seed record', 'Registro de semilla', 'Seed Log', 'Registro de Semillas', 'Sprout', '#84cc16'),
  planting: meta('Planting', 'Siembra', 'Planting Log', 'Registro de Siembra', 'CalendarDays', '#22c55e'),
  amendment: meta('Amendment', 'Enmienda', 'Amendment Log', 'Registro de Enmiendas', 'Droplets', '#14b8a6'),
  harvest: meta('Harvest', 'Cosecha', 'Harvest Log', 'Registro de Cosecha', 'Wheat', '#f59e0b'),
  input: meta('Input', 'Insumo', 'Input List', 'Lista de Insumos', 'Package', '#8b5cf6'),
  inventory: meta('Inventory item', 'Artículo de inventario', 'Inventory', 'Inventario', 'Boxes', '#f97316'),
});

/**
 * Keys of the fields that must be filled before a record can be reviewed, given what is
 * known so far. Some fields are required only in some cases (e.g. a spray needs a product,
 * a mix rate and a target pest); that is exactly what the agent asks about.
 *
 * @param {string} kind
 * @param {Record<string, unknown>} payload
 * @returns {string[]}
 */
export function requiredFieldKeys(kind, payload) {
  return KIND_FIELDS[kind]
    .filter((f) => f.required || (f.requiredWhen && Object.entries(f.requiredWhen).every(([k, v]) => payload?.[k] === v)))
    .map((f) => f.key);
}

/**
 * @param {string} kind
 * @param {string} fieldKey
 * @param {string} value
 * @param {'en' | 'es'} lang
 * @returns {string} the localized option label, or the raw value if unknown
 */
export function optionLabel(kind, fieldKey, value, lang) {
  const found = KIND_FIELDS[kind]?.find((f) => f.key === fieldKey)?.options?.find((o) => o.value === value);
  return found ? found[lang === 'es' ? 'es' : 'en'] : value;
}
