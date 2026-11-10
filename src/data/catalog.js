// Static reference data for the WasteLess prototype: dining halls, dishes,
// ingredients (with recipes), and the academic calendar.

export const HALLS = [
  { id: 'north', name: 'North Commons', capacity: 200, share: 0.5, open: 7, close: 21 },
  { id: 'south', name: 'South Hall Café', capacity: 130, share: 0.32, open: 7, close: 20 },
  { id: 'market', name: 'Grab & Go Market', capacity: 32, share: 0.18, open: 8, close: 22 },
];

export const DIET_TAGS = ['vegan', 'vegetarian', 'gluten-free', 'halal'];
export const ALLERGENS = ['dairy', 'egg', 'gluten', 'nuts', 'soy', 'fish', 'shellfish', 'sesame'];
export const CATEGORIES = ['Entrée', 'Vegetarian', 'Side', 'Soup', 'Salad', 'Breakfast', 'Dessert'];

// co2: kg CO2e per kg of food (production footprint, category-level factors)
// share: fraction of the hall's daily diners that take this dish
export const DISHES = [
  { id: 'D01', name: 'Herb Roasted Chicken', hall: 'north', category: 'Entrée', diet: ['gluten-free', 'halal'], allergens: [], cost: 2.85, kg: 0.32, co2: 6.9, share: 0.34, trend: 0.0, recipe: { I01: 0.18, I10: 0.01, I12: 0.005 } },
  { id: 'D02', name: 'Beef Bolognese Pasta', hall: 'north', category: 'Entrée', diet: [], allergens: ['gluten', 'dairy'], cost: 3.1, kg: 0.38, co2: 18.5, share: 0.26, trend: -0.25, recipe: { I02: 0.12, I03: 0.11, I04: 0.08, I05: 0.02 } },
  { id: 'D03', name: 'Chickpea Coconut Curry', hall: 'north', category: 'Vegetarian', diet: ['vegan', 'vegetarian', 'gluten-free', 'halal'], allergens: [], cost: 1.65, kg: 0.35, co2: 1.8, share: 0.17, trend: 0.35, recipe: { I06: 0.12, I07: 0.08, I08: 0.09 } },
  { id: 'D04', name: 'Steamed Jasmine Rice', hall: 'north', category: 'Side', diet: ['vegan', 'vegetarian', 'gluten-free', 'halal'], allergens: [], cost: 0.35, kg: 0.2, co2: 2.7, share: 0.42, trend: 0.0, recipe: { I08: 0.09 } },
  { id: 'D05', name: 'Roasted Seasonal Vegetables', hall: 'north', category: 'Side', diet: ['vegan', 'vegetarian', 'gluten-free', 'halal'], allergens: [], cost: 0.7, kg: 0.15, co2: 1.2, share: 0.3, trend: 0.1, recipe: { I09: 0.15, I10: 0.008 } },
  { id: 'D06', name: 'Tomato Basil Soup', hall: 'north', category: 'Soup', diet: ['vegetarian', 'gluten-free'], allergens: ['dairy'], cost: 0.9, kg: 0.3, co2: 1.6, share: 0.14, trend: -0.1, recipe: { I04: 0.2, I05: 0.03 } },

  { id: 'D07', name: 'Grilled Salmon Bowl', hall: 'south', category: 'Entrée', diet: ['gluten-free'], allergens: ['fish', 'sesame', 'soy'], cost: 4.2, kg: 0.34, co2: 11.9, share: 0.22, trend: 0.15, recipe: { I11: 0.14, I08: 0.08, I09: 0.06 } },
  { id: 'D08', name: 'Black Bean Burger', hall: 'south', category: 'Vegetarian', diet: ['vegan', 'vegetarian'], allergens: ['gluten', 'soy'], cost: 1.75, kg: 0.25, co2: 2.0, share: 0.2, trend: 0.2, recipe: { I06: 0.1, I03: 0.06, I12: 0.004 } },
  { id: 'D09', name: 'Cheese Pizza Slice', hall: 'south', category: 'Entrée', diet: ['vegetarian'], allergens: ['gluten', 'dairy'], cost: 1.2, kg: 0.18, co2: 4.5, share: 0.36, trend: 0.0, recipe: { I03: 0.07, I05: 0.05, I04: 0.04 } },
  { id: 'D10', name: 'Caesar Salad', hall: 'south', category: 'Salad', diet: ['vegetarian'], allergens: ['dairy', 'egg', 'gluten', 'fish'], cost: 1.4, kg: 0.2, co2: 2.2, share: 0.15, trend: -0.3, recipe: { I13: 0.12, I05: 0.02, I03: 0.02 } },
  { id: 'D11', name: 'Peanut Sesame Noodles', hall: 'south', category: 'Vegetarian', diet: ['vegan', 'vegetarian'], allergens: ['nuts', 'sesame', 'soy', 'gluten'], cost: 1.55, kg: 0.3, co2: 2.4, share: 0.16, trend: 0.05, recipe: { I02: 0.1, I07: 0.03, I09: 0.05 } },

  { id: 'D12', name: 'Fluffy Scrambled Eggs', hall: 'market', category: 'Breakfast', diet: ['vegetarian', 'gluten-free', 'halal'], allergens: ['egg', 'dairy'], cost: 0.95, kg: 0.15, co2: 4.7, share: 0.3, trend: 0.0, recipe: { I14: 2, I05: 0.01 } },
  { id: 'D13', name: 'Overnight Oats Cup', hall: 'market', category: 'Breakfast', diet: ['vegan', 'vegetarian'], allergens: ['nuts'], cost: 1.1, kg: 0.22, co2: 1.5, share: 0.24, trend: 0.3, recipe: { I15: 0.06, I07: 0.08 } },
  { id: 'D14', name: 'Turkey Club Wrap', hall: 'market', category: 'Entrée', diet: [], allergens: ['gluten', 'dairy', 'egg'], cost: 2.4, kg: 0.26, co2: 7.2, share: 0.32, trend: -0.05, recipe: { I01: 0.09, I03: 0.06, I13: 0.03 } },
  { id: 'D15', name: 'Fudge Brownie', hall: 'market', category: 'Dessert', diet: ['vegetarian'], allergens: ['gluten', 'dairy', 'egg'], cost: 0.6, kg: 0.08, co2: 3.1, share: 0.28, trend: 0.0, recipe: { I03: 0.03, I14: 0.25, I05: 0.015 } },
];

