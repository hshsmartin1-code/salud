"""Spanish translations for USDA FoodData Central categories and household-portion labels."""
from __future__ import annotations

import re

# SR Legacy / Foundation food categories (food_category.csv)
CATEGORY_ES = {
    'Dairy and Egg Products': 'Lácteos y huevos',
    'Spices and Herbs': 'Especias y hierbas',
    'Baby Foods': 'Alimentos infantiles',
    'Fats and Oils': 'Grasas y aceites',
    'Poultry Products': 'Aves de corral',
    'Soups, Sauces, and Gravies': 'Sopas, salsas y caldos',
    'Sausages and Luncheon Meats': 'Embutidos y carnes frías',
    'Breakfast Cereals': 'Cereales para el desayuno',
    'Fruits and Fruit Juices': 'Frutas y jugos de frutas',
    'Pork Products': 'Carne de cerdo',
    'Vegetables and Vegetable Products': 'Verduras y hortalizas',
    'Nut and Seed Products': 'Frutos secos y semillas',
    'Beef Products': 'Carne de res',
    'Beverages': 'Bebidas',
    'Finfish and Shellfish Products': 'Pescados y mariscos',
    'Legumes and Legume Products': 'Leguminosas',
    'Lamb, Veal, and Game Products': 'Cordero, ternera y carnes de caza',
    'Baked Products': 'Panadería y productos horneados',
    'Sweets': 'Dulces y azúcares',
    'Cereal Grains and Pasta': 'Cereales, granos y pastas',
    'Fast Foods': 'Comidas rápidas',
    'Meals, Entrees, and Side Dishes': 'Platos, entradas y acompañamientos',
    'Snacks': 'Pasabocas',
    'American Indian/Alaska Native Foods': 'Alimentos indígenas de Norteamérica',
    'Restaurant Foods': 'Comidas de restaurante',
    'Branded Food Products Database': 'Productos de marca',
    'Quality Control Materials': 'Materiales de control de calidad',
    'Alcoholic Beverages': 'Bebidas alcohólicas',
}

