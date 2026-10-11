function portion(value, rate) {
  return (value * rate) / 10;
}

function tipFor(subtotal, tenths) {
  return portion(subtotal, tenths);
}

function totalPrice(items, discountPercent) {
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  return subtotal - portion(subtotal, discountPercent);
}

function sortByPrice(items) {
  return [...items].sort((a, b) => a.price > b.price);
}

function isExpired(coupon) {
  return Date.now() > coupon.expiresAtSeconds;
}

module.exports = { tipFor, totalPrice, sortByPrice, isExpired };
