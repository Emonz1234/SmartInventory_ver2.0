import apiClient from './client'
import { Item } from '../types'

// Items API
export const inventoryAPI = {
  // Items
  getItems: () => apiClient.get<Item[]>('/items'),
  getItem: (id: number) => apiClient.get<Item>(`/items/${id}`),
  createItem: (data: Partial<Item>) => apiClient.post<Item>('/items', data),
  updateItem: (id: number, data: Partial<Item>) => apiClient.put<Item>(`/items/${id}`, data),
  deleteItem: (id: number) => apiClient.delete(`/items/${id}`),
  searchItems: (query: string) => apiClient.get('/items/search', { params: { q: query } }),

  // Inventory
  getInventory: () => apiClient.get('/inventory'),
  getItemInventory: (itemId: number) => apiClient.get(`/inventory/${itemId}`),
  getLocationInventory: (binId: number) => apiClient.get(`/inventory/location/${binId}`),

  // Transactions
  getTransactions: (itemId?: number) => apiClient.get('/transactions', { params: { item_id: itemId } }),
  createPickTransaction: (data: any) => apiClient.post('/transactions/pick', data),
  createPutTransaction: (data: any) => apiClient.post('/transactions/put', data),
  createAdjustTransaction: (data: any) => apiClient.post('/transactions/adjust', data)
}

export type InventoryAPI = typeof inventoryAPI