# FNDDS WWEIA food categories (wweia_food_category.csv)
WWEIA_ES = {
    'Milk, whole': 'Leche entera',
    'Milk, reduced fat': 'Leche semidescremada',
    'Milk, lowfat': 'Leche baja en grasa',
    'Milk, nonfat': 'Leche descremada',
    'Flavored milk, whole': 'Leche saborizada entera',
    'Flavored milk, reduced fat': 'Leche saborizada semidescremada',
    'Flavored milk, lowfat': 'Leche saborizada baja en grasa',
    'Flavored milk, nonfat': 'Leche saborizada descremada',
    'Milk shakes and other dairy drinks': 'Malteadas y otras bebidas lácteas',
    'Cheese': 'Quesos',
    'Cottage/ricotta cheese': 'Queso cottage y ricotta',
    'Yogurt, regular': 'Yogur',
    'Yogurt, Greek': 'Yogur griego',
    'Plant-based milk': 'Bebidas vegetales',
    'Plant-based yogurt': 'Yogur vegetal',
    'Beef, excludes ground': 'Carne de res (no molida)',
    'Ground beef': 'Carne de res molida',
    'Pork': 'Carne de cerdo',
    'Lamb, goat, game': 'Cordero, cabro y caza',
    'Liver and organ meats': 'Hígado y vísceras',
    'Chicken, whole pieces': 'Pollo en presas',
    'Chicken patties, nuggets and tenders': 'Pollo apanado, nuggets y deditos',
    'Turkey, duck, other poultry': 'Pavo, pato y otras aves',
    'Fish': 'Pescado',
    'Shellfish': 'Mariscos',
    'Eggs and omelets': 'Huevos y omelets',
    'Cold cuts and cured meats': 'Carnes frías y curadas',
    'Bacon': 'Tocineta',
    'Frankfurters': 'Salchichas tipo perro',
    'Sausages': 'Salchichas y embutidos',
    'Beans, peas, legumes': 'Fríjoles, arvejas y leguminosas',
    'Nuts and seeds': 'Frutos secos y semillas',
    'Soy and meat-alternative products': 'Soya y sustitutos de carne',
    'Meat mixed dishes': 'Platos mixtos con carne',
    'Poultry mixed dishes': 'Platos mixtos con pollo',
    'Seafood mixed dishes': 'Platos mixtos con pescado y mariscos',
    'Bean, pea, legume dishes': 'Platos de leguminosas',
    'Vegetable dishes': 'Platos de verduras',
    'Rice mixed dishes': 'Platos mixtos con arroz',
    'Pasta mixed dishes, excludes macaroni and cheese': 'Platos mixtos con pasta',
    'Macaroni and cheese': 'Macarrones con queso',
    'Turnovers and other grain-based items': 'Empanadas y otros productos de masa',
    'Fried rice and lo/chow mein': 'Arroz frito y chow mein',
    'Stir-fry and soy-based sauce mixtures': 'Salteados con salsa de soya',
    'Egg rolls, dumplings, sushi': 'Rollitos, dumplings y sushi',
    'Burritos and tacos': 'Burritos y tacos',
    'Nachos': 'Nachos',
    'Other Mexican mixed dishes': 'Otros platos mexicanos',
    'Pizza': 'Pizza',
    'Burgers': 'Hamburguesas',
    'Frankfurter sandwiches': 'Perros calientes',
    'Chicken fillet sandwiches': 'Sándwiches de filete de pollo',
    'Egg/breakfast sandwiches': 'Sándwiches de huevo/desayuno',
    'Cheese sandwiches': 'Sándwiches de queso',
    'Peanut butter and jelly sandwiches': 'Sándwiches de mantequilla de maní y mermelada',
    'Seafood sandwiches': 'Sándwiches de pescado y mariscos',
    'Deli and cured meat sandwiches': 'Sándwiches de carnes frías',
    'Meat and BBQ sandwiches': 'Sándwiches de carne y BBQ',
    'Vegetable sandwiches/burgers': 'Sándwiches y hamburguesas vegetales',
    'Soups, broth-based': 'Sopas y caldos',
    'Soups, cream-based': 'Cremas (sopas)',
    'Ramen and Asian broth-based soups': 'Ramen y sopas asiáticas',
    'Rice': 'Arroz',
    'Pasta, noodles, cooked grains': 'Pasta, fideos y granos cocidos',
    'Yeast breads': 'Panes',
    'Rolls and buns': 'Panecillos y pan de hamburguesa',
    'Bagels and English muffins': 'Bagels y muffins ingleses',
    'Tortillas': 'Tortillas',
    'Biscuits, muffins, quick breads': 'Bizcochos, muffins y panes rápidos',
    'Pancakes, waffles, French toast': 'Pancakes, waffles y tostadas francesas',
    'Ready-to-eat cereal, higher sugar (>21.2g/100g)': 'Cereal listo para comer, alto en azúcar',
    'Ready-to-eat cereal, lower sugar (=<21.2g/100g)': 'Cereal listo para comer, bajo en azúcar',
    'Oatmeal': 'Avena',
    'Grits and other cooked cereals': 'Sémolas y otros cereales cocidos',
    'Potato chips': 'Papas fritas de paquete',
    'Tortilla, corn, other chips': 'Chips de maíz y otros',
    'Popcorn': 'Crispetas',
    'Pretzels/snack mix': 'Pretzels y mezclas de pasabocas',
    'Crackers, excludes saltines': 'Galletas (excepto de soda)',
    'Saltine crackers': 'Galletas de soda',
    'Cereal bars': 'Barras de cereal',
    'Nutrition bars': 'Barras nutricionales',
    'Cakes and pies': 'Tortas y pasteles',
    'Cookies and brownies': 'Galletas dulces y brownies',
    'Doughnuts, sweet rolls, pastries': 'Donas, roscones y pastelería',
    'Candy containing chocolate': 'Dulces con chocolate',
    'Candy not containing chocolate': 'Dulces sin chocolate',
    'Ice cream and frozen dairy desserts': 'Helados y postres lácteos congelados',
    'Pudding': 'Pudín',
    'Gelatins, ices, sorbets': 'Gelatinas, raspados y sorbetes',
    'Apples': 'Manzanas',
    'Bananas': 'Bananos',
    'Grapes': 'Uvas',
    'Peaches and nectarines': 'Duraznos y nectarinas',
    'Strawberries': 'Fresas',
    'Blueberries and other berries': 'Arándanos y otras bayas',
    'Citrus fruits': 'Cítricos',
    'Melons': 'Melones',
    'Dried fruits': 'Frutas deshidratadas',
    'Other fruits and fruit salads': 'Otras frutas y ensaladas de frutas',
    'Pears': 'Peras',
    'Pineapple': 'Piña',
    'Mango and papaya': 'Mango y papaya',
    'Tomatoes': 'Tomates',
    'Carrots': 'Zanahorias',
    'Other red and orange vegetables': 'Otras verduras rojas y anaranjadas',
    'Broccoli': 'Brócoli',
    'Spinach': 'Espinaca',
    'Lettuce and lettuce salads': 'Lechuga y ensaladas de lechuga',
    'Other dark green vegetables': 'Otras verduras de hoja verde oscuro',
    'String beans': 'Habichuelas',
    'Cabbage': 'Repollo',
    'Onions': 'Cebollas',
    'Corn': 'Maíz',
    'Other starchy vegetables': 'Otras verduras feculentas',
    'Other vegetables and combinations': 'Otras verduras y combinaciones',
    'Fried vegetables': 'Verduras fritas',
    'Coleslaw, non-lettuce salads': 'Ensalada de repollo y otras ensaladas',
    'Vegetables on a sandwich': 'Verduras en sándwich',
    'White potatoes, baked or boiled': 'Papa al horno o cocida',
    'French fries and other fried white potatoes': 'Papas a la francesa y otras papas fritas',
    'Mashed potatoes and white potato mixtures': 'Puré de papa y mezclas de papa',
    'Citrus juice': 'Jugos cítricos',
    'Apple juice': 'Jugo de manzana',
    'Other fruit juice': 'Otros jugos de fruta',
    'Vegetable juice': 'Jugos de verduras',
    'Diet soft drinks': 'Gaseosas dietéticas',
    'Diet sport and energy drinks': 'Bebidas deportivas y energéticas dietéticas',
    'Other diet drinks': 'Otras bebidas dietéticas',
    'Soft drinks': 'Gaseosas',
    'Fruit drinks': 'Bebidas de fruta',
    'Sport and energy drinks': 'Bebidas deportivas y energéticas',
    'Nutritional beverages': 'Bebidas nutricionales',
    'Smoothies and grain drinks': 'Batidos y bebidas de cereales',
    'Coffee': 'Café',
    'Tea': 'Té',
    'Beer': 'Cerveza',
    'Wine': 'Vino',
    'Liquor and cocktails': 'Licores y cócteles',
    'Tap water': 'Agua de la llave',
    'Bottled water': 'Agua embotellada',
    'Flavored or carbonated water': 'Agua saborizada o con gas',
    'Enhanced water': 'Agua enriquecida',
    'Butter and animal fats': 'Mantequilla y grasas animales',
    'Margarine': 'Margarina',
    'Cream cheese, sour cream, whipped cream': 'Queso crema, crema agria y crema batida',
    'Cream and cream substitutes': 'Crema de leche y sustitutos',
    'Mayonnaise': 'Mayonesa',
    'Salad dressings and vegetable oils': 'Aderezos y aceites vegetales',
    'Tomato-based condiments': 'Salsas a base de tomate',
    'Soy-based condiments': 'Salsas a base de soya',
    'Mustard and other condiments': 'Mostaza y otros condimentos',
    'Olives, pickles, pickled vegetables': 'Aceitunas, encurtidos',
    'Pasta sauces, tomato-based': 'Salsas de tomate para pasta',
    'Dips, gravies, other sauces': 'Dips, salsas y otros',
    'Sugars and honey': 'Azúcares y miel',
    'Sugar substitutes': 'Edulcorantes',
    'Jams, syrups, toppings': 'Mermeladas, jarabes y coberturas',
    'Baby food: cereals': 'Comida de bebé: cereales',
    'Baby food: fruit': 'Comida de bebé: frutas',
    'Baby food: vegetables': 'Comida de bebé: verduras',
    'Baby food: mixtures': 'Comida de bebé: mezclas',
    'Baby food: meat and dinners': 'Comida de bebé: carnes y comidas',
    'Baby food: yogurt': 'Comida de bebé: yogur',
    'Baby food: snacks and sweets': 'Comida de bebé: pasabocas y dulces',
    'Baby juice': 'Jugo para bebé',
    'Baby water': 'Agua para bebé',
    'Formula, ready-to-feed': 'Fórmula infantil lista para tomar',
    'Formula, prepared from powder': 'Fórmula infantil preparada',
    'Human milk': 'Leche materna',
    'Protein and nutritional powders': 'Proteína y polvos nutricionales',
    'Not included in a food category': 'Sin categoría',
}


