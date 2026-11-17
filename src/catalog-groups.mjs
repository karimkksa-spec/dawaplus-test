// Filter by explicit product form/name, never infer a medical indication.
const groups = [
  ['أقراص وكبسولات', /أقراص|قرص|كبسول/],
  ['شراب ومعلّقات', /شراب|معلق/],
  ['فوار وأكياس', /فوار|أكياس/],
  ['جل وكريمات', /جل|كريم/],
  ['أمبولات', /أمبول/],
  ['شامبو', /شامبو/],
  ['زيوت', /زيت/],
  ['مزيلات عرق', /عرق|رول أون/],
  ['صابون', /صابون/],
];
export function productGroup(product) {
  return product.subcategory?.trim() || groups.find(([,pattern]) => pattern.test(product.name))?.[0] || 'منتجات أخرى';
}
export function availableGroups(products) {
  return [...new Set(products.map(productGroup))];
}
