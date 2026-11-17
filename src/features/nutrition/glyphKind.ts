import type { FoodKind, FoodSource } from '../../db/catalogTypes'

/** The kinds of food glyph a row can show (V3.1 contract 3). `generic` is the fallback. */
export type GlyphKind =
  | 'grain' | 'meat' | 'poultry' | 'fish' | 'egg' | 'dairy' | 'fruit' | 'vegetable' | 'legume'
  | 'nut' | 'fat' | 'sweet' | 'drink' | 'dish' | 'packaged' | 'recipe' | 'generic'

export const GLYPH_KINDS: readonly GlyphKind[] = [
  'grain', 'meat', 'poultry', 'fish', 'egg', 'dairy', 'fruit', 'vegetable', 'legume', 'nut', 'fat', 'sweet', 'drink', 'dish', 'packaged', 'recipe', 'generic',
]

export interface GlyphInput {
  name: string
  nameOrig?: string
  category: string | null
  kind: FoodKind
  source: FoodSource
  brand?: string | null
}

const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()

/**
 * Keyword rules, tried in order against the food's name (Spanish, then original) and then its category.
 * Order matters: "jugo de naranja" is a drink before it is a fruit; "yogur de fresa" is dairy; "pechuga de pollo" is poultry.
 * Words are matched folded (no accents) and whole.
 */
const RULES: readonly [GlyphKind, RegExp][] = [
  ['drink', /\b(jugo|jugos|zumo|bebida|bebidas|gaseosa|refresco|cafe|te|infusion|batido|licor|licores|cerveza|vino|agua mineral|agua saborizada|soda|energizante|caldo|limonada|drink|juice|coffee|tea|beverages?)\b/],
  ['egg', /\b(huevo|huevos|omelet|omelette|clara|yema|egg|eggs)\b/],
  ['fish', /\b(pescado|pescados|atun|salmon|trucha|tilapia|sardina|sardinas|bacalao|camaron|camarones|mariscos?|calamar|pulpo|langosta|cangrejo|almeja|ostra|mojarra|merluza|fish|tuna|shrimp|crab)\b/],
  ['poultry', /\b(pollo|pavo|pato|gallina|pechuga|muslo|contramuslo|alas?|chicken|turkey|aves)\b/],
  ['dish', /\b(pizza|hamburguesa|sandwich|sandwiches|sopa|sopas|ensalada|ensaladas|burrito|burritos|taco|tacos|empanada|empanadas|plato|platos|guiso|estofado|lasana|lasagna|sushi|salsa|salsas|comida|comidas|restaurante|mixto|mixtos)\b/],
  ['dairy', /\b(leche|yogur|yogurt|yoghurt|queso|quesos|kumis|kefir|crema|cuajada|requeson|lacteo|lacteos|helado|helados|milk|cheese|dairies|dairy)\b/],
  ['nut', /\b(mani|almendra|almendras|nuez|nueces|pistacho|pistachos|avellana|avellanas|maranon|semilla|semillas|chia|linaza|ajonjoli|girasol|castana|coco|nuts?|seeds?)\b/],
  ['legume', /\b(frijol|frijoles|lenteja|lentejas|garbanzo|garbanzos|arveja|arvejas|haba|habas|soya|soja|leguminosas?|alubia|alubias|beans?|lentils?|chickpeas?)\b/],
  ['fat', /\b(aceite|aceites|manteca|margarina|mantequilla|grasa|grasas|aderezo|aderezos|mayonesa|tocino|oil|butter|lard)\b/],
  ['sweet', /\b(galleta|galletas|dulce|dulces|chocolate|chocolates|azucar|miel|mermelada|torta|tortas|pastel|pasteles|ponque|brownie|dona|donas|bizcocho|bizcochos|muffin|caramelo|caramelos|golosina|postre|postres|arequipe|bombon|confites?|snacks?|pasabocas|chips|candy|cookies?|cake|desserts?|sweeteners?|sweets)\b/],
  ['fruit', /\b(manzana|banano|banana|platano|naranja|mandarina|limon|fresa|fresas|mora|uva|uvas|pera|durazno|melocoton|mango|papaya|pina|sandia|melon|kiwi|guayaba|maracuya|lulo|granadilla|aguacate|cereza|ciruela|higo|fruta|frutas|arandano|arandanos|fruit|apple|orange|plums?)\b/],
  ['vegetable', /\b(verdura|verduras|hortaliza|hortalizas|lechuga|espinaca|espinacas|tomate|cebolla|zanahoria|brocoli|coliflor|pepino|pimenton|apio|repollo|col|calabacin|berenjena|champinon|champinones|hongos?|esparrago|esparragos|ajo|remolacha|acelga|ahuyama|calabaza|auyama|vainitas?|vegetables?|vegetal)\b/],
  ['grain', /\b(arroz|pasta|pastas|espagueti|espaguetis|fideos?|macarron|macarrones|avena|pan|panes|tostada|tostadas|arepa|arepas|tortilla|tortillas|cereal|cereales|trigo|cebada|quinua|quinoa|harina|harinas|papa|papas|yuca|almidon|granola|bagel|bagels|panaderia|panecillos?|centeno|maiz|cuscus|couscous|rice|bread|oats?|flour|cereals?|grains?|potato|potatoes)\b/],
  ['meat', /\b(carne|carnes|res|cerdo|cordero|ternera|lomo|costilla|costillas|bistec|chuleta|jamon|salchicha|salchichas|chorizo|tocineta|embutido|embutidos|higado|morcilla|pernil|solomillo|beef|pork|lamb|veal|ham|sausage|bacon|meats?)\b/],
]

/** The glyph kind of a food: recipe by source, then name keywords, then category text, then source and kind. */
export function foodGlyph(food: GlyphInput): GlyphKind {
  if (food.kind === 'recipe' || food.source === 'recipe') return 'recipe'
  const byName = fold(`${food.name} ${food.nameOrig && food.nameOrig !== food.name ? food.nameOrig : ''}`)
  for (const [kind, re] of RULES) if (re.test(byName)) return kind
  const byCategory = fold(food.category ?? '')
  if (byCategory) for (const [kind, re] of RULES) if (re.test(byCategory)) return kind
  if (food.source === 'off' || food.kind === 'packaged' || food.source === 'label' || food.brand) return 'packaged'
  if (food.kind === 'prepared') return 'dish'
  return 'generic'
}