def category_es(en: str | None) -> str | None:
    if not en:
        return None
    return CATEGORY_ES.get(en) or WWEIA_ES.get(en) or en


# ------------------------------------------------------------------ portions
# Head units (English, lowercase) -> (singular, plural). Longest match wins.
_HEADS = {
    'quantity not specified': ('Cantidad no especificada', 'Cantidad no especificada'),
    'guideline amount': ('Cantidad de referencia', 'Cantidad de referencia'),
    'nlea serving': ('porción NLEA', 'porciones NLEA'),
    'racc': ('porción de referencia (RACC)', 'porciones de referencia (RACC)'),
    'fl oz': ('onza líquida', 'onzas líquidas'),
    'fluid ounce': ('onza líquida', 'onzas líquidas'),
    'oz': ('oz', 'oz'), 'ounce': ('oz', 'oz'), 'ounces': ('oz', 'oz'),
    'lb': ('lb', 'lb'), 'pound': ('lb', 'lb'),
    'cup': ('taza', 'tazas'), 'cups': ('taza', 'tazas'),
    'tablespoon': ('cucharada', 'cucharadas'), 'tablespoons': ('cucharada', 'cucharadas'),
    'tbsp': ('cucharada', 'cucharadas'),
    'teaspoon': ('cucharadita', 'cucharaditas'), 'teaspoons': ('cucharadita', 'cucharaditas'),
    'tsp': ('cucharadita', 'cucharaditas'),
    'slice': ('tajada', 'tajadas'), 'slices': ('tajada', 'tajadas'),
    'piece': ('unidad', 'unidades'), 'pieces': ('unidad', 'unidades'),
    'item': ('unidad', 'unidades'), 'items': ('unidad', 'unidades'),
    'unit': ('unidad', 'unidades'), 'each': ('unidad', 'unidades'),
    'extra large': ('extra grande', 'extra grandes'), 'extra small': ('extra pequeño', 'extra pequeños'),
    'jumbo': ('jumbo', 'jumbo'),
    'large': ('grande', 'grandes'), 'medium': ('mediano', 'medianos'), 'small': ('pequeño', 'pequeños'),
    'regular': ('regular', 'regulares'), 'miniature': ('miniatura', 'miniaturas'),
    'serving': ('porción', 'porciones'), 'servings': ('porción', 'porciones'),
    'portion': ('porción', 'porciones'),
    'individual container': ('envase individual', 'envases individuales'),
    'container': ('envase', 'envases'),
    'stick': ('barra', 'barras'), 'bar': ('barra', 'barras'),
    'fillet': ('filete', 'filetes'), 'steak': ('bistec', 'bistecs'),
    'can': ('lata', 'latas'), 'bottle': ('botella', 'botellas'),
    'package': ('paquete', 'paquetes'), 'packet': ('sobre', 'sobres'), 'pouch': ('bolsita', 'bolsitas'),
    'bag': ('bolsa', 'bolsas'), 'box': ('caja', 'cajas'), 'jar': ('frasco', 'frascos'),
    'whole': ('entero', 'enteros'), 'egg': ('huevo', 'huevos'),
    'cubic inch': ('pulgada cúbica', 'pulgadas cúbicas'),
    'surface inch': ('pulgada de superficie', 'pulgadas de superficie'),
    'chop': ('chuleta', 'chuletas'), 'roast': ('pieza para asar', 'piezas para asar'),
    'leaf': ('hoja', 'hojas'), 'leaves': ('hoja', 'hojas'),
    'sandwich': ('sándwich', 'sándwiches'), 'cookie': ('galleta', 'galletas'),
    'cracker': ('galleta', 'galletas'), 'crackers': ('galleta', 'galletas'),
    'pizza': ('pizza', 'pizzas'), 'patty': ('medallón', 'medallones'), 'scoop': ('bola', 'bolas'),
    'drink': ('bebida', 'bebidas'), 'quart': ('cuarto de galón', 'cuartos de galón'),
    'pint': ('pinta', 'pintas'), 'gallon': ('galón', 'galones'), 'glass': ('vaso', 'vasos'),
    'muffin': ('muffin', 'muffins'), 'bun': ('pan', 'panes'), 'roll': ('pan', 'panes'),
    'tortilla': ('tortilla', 'tortillas'), 'taco': ('taco', 'tacos'), 'burrito': ('burrito', 'burritos'),
    'wing': ('ala', 'alas'), 'drumstick': ('muslo', 'muslos'), 'thigh': ('contramuslo', 'contramuslos'),
    'breast': ('pechuga', 'pechugas'), 'leg': ('pernil', 'perniles'), 'back': ('rabadilla', 'rabadillas'),
    'fruit': ('fruta', 'frutas'), 'nuts': ('unidad', 'unidades'), 'kernels': ('unidad', 'unidades'),
    'spear': ('lanza', 'lanzas'), 'stalk': ('tallo', 'tallos'), 'head': ('cabeza', 'cabezas'),
    'clove': ('diente', 'dientes'), 'sprig': ('ramita', 'ramitas'), 'bunch': ('atado', 'atados'),
    'ear': ('mazorca', 'mazorcas'), 'pod': ('vaina', 'vainas'), 'wedge': ('cuña', 'cuñas'),
    'cube': ('cubo', 'cubos'), 'link': ('unidad', 'unidades'), 'frank': ('salchicha', 'salchichas'),
    'pancake': ('pancake', 'pancakes'), 'waffle': ('waffle', 'waffles'), 'bagel': ('bagel', 'bagels'),
    'biscuit': ('bizcocho', 'bizcochos'), 'doughnut': ('dona', 'donas'), 'donut': ('dona', 'donas'),
    'cake': ('torta', 'tortas'), 'pie': ('pastel', 'pasteles'), 'loaf': ('pan', 'panes'),
    'shrimp': ('camarón', 'camarones'), 'oyster': ('ostra', 'ostras'), 'clam': ('almeja', 'almejas'),
    'tablet': ('tableta', 'tabletas'), 'capsule': ('cápsula', 'cápsulas'),
}
_HEAD_KEYS = sorted(_HEADS, key=len, reverse=True)

