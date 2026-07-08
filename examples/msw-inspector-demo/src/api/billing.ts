export async function createCheckoutSession() {
  const response = await fetch('/api/create-checkout-session', {
    method: 'POST',
  })
  return response.json()
}
