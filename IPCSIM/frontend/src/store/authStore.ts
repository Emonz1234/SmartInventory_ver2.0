import { create } from 'zustand'
import { User } from '../types'

interface AuthState {
  user: User | null
  isAuthenticated: boolean
  setUser: (user: User | null) => void
  logout: () => void
  canAccess: (requiredRole: string) => boolean
}

// Display identity only. Authorization is enforced by the edge API token;
// central user permissions are enforced by Django, never this UI role.
const viewer: User = {
  id: 0,
  username: 'edge-viewer',
  role: 'OPERATOR',
  email: ''
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: viewer,
  isAuthenticated: !!localStorage.getItem('token'),
  setUser: (user) => set({ user, isAuthenticated: !!user }),
  logout: () => {localStorage.removeItem('token'); set({ user: null, isAuthenticated: false }); window.location.reload()},
  canAccess: (requiredRole: string) => {
    const user = get().user
    if (!user) return false
    
    const roleHierarchy: Record<string, number> = {
      'OPERATOR': 1,
      'SUPERVISOR': 2,
      'MAINTENANCE': 3
    }
    
    return roleHierarchy[user.role] >= roleHierarchy[requiredRole]
  }
}))
