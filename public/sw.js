/* Service worker — notificaciones push cuando la app está cerrada o en segundo plano. */

self.addEventListener('push', (event) => {
  let payload = {
    title: 'Nueva tarea asignada',
    body: 'Tenés una tarea nueva en el taller',
    url: '/tareas',
    tag: 'nm-hub-task',
  }
  try {
    if (event.data) {
      const parsed = event.data.json()
      payload = { ...payload, ...parsed }
    }
  } catch {
    /* usar defaults */
  }

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: payload.tag || 'nm-hub-task',
      data: { url: payload.url || '/tareas' },
      renotify: true,
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const target = event.notification.data?.url || '/tareas'
  const absolute = new URL(target, self.location.origin).href

  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ('focus' in client) {
          return client.focus()
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(absolute)
      }
    }),
  )
})
