import { defineStore } from 'pinia'
import { ref } from 'vue'
import type { ToastItem } from '@surstromming/toast'

// App-wide: anything can raise a toast, one Toaster renders them all.
export const useToasts = defineStore('toasts', () => {
  const items = ref<ToastItem[]>([])
  let nextId = 0

  const push = (toast: Omit<ToastItem, 'id'>) => {
    items.value.push({ ...toast, id: nextId++ })
  }

  const dismiss = (id: number) => {
    items.value = items.value.filter((toast) => toast.id !== id)
  }

  return { items, push, dismiss }
})
