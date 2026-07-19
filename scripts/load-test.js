import http from 'k6/http'
import { check, sleep } from 'k6'

export const options = {
  scenarios: {
    simultaneous_caregivers: { executor: 'ramping-vus', startVUs: 0, stages: [{ duration: '30s', target: 25 }, { duration: '2m', target: 100 }, { duration: '30s', target: 0 }] },
  },
  thresholds: { http_req_failed: ['rate<0.01'], http_req_duration: ['p(95)<750'], checks: ['rate>0.99'] },
}

const base = __ENV.HAVEN_API_URL || 'http://127.0.0.1:8000/api/v1'
export function setup() {
  const response = http.post(`${base}/auth/login/`, JSON.stringify({ login: __ENV.HAVEN_LOAD_USER, password: __ENV.HAVEN_LOAD_PASSWORD }), { headers: { 'Content-Type': 'application/json' } })
  check(response, { 'load account signs in': (item) => item.status === 200 })
  return { token: response.json('token') }
}

export default function ({ token }) {
  const headers = { Authorization: `Token ${token}` }
  const patients = http.get(`${base}/patients/`, { headers })
  check(patients, { 'patients scoped': (response) => response.status === 200 })
  const id = patients.json('results.0.id')
  if (id) check(http.get(`${base}/patients/${id}/dashboard/`, { headers }), { 'dashboard available': (response) => response.status === 200 })
  sleep(Math.random() * 2)
}
