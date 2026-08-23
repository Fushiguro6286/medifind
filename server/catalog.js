/**
 * The product catalogue MediFind tracks.
 *
 * Two jobs:
 *  1. TRACKED_QUERIES drives the 12-hourly refresh - these are the searches run against
 *     every company, so their results are already cached when a user asks for them.
 *  2. SEED_CATALOG powers type-ahead from the first keystroke, before any scrape has
 *     landed. Scraped product titles are merged in on top of it.
 *
 * Keep TRACKED_QUERIES tight: every entry multiplies the refresh cost by twelve companies.
 */

export const CATEGORIES = {
  device: 'Home medical device',
  medicine: 'Medicine',
  supply: 'Healthcare supply',
  wellness: 'Wellness & nutrition',
};

/** Searches refreshed on every cycle. */
export const TRACKED_QUERIES = (process.env.TRACKED_QUERIES?.split(',').map(s => s.trim()).filter(Boolean)) ?? [
  'digital thermometer',
  'blood pressure monitor',
  'pulse oximeter',
  'glucometer',
  'nebulizer',
  'paracetamol 500mg',
  'hand sanitizer',
  'n95 mask',
];

/** Type-ahead seed. `q` is the search actually issued when the suggestion is picked. */
export const SEED_CATALOG = [
  // Home medical devices
  { display: 'Digital Thermometer', q: 'digital thermometer', category: 'device' },
  { display: 'Infrared Forehead Thermometer', q: 'infrared thermometer', category: 'device' },
  { display: 'Blood Pressure Monitor', q: 'blood pressure monitor', category: 'device' },
  { display: 'Pulse Oximeter', q: 'pulse oximeter', category: 'device' },
  { display: 'Glucometer', q: 'glucometer', category: 'device' },
  { display: 'Glucometer Test Strips', q: 'glucometer strips', category: 'device' },
  { display: 'Nebulizer Machine', q: 'nebulizer', category: 'device' },
  { display: 'Weighing Scale (Digital)', q: 'digital weighing scale', category: 'device' },
  { display: 'Steam Inhaler / Vaporizer', q: 'steam vaporizer', category: 'device' },
  { display: 'Hot Water Bag', q: 'hot water bag', category: 'device' },
  { display: 'Heating Pad', q: 'heating pad', category: 'device' },
  { display: 'Air Purifier', q: 'air purifier', category: 'device' },
  { display: 'Oxygen Concentrator', q: 'oxygen concentrator', category: 'device' },
  { display: 'Wheelchair', q: 'wheelchair', category: 'device' },
  { display: 'Walking Stick', q: 'walking stick', category: 'device' },
  { display: 'Hearing Aid', q: 'hearing aid', category: 'device' },
  { display: 'TENS Machine', q: 'tens machine physiotherapy', category: 'device' },
  { display: 'Fetal Doppler', q: 'fetal doppler', category: 'device' },
  { display: 'Stethoscope', q: 'stethoscope', category: 'device' },
  { display: 'Body Fat Analyser', q: 'body fat analyser', category: 'device' },

  // Medicines
  { display: 'Paracetamol 500mg', q: 'paracetamol 500mg', category: 'medicine' },
  { display: 'Dolo 650', q: 'dolo 650', category: 'medicine' },
  { display: 'Crocin Advance', q: 'crocin advance', category: 'medicine' },
  { display: 'Azithromycin 500mg', q: 'azithromycin 500', category: 'medicine' },
  { display: 'Amoxicillin 500mg', q: 'amoxicillin 500', category: 'medicine' },
  { display: 'Cetirizine 10mg', q: 'cetirizine', category: 'medicine' },
  { display: 'Montelukast 10mg', q: 'montelukast', category: 'medicine' },
  { display: 'Pantoprazole 40mg', q: 'pantoprazole 40', category: 'medicine' },
  { display: 'Omeprazole 20mg', q: 'omeprazole', category: 'medicine' },
  { display: 'Metformin 500mg', q: 'metformin 500', category: 'medicine' },
  { display: 'Amlodipine 5mg', q: 'amlodipine', category: 'medicine' },
  { display: 'Atorvastatin 10mg', q: 'atorvastatin', category: 'medicine' },
  { display: 'Thyronorm 50mcg', q: 'thyronorm', category: 'medicine' },
  { display: 'Ibuprofen 400mg', q: 'ibuprofen 400', category: 'medicine' },
  { display: 'Aspirin 75mg', q: 'aspirin 75', category: 'medicine' },
  { display: 'ORS Powder', q: 'ors powder', category: 'medicine' },
  { display: 'Cough Syrup', q: 'cough syrup', category: 'medicine' },
  { display: 'Antacid Syrup', q: 'antacid syrup', category: 'medicine' },
  { display: 'Betadine Antiseptic', q: 'betadine antiseptic', category: 'medicine' },
  { display: 'Volini Pain Relief Spray', q: 'volini spray', category: 'medicine' },
  { display: 'Moov Pain Relief Cream', q: 'moov cream', category: 'medicine' },

  // Healthcare supplies
  { display: 'N95 Mask', q: 'n95 mask', category: 'supply' },
  { display: 'Surgical Face Mask', q: 'surgical mask', category: 'supply' },
  { display: 'Hand Sanitizer', q: 'hand sanitizer', category: 'supply' },
  { display: 'Surgical Gloves', q: 'surgical gloves', category: 'supply' },
  { display: 'Cotton Roll', q: 'cotton roll', category: 'supply' },
  { display: 'Crepe Bandage', q: 'crepe bandage', category: 'supply' },
  { display: 'Band-Aid / Adhesive Bandage', q: 'band aid', category: 'supply' },
  { display: 'First Aid Kit', q: 'first aid kit', category: 'supply' },
  { display: 'Syringe (Disposable)', q: 'disposable syringe', category: 'supply' },
  { display: 'Adult Diapers', q: 'adult diapers', category: 'supply' },
  { display: 'Knee Cap / Support', q: 'knee support', category: 'supply' },
  { display: 'Cervical Collar', q: 'cervical collar', category: 'supply' },
  { display: 'Lumbar Support Belt', q: 'lumbar support belt', category: 'supply' },
  { display: 'Pregnancy Test Kit', q: 'pregnancy test kit', category: 'supply' },
  { display: 'Covid Rapid Antigen Kit', q: 'covid test kit', category: 'supply' },
  { display: 'Sanitary Pads', q: 'sanitary pads', category: 'supply' },

  // Wellness & nutrition
  { display: 'Vitamin D3 Tablets', q: 'vitamin d3', category: 'wellness' },
  { display: 'Vitamin C Tablets', q: 'vitamin c tablets', category: 'wellness' },
  { display: 'Vitamin B12', q: 'vitamin b12', category: 'wellness' },
  { display: 'Calcium Tablets', q: 'calcium tablets', category: 'wellness' },
  { display: 'Iron / Folic Acid', q: 'iron folic acid', category: 'wellness' },
  { display: 'Multivitamin Tablets', q: 'multivitamin', category: 'wellness' },
  { display: 'Whey Protein Powder', q: 'whey protein', category: 'wellness' },
  { display: 'Omega 3 Fish Oil', q: 'omega 3 fish oil', category: 'wellness' },
  { display: 'Protinex', q: 'protinex', category: 'wellness' },
  { display: 'Ensure Nutrition Powder', q: 'ensure nutrition powder', category: 'wellness' },
  { display: 'Zincovit Tablets', q: 'zincovit', category: 'wellness' },
  { display: 'Shelcal 500', q: 'shelcal 500', category: 'wellness' },
];

/** Everything the user might mean, keyed for prefix search. */
export const SEED_TERMS = SEED_CATALOG.map(item => ({
  ...item,
  norm: item.display.toLowerCase(),
  tokens: item.display.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean),
}));