# Tail words (outside parentheses) that we can translate. Anything else -> English kept in parentheses.
_MODS = {
    'chopped': 'picado', 'diced': 'en cubos', 'sliced': 'en rodajas', 'shredded': 'rallado',
    'mashed': 'en puré', 'cooked': 'cocido', 'raw': 'crudo', 'whole': 'entero', 'halves': 'mitades',
    'cubes': 'cubos', 'cubed': 'en cubos', 'pieces': 'trozos', 'piece': 'trozo', 'with': 'con',
    'without': 'sin', 'and': 'y', 'or': 'o', 'bone': 'hueso', 'skin': 'piel', 'liquid': 'líquido',
    'drained': 'escurrido', 'packed': 'compacto', 'pitted': 'sin semilla', 'crumbled': 'desmenuzado',
    'grated': 'rallado', 'melted': 'derretido', 'ground': 'molido', 'dry': 'seco', 'prepared': 'preparado',
    'yields': 'rinde', 'yield': 'rinde', 'any': 'cualquier', 'size': 'tamaño', 'no': 'sin', 'ice': 'hielo',
    'of': 'de', 'small': 'pequeño', 'medium': 'mediano', 'large': 'grande', 'thin': 'delgada',
    'thick': 'gruesa', 'slice': 'tajada', 'slices': 'tajadas', 'frozen': 'congelado', 'fresh': 'fresco',
    'canned': 'enlatado', 'undiluted': 'sin diluir', 'diluted': 'diluido', 'boneless': 'sin hueso',
    'unpacked': 'suelto', 'heaping': 'colmada', 'level': 'rasa', 'fluid': 'líquido', 'dried': 'seco',
    'baked': 'horneado', 'fried': 'frito', 'boiled': 'hervido', 'roasted': 'asado', 'steamed': 'al vapor',
    'nfs': 'NE', 'ns': 'NE', 'regular': 'regular', 'individual': 'individual', 'single': 'individual',
    'serving': 'porción', 'cup': 'taza', 'cups': 'tazas', 'tbsp': 'cucharada', 'tsp': 'cucharadita',
    'oz': 'oz', 'fl': 'fl', 'lb': 'lb', 'in': 'en', 'water': 'agua', 'milk': 'leche', 'cut': 'cortado',
    'peeled': 'pelado', 'unpeeled': 'sin pelar', 'trimmed': 'limpio', 'mini': 'mini', 'snack': 'snack',
    'whipped': 'batido', 'sprinkled': 'espolvoreado', 'rings': 'aros', 'ring': 'aro', 'strips': 'tiras',
    'strip': 'tira', 'florets': 'floretes', 'kernel': 'grano', 'kernels': 'granos', 'stick': 'barra',
}

