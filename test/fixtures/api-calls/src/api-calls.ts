import axios from 'axios'

const API_BASE = 'https://api.example.com'
const USERS_PATH = '/users'
const SEARCH_PATH = '/search' + '/active'
const FETCH_INIT = { method: 'patch' }
const REQUEST_CONFIG = { url: USERS_PATH, method: 'get', baseURL: API_BASE }
const CONFIG = { url: SEARCH_PATH, method: 'patch', baseURL: API_BASE }
const dynamicInit = Math.random() > 0.5 ? { method: 'put' } : undefined
const randomUrl = Math.random() > 0.5 ? '/a' : '/b'
const client = axios.create({ baseURL: API_BASE })
const alias = client
const mirror = alias
const verb = 'get'

window.fetch(USERS_PATH)
globalThis.fetch(new URL('/checkout?draft=1#pay', API_BASE).href)
fetch('/posts', FETCH_INIT)
fetch('/profile', dynamicInit)

axios.post('/checkout', { baseURL: API_BASE })
client.get(USERS_PATH)
alias.request(REQUEST_CONFIG)
axios(CONFIG)
axios.request({ url: '/orders', method: 'delete' })
axios('/accounts', { method: 'head' })
axios[verb]('/skip')
axios.create({ baseURL: API_BASE }).patch('/refresh')
mirror.patch('/mirror')
fetch(new Request('/request-literal', { method: 'put' }))
fetch(new Request(randomUrl))

{
  const fetch = vi.fn()
  fetch('/noop')
}

{
  const axios = { get: vi.fn() }
  axios.get('/noop')
}
