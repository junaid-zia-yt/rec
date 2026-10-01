'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { Card, CardBody, EmptyState, SearchField, Select, StatusBadge } from '@rqi/ui'
import type { Client } from '@rqi/types'

/** Client-side search + status filter over an already-fetched client list (Build Phase 3 brief §"Search and filter clients"). The list itself (demo or live) is fetched server-side by the page; this component only narrows what's already on the page. */
export function ClientsList({ clients }: { clients: Client[] }) {
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState<'all' | 'active' | 'inactive'>('all')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return clients.filter((client) => {
      const matchesQuery =
        q.length === 0 ||
        client.name.toLowerCase().includes(q) ||
        client.vertical.toLowerCase().includes(q)
      const matchesStatus = status === 'all' || client.status === status
      return matchesQuery && matchesStatus
    })
  }, [clients, query, status])

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 sm:flex-row">
        <SearchField
          placeholder="Search clients by name or vertical"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search clients"
          className="sm:max-w-xs"
        />
        <Select
          value={status}
          onValueChange={(v) => setStatus(v as typeof status)}
          options={[
            { value: 'all', label: 'All statuses' },
            { value: 'active', label: 'Active' },
            { value: 'inactive', label: 'Archived' },
          ]}
        />
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          title={clients.length === 0 ? 'No clients yet' : 'No clients match your search'}
          description={
            clients.length === 0
              ? 'Add your first client to start a recruitment project for them.'
              : 'Try a different name, vertical, or status filter.'
          }
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {filtered.map((client) => (
            <Link key={client.id} href={`/clients/${client.id}`}>
              <Card className="hover:border-secondary h-full transition-colors">
                <CardBody className="flex flex-col gap-2">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-display text-tertiary text-base font-semibold">
                      {client.name}
                    </p>
                    <StatusBadge status={client.status === 'active' ? 'passed' : 'neutral'}>
                      {client.status === 'active' ? 'Active' : 'Archived'}
                    </StatusBadge>
                  </div>
                  <p className="text-muted text-sm">{client.vertical || 'No vertical set'}</p>
                  {client.primaryContactName && (
                    <p className="text-muted text-xs">Contact: {client.primaryContactName}</p>
                  )}
                </CardBody>
              </Card>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