_FRACTIONS = {0.125: '1/8', 0.25: '1/4', 0.333: '1/3', 0.33: '1/3', 0.5: '1/2', 0.667: '2/3', 0.67: '2/3',
              0.75: '3/4'}
_AMOUNT_RE = re.compile(r'^\s*(\d+\s+\d+/\d+|\d+/\d+|\d+(?:\.\d+)?|\.\d+)\s*(.*)$')


def _fmt_amount(a: float) -> str:
    whole = int(a)
    frac = round(a - whole, 3)
    if frac == 0:
        return str(whole)
    f = _FRACTIONS.get(frac) or _FRACTIONS.get(round(frac, 2))
    if f:
        return f if whole == 0 else f'{whole} {f}'
    return (f'{a:.2f}'.rstrip('0').rstrip('.')).replace('.', ',')


def _parse_amount(tok: str) -> float:
    tok = tok.strip()
    if ' ' in tok:
        w, fr = tok.split(None, 1)
        n, d = fr.split('/')
        return int(w) + int(n) / int(d)
    if '/' in tok:
        n, d = tok.split('/')
        return int(n) / int(d) if int(d) else 0.0
    return float(tok)


def _translate_tail(tail: str):
    """Translate words outside parentheses; return Spanish text or None if any word is unknown."""
    out = []
    pos = 0
    for m in re.finditer(r'\([^)]*\)', tail):
        out.append(('t', tail[pos:m.start()]))
        out.append(('p', m.group(0)))
        pos = m.end()
    out.append(('t', tail[pos:]))
    res = []
    for kind, seg in out:
        if kind == 'p':
            res.append(seg)
            continue
        words = re.findall(r"[A-Za-z]+|[^A-Za-z]+", seg)
        for w in words:
            if re.fullmatch(r'[A-Za-z]+', w):
                t = _MODS.get(w.lower())
                if t is None:
                    return None
                res.append(t)
            else:
                res.append(w)
    s = re.sub(r'\s+', ' ', ''.join(res)).strip(' ,;')
    return s


