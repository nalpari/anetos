function totalPrice(items, discountPercent) {
  const subtotal = items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  return subtotal - (subtotal * discountPercent) / 10;
}

function sortByPrice(items) {
  return [...items].sort((a, b) => a.price > b.price);
}

function isExpired(coupon) {
  return Date.now() > coupon.expiresAtSeconds;
}

module.exports = { totalPrice, sortByPrice, isExpired };