// unit cost in USD per unit; leadTime in days; pack = purchasing pack size (units)
export const INGREDIENTS = [
  { id: 'I01', name: 'Chicken / turkey breast', unit: 'kg', cost: 7.8, leadTime: 2, pack: 5, onHand: 70, onOrder: 0 },
  { id: 'I02', name: 'Pasta & noodles', unit: 'kg', cost: 2.1, leadTime: 4, pack: 10, onHand: 95, onOrder: 0 },
  { id: 'I03', name: 'Flour, bread & wraps', unit: 'kg', cost: 1.6, leadTime: 3, pack: 10, onHand: 120, onOrder: 0 },
  { id: 'I04', name: 'Tomatoes & sauce', unit: 'kg', cost: 2.4, leadTime: 2, pack: 10, onHand: 22, onOrder: 0 },
  { id: 'I05', name: 'Dairy (cheese, milk, butter)', unit: 'kg', cost: 6.5, leadTime: 2, pack: 5, onHand: 48, onOrder: 0 },
  { id: 'I06', name: 'Legumes (chickpeas, beans)', unit: 'kg', cost: 2.9, leadTime: 5, pack: 10, onHand: 60, onOrder: 0 },
  { id: 'I07', name: 'Coconut milk & plant milk', unit: 'L', cost: 3.2, leadTime: 5, pack: 6, onHand: 14, onOrder: 0 },
  { id: 'I08', name: 'Rice & grains', unit: 'kg', cost: 1.9, leadTime: 6, pack: 20, onHand: 260, onOrder: 0 },
  { id: 'I09', name: 'Fresh vegetables', unit: 'kg', cost: 2.7, leadTime: 1, pack: 5, onHand: 55, onOrder: 0 },
  { id: 'I10', name: 'Olive oil', unit: 'L', cost: 9.5, leadTime: 7, pack: 4, onHand: 16, onOrder: 0 },
  { id: 'I11', name: 'Salmon fillet', unit: 'kg', cost: 16.5, leadTime: 2, pack: 5, onHand: 9, onOrder: 0 },
  { id: 'I12', name: 'Spices & seasoning', unit: 'kg', cost: 14, leadTime: 7, pack: 1, onHand: 6, onOrder: 0 },
  { id: 'I13', name: 'Leafy greens', unit: 'kg', cost: 4.1, leadTime: 1, pack: 3, onHand: 6, onOrder: 0 },
  { id: 'I14', name: 'Eggs', unit: 'ea', cost: 0.28, leadTime: 3, pack: 180, onHand: 900, onOrder: 0 },
  { id: 'I15', name: 'Rolled oats', unit: 'kg', cost: 2.2, leadTime: 5, pack: 10, onHand: 30, onOrder: 0 },
];

// Academic phases and campus events. Phases scale overall attendance; events
// apply an additional multiplier on specific dates.
export const DEFAULT_CALENDAR = [
  { id: 'c1', type: 'phase', phase: 'summer', label: 'Summer session', start: '2026-05-09', end: '2026-08-21' },
  { id: 'c2', type: 'phase', phase: 'break', label: 'Labor Day', start: '2026-09-07', end: '2026-09-07' },
  { id: 'c3', type: 'phase', phase: 'midterms', label: 'Midterm exams', start: '2026-10-12', end: '2026-10-16' },
  { id: 'c4', type: 'event', label: 'Homecoming weekend', start: '2026-10-23', end: '2026-10-25', multiplier: 1.18 },
  { id: 'c5', type: 'event', label: 'Admitted Students Day', start: '2026-11-14', end: '2026-11-14', multiplier: 1.12 },
  { id: 'c6', type: 'phase', phase: 'break', label: 'Thanksgiving break', start: '2026-11-25', end: '2026-11-29' },
  { id: 'c7', type: 'phase', phase: 'finals', label: 'Final exams', start: '2026-12-07', end: '2026-12-11' },
  { id: 'c8', type: 'phase', phase: 'break', label: 'Winter break', start: '2026-12-12', end: '2027-01-10' },
];

export const PHASES = ['regular', 'midterms', 'finals', 'break', 'summer'];

// Campus location used for the live weather feed (configurable in Settings).
export const DEFAULT_LOCATION = { name: 'Washington, DC', lat: 38.92, lon: -77.02 };

export const SHIFTS = ['Breakfast', 'Lunch', 'Dinner'];
export const WASTE_REASONS = ['Overproduction', 'Spoilage', 'Plate waste', 'Quality issue', 'Expired'];

// Days before "today" when the WasteLess forecast-driven prep went live.
// Earlier history reflects traditional par-level prep (the savings baseline).
export const GO_LIVE_DAYS_AGO = 90;

export const dishById = Object.fromEntries(DISHES.map((d) => [d.id, d]));
export const hallById = Object.fromEntries(HALLS.map((h) => [h.id, h]));
export const ingredientById = Object.fromEntries(INGREDIENTS.map((i) => [i.id, i]));