def translate_portion(amount, text: str) -> str:
    """amount: number or None; text: English unit/description (e.g. 'cup, chopped', '1 cup', 'large').
    Returns a Spanish label WITHOUT grams."""
    text = re.sub(r'\s+', ' ', (text or '').strip())
    if amount is None:
        m = _AMOUNT_RE.match(text)
        if m:
            try:
                amount = _parse_amount(m.group(1))
                text = m.group(2).strip()
            except (ValueError, ZeroDivisionError):
                amount = None
    low = text.lower()
    head = None
    for k in _HEAD_KEYS:
        if low == k or low.startswith(k + ' ') or low.startswith(k + ',') or low.startswith(k + '('):
            head = k
            break
    amt_s = _fmt_amount(amount) if amount is not None and amount > 0 else ''
    plural = amount is not None and amount > 1
    if head is not None:
        sing, plu = _HEADS[head]
        head_es = plu if plural else sing
        tail = text[len(head):].strip(' ,')
        if head in ('quantity not specified', 'guideline amount'):
            amt_s = ''
            tail_es = None if tail else ''
            if tail:
                tail_es = _translate_tail(tail)
            label = head_es + ((' ' + tail_es) if tail_es else (f' ({tail})' if tail else ''))
            return label.strip()
        if not tail:
            return f'{amt_s} {head_es}'.strip()
        tail_es = _translate_tail(tail)
        if tail_es:
            sep = ' ' if tail_es.startswith('(') else ', '
            return f'{amt_s} {head_es}{sep}{tail_es}'.strip()
        return f'{amt_s} {head_es} ({tail})'.strip()
    unit_es = 'unidades' if plural else 'unidad'
    if not text:
        return f'{amt_s} {unit_es}'.strip()
    t = _translate_tail(text)
    if t:
        return f'{amt_s} {t}'.strip()
    return f'{amt_s} {unit_es} ({text})'.strip()
