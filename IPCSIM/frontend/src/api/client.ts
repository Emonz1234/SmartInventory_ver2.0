import axios from 'axios'

// Use Vite proxy in development to avoid CORS and use absolute backend in production
const API_BASE_URL = (import.meta as any).env.VITE_EDGE_API_URL || '/api'

const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json'
  }
})

// Request interceptor
apiClient.interceptors.request.use(
  (config) => {
    // Add auth token if available
    const token = localStorage.getItem('token')
    if (token) {
      config.headers.Authorization = `Bearer ${token}`
    }
    return config
  },
  (error) => Promise.reject(error)
)

// Response interceptor
apiClient.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && error.response?.data?.detail === 'Edge API token required') {
      localStorage.removeItem('token')
      window.location.href = import.meta.env.BASE_URL
    }
    return Promise.reject(error)
  }
)

export default apiClient
