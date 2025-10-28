import React, { useEffect, useMemo, useRef, useState } from 'react'

type StateMap = Record<number, 'open' | 'closed' | 'unknown'>

const WS_URL = (import.meta as any).env?.VITE_WS_URL || `ws://${location.hostname}:8000/ws`
const API_URL = (import.meta as any).env?.VITE_API_URL || `http://${location.hostname}:8000`

export function App() {
  const [states, setStates] = useState<StateMap>({})
  const wsRef = useRef<WebSocket | null>(null)

  useEffect(() => {
    const ws = new WebSocket(WS_URL)
    wsRef.current = ws
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg?.type === 'state' && msg?.data) {
          // keys might be strings; normalize to numbers
          const normalized: StateMap = {}
          for (const [k, v] of Object.entries(msg.data as Record<string, string>)) {
            normalized[Number(k)] = (v as any) as any
          }
          setStates(normalized)
        }
      } catch {}
    }
    ws.onclose = () => {
      // retry after delay
      setTimeout(() => {
        if (wsRef.current === ws) wsRef.current = null
        // trigger reconnect by re-running effect
        setStates((s) => ({ ...s }))
      }, 1000)
    }
    return () => {
      ws.close()
    }
  }, [states /* naive trigger to reconnect */])

  useEffect(() => {
    // Initial fetch as fallback
    fetch(`${API_URL}/state`).then(async (r) => {
      const data = await r.json()
      const normalized: StateMap = {}
      for (const [k, v] of Object.entries(data as Record<string, string>)) {
        normalized[Number(k)] = (v as any) as any
      }
      setStates(normalized)
    }).catch(() => {})
  }, [])

  const cellIds = useMemo(() => {
    const ids = Object.keys(states).map((n) => Number(n)).sort((a, b) => a - b)
    return ids.length ? ids : Array.from({ length: 12 }, (_, i) => i + 1)
  }, [states])

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', padding: 16 }}>
      <h1 style={{ marginBottom: 12 }}>Ячейки</h1>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
        {cellIds.map((id) => {
          const st = states[id] || 'unknown'
          const color = st === 'open' ? '#ff6b6b' : st === 'closed' ? '#51cf66' : '#adb5bd'
          return (
            <div key={id} style={{
              borderRadius: 12,
              border: '1px solid #ced4da',
              padding: 16,
              background: '#fff',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              minHeight: 100
            }}>
              <div style={{ fontSize: 14, color: '#495057' }}>Ячейка {id}</div>
              <div style={{ marginTop: 8, fontWeight: 700, color }}>{st === 'open' ? 'Открыта' : st === 'closed' ? 'Закрыта' : 'Неизвестно'}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}


