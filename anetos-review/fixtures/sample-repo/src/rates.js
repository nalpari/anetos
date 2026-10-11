async function fetchRates(baseCurrency) {
  const url = 'https://rates.example.com/latest?base=' + encodeURIComponent(baseCurrency);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('rates request failed: ' + response.status);
  }
  return response.json();
}

module.exports = { fetchRates };
