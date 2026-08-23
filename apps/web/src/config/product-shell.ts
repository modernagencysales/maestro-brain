export const productShell = {
  navigation: {
    dashboard: { label: 'Connections', to: '/$workspace' },
    inbox: { label: 'Brain', to: '/$workspace/inbox' },
    contacts: { label: 'Clients', to: '/$workspace/contacts' },
    kanban: { label: 'Kanban', to: '/$workspace/kanban', visible: false },
    showcase: {
      label: 'Showcase',
      to: '/$workspace/showcase',
      visible: false,
    },
  },
  labels: {
    contacts: 'Clients',
    inbox: 'Brain',
  },
  dashboard: 'connections' as 'reports' | 'connections',
  inbox: 'brain' as 'contacts' | 'brain',
  contacts: 'clients' as 'contacts' | 'clients',
  search: 'assistant' as 'workspace' | 'assistant',
} as const
