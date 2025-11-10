import React, { useCallback, useEffect, useRef, useState } from 'react'

type CellState = 'open' | 'closed' | 'unknown'
type CellMap = Record<string, CellState>

const CELL_NAMES = [
  'Дверь_1',
  'Дверь_2',
  'Дверь_3',
  'Дверь_4',
  'Дверь_5',
  'Дверь_6',
  'Дверь_7',
  'Дверь_8',
  'Дверь_9',
  'Дверь_10',
  'Дверь_11',
  'Дверь_12'
] as const

const createDefaultState = (): CellMap =>
  CELL_NAMES.reduce<CellMap>((acc, name) => {
    acc[name] = 'unknown'
    return acc
  }, {})

const HOST =
  typeof window !== 'undefined' && window.location.hostname
    ? window.location.hostname
    : 'localhost'
const PROTO =
  typeof window !== 'undefined' && window.location.protocol === 'https:' ? 'https' : 'http'
const WS_PROTO = PROTO === 'https' ? 'wss' : 'ws'
const WS_URL = `${WS_PROTO}://${HOST}:8000/ws`
const API_URL = `${PROTO}://${HOST}:8000`

export function App() {
  const [cells, setCells] = useState<CellMap>(() => createDefaultState())
  const [rawMessage, setRawMessage] = useState<string | null>(null)
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const normalizeCells = useCallback((incoming: Record<string, any> | undefined): CellMap => {
    const next = createDefaultState()
    if (incoming) {
      for (const [name, value] of Object.entries(incoming)) {
        if (CELL_NAMES.includes(name as typeof CELL_NAMES[number])) {
          const normalized = String(value).trim()
          next[name] = normalized === 'open' ? 'open' : normalized === 'closed' ? 'closed' : 'unknown'
        }
      }
    }
    return next
  }, [])

  const applyState = useCallback((incoming: Record<string, any> | undefined, raw?: string | null) => {
    setCells(normalizeCells(incoming))
    setRawMessage(raw ?? null)
  }, [normalizeCells])

  const fetchState = useCallback(() => {
    fetch(`${API_URL}/state`)
      .then((r) => r.json())
      .then((data) => {
        applyState(data?.cells, null)
      })
      .catch(() => {
        // ignore errors
      })
  }, [applyState])

  useEffect(() => {
    let isMounted = true
    let socket: WebSocket | null = null

    const connect = () => {
      socket = new WebSocket(WS_URL)

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg?.type === 'state' && msg?.data && isMounted) {
            applyState(msg.data.cells, msg.data.raw)
          }
        } catch {
          // ignore parse errors
        }
      }

      socket.onclose = () => {
        if (!isMounted) return
        if (reconnectRef.current) clearTimeout(reconnectRef.current)
        reconnectRef.current = setTimeout(connect, 1000)
      }
    }

    connect()

    return () => {
      isMounted = false
      if (reconnectRef.current) clearTimeout(reconnectRef.current)
      socket?.close()
    }
  }, [])

  useEffect(() => {
    fetchState()
    pollRef.current = setInterval(fetchState, 1000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [fetchState])

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      margin: 0,
      backgroundColor: '#1c1c1c'
    }}>
      <div style={{
        width: '100%',
        maxWidth: 640,
        padding: '24px 16px'
      }}>
        <h1 style={{
          color: '#fff',
          textAlign: 'center',
          marginBottom: 24,
          fontSize: 'clamp(2rem, 4vw, 3rem)'
        }}>
          Состояние дверей
        </h1>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gap: 16
        }}>
          {CELL_NAMES.map((name) => {
            const state = cells[name]
            const isOpen = state === 'open'
            const isClosed = state === 'closed'
            const color = isOpen ? '#2f9e44' : isClosed ? '#c92a2a' : '#495057'
            const label = isOpen ? 'Открыта' : isClosed ? 'Закрыта' : 'Неизвестно'
            return (
              <div key={name} style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                minHeight: 120,
                borderRadius: 16,
                background: color,
                color: '#fff',
                boxShadow: '0 8px 20px rgba(0,0,0,0.25)'
              }}>
                <div style={{ fontSize: 'clamp(1rem, 2.5vw, 1.75rem)', fontWeight: 700 }}>
                  {name.replace('_', ' ')}
                </div>
                <div style={{ marginTop: 8, fontSize: 'clamp(0.9rem, 2.3vw, 1.5rem)' }}>
                  {label}
                </div>
              </div>
            )
          })}
        </div>
        {rawMessage ? (
          <div style={{
            marginTop: 24,
            color: '#adb5bd',
            fontSize: '0.9rem',
            textAlign: 'center'
          }}>
            Последнее сообщение: {rawMessage}
          </div>
        ) : null}
      </div>
    </div>
  )
}


