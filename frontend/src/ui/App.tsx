import React, { useCallback, useEffect, useRef, useState } from 'react'

type DoorStatus = 'open' | 'closed' | 'unknown'
type CycleStatus = 'taken' | 'returned' | 'unknown'

type CellStatus = {
  door: DoorStatus
  cycle: CycleStatus
}

type CellMap = Record<string, CellStatus>

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
    acc[name] = { door: 'unknown', cycle: 'unknown' }
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
          const doorState = typeof value === 'object' && value !== null ? (value as any).door : undefined
          const cycleState = typeof value === 'object' && value !== null ? (value as any).cycle : undefined
          const door: DoorStatus =
            doorState === 'open' || doorState === 'closed' ? doorState : 'unknown'
          const cycle: CycleStatus =
            cycleState === 'taken' || cycleState === 'returned' ? cycleState : 'unknown'
          next[name] = { door, cycle }
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
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100vw',
        height: '100vh',
        margin: 0,
        backgroundColor: '#0b0b0b',
        padding: '12px 12px 20px'
      }}
    >
      <div
        style={{
          flex: 1,
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gridAutoRows: '1fr',
          gap: 12
        }}
      >
        {CELL_NAMES.map((name) => {
          const { door, cycle } = cells[name]
          const isOpen = door === 'open'
          const isClosed = door === 'closed'
          const isTaken = cycle === 'taken'
          const isReturned = cycle === 'returned'

          let background = '#343a40'
          let label = 'Нет данных'
          let labelColor = '#ffffff'

          if (isOpen) {
            background = '#f8f9fa'
            label = 'Открыта'
            labelColor = '#0b0b0b'
          } else if (isClosed && isTaken) {
            background = '#e03131'
            label = 'Инструмент взяли'
          } else if (isClosed && isReturned) {
            background = '#2b8a3e'
            label = 'Инструмент на месте'
          } else if (isClosed) {
            background = '#212529'
            label = 'Закрыта'
          }

          return (
            <div
              key={name}
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 18,
                background,
                boxShadow: '0 12px 30px rgba(0,0,0,0.35)'
              }}
            >
              <div
                style={{
                  fontSize: 'clamp(1.3rem, 3vw, 2.4rem)',
                  fontWeight: 700,
                  color: labelColor
                }}
              >
                {name.replace('_', ' ')}
              </div>
              <div
                style={{
                  marginTop: 8,
                  fontSize: 'clamp(1rem, 2.4vw, 1.9rem)',
                  fontWeight: 500,
                  color: labelColor,
                  textAlign: 'center',
                  padding: '0 10px'
                }}
              >
                {label}
              </div>
            </div>
          )
        })}
      </div>
      {rawMessage ? (
        <div
          style={{
            marginTop: 12,
            color: '#868e96',
            fontSize: '0.9rem',
            textAlign: 'center'
          }}
        >
          Последнее сообщение: {rawMessage}
        </div>
      ) : null}
    </div>
  )
}


