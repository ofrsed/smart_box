      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 2px 8px',
          borderBottom: '1px solid rgba(255,255,255,0.08)'
        }}
      >
        <div
          style={{
            width: 64,
            height: 24,
            borderRadius: 8,
            backgroundColor: 'rgba(255,255,255,0.12)'
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              fontSize: '0.9rem',
              fontWeight: 500,
              color: '#f1f3f5',
              letterSpacing: 0.15
            }}
          >
            Имя Фамилия
          </div>
          <button
            type="button"
            onClick={() => setLoggedIn(false)}
            style={{
              padding: '6px 14px',
              borderRadius: 18,
              border: '1px solid rgba(255,255,255,0.2)',
              background: 'transparent',
              color: '#f1f3f5',
              fontSize: '0.85rem',
              cursor: 'pointer',
              fontFamily: 'inherit'
            }}
          >
            Выход
          </button>
        </div>
      </header>
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
  const [pressedCell, setPressedCell] = useState<string | null>(null)
  const [loggedIn, setLoggedIn] = useState<boolean>(true)

  const normalizeCells = useCallback((incoming: Record<string, any> | undefined): CellMap => {
    const next = createDefaultState()
    if (incoming) {
      for (const [name, value] of Object.entries(incoming)) {
        if ((CELL_NAMES as readonly string[]).includes(name)) {
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
    if (!loggedIn) {
      setCells(createDefaultState())
      setRawMessage(null)
      return
    }

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

      socket.onerror = () => {
        socket?.close()
      }
    }

    connect()

    return () => {
      isMounted = false
      if (reconnectRef.current) clearTimeout(reconnectRef.current)
      socket?.close()
    }
  }, [applyState, loggedIn])

  useEffect(() => {
    if (!loggedIn) {
      if (pollRef.current) clearInterval(pollRef.current)
      return
    }
    fetchState()
    pollRef.current = setInterval(fetchState, 1000)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [fetchState, loggedIn])

  if (!loggedIn) {
    return (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          width: '100vw',
          height: '100vh',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#0b0b0b',
          color: '#f1f3f5',
          gap: 24
        }}
      >
        <div style={{ fontSize: '1.2rem', opacity: 0.8 }}>Видеокамера</div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '90vw',
            maxWidth: 900,
            height: 'auto',
            background: '#111',
            border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: 12,
            overflow: 'hidden'
          }}
        >
          <img
            src={`${API_URL}/video_feed`}
            alt="IP Camera"
            style={{
              display: 'block',
              width: '100%',
              height: 'auto',
              objectFit: 'cover'
            }}
          />
        </div>
        <button
          type="button"
          onClick={() => setLoggedIn(true)}
          style={{
            padding: '12px 24px',
            borderRadius: 12,
            border: '1px solid rgba(255,255,255,0.3)',
            background: 'rgba(255,255,255,0.08)',
            color: '#f1f3f5',
            fontSize: '1rem',
            cursor: 'pointer',
            fontFamily: 'inherit'
          }}
        >
          Войти
        </button>
      </div>
    )
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: '100vw',
        height: '100vh',
        maxWidth: 600,
        maxHeight: 1024,
        margin: '0 auto',
        backgroundColor: '#0b0b0b',
        padding: '8px 12px 12px',
        gap: 8,
        boxSizing: 'border-box'
      }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '4px 2px 6px',
          borderBottom: '1px solid rgba(255,255,255,0.08)'
        }}
      >
        <div
          style={{
            width: 64,
            height: 24,
            borderRadius: 8,
            backgroundColor: 'rgba(255,255,255,0.12)'
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              fontSize: '0.9rem',
              fontWeight: 500,
              color: '#f1f3f5',
              letterSpacing: 0.15
            }}
          >
            Имя Фамилия
          </div>
          <button
            type="button"
            onClick={() => setLoggedIn(false)}
            style={{
              padding: '6px 14px',
              borderRadius: 18,
              border: '1px solid rgba(255,255,255,0.2)',
              background: 'transparent',
              color: '#f1f3f5',
              fontSize: '0.85rem',
              cursor: 'pointer',
              fontFamily: 'inherit'
            }}
          >
            Выход
          </button>
        </div>
      </header>
      <div
        style={{
          flex: 1,
          minHeight: 0,
          display: 'grid',
          gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
          gridAutoRows: '1fr',
          gap: 8
        }}
      >
        {CELL_NAMES.map((name, index) => {
          const { door, cycle } = cells[name]
          const isOpen = door === 'open'
          const isClosed = door === 'closed'
          const isTaken = cycle === 'taken'
          const isReturned = cycle === 'returned'

          let background = '#343a40'
          let labelColor = '#ffffff'

          if (isOpen) {
            background = '#f8f9fa'
            labelColor = '#0b0b0b'
          } else if (isClosed && isTaken) {
            background = '#e03131'
          } else if (isClosed && isReturned) {
            background = '#2b8a3e'
          } else if (isClosed) {
            background = '#212529'
          }

          return (
            <button
              key={name}
              type="button"
              onPointerDown={() => setPressedCell(name)}
              onPointerUp={() => setPressedCell(null)}
              onPointerLeave={() => setPressedCell((prev) => (prev === name ? null : prev))}
              onPointerCancel={() => setPressedCell((prev) => (prev === name ? null : prev))}
              style={{
                position: 'relative',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: 18,
                background,
                color: labelColor,
                border: 'none',
                padding: 12,
                fontFamily: 'inherit',
                cursor: 'pointer',
                outline: 'none',
                WebkitTapHighlightColor: 'transparent',
                touchAction: 'manipulation',
                userSelect: 'none',
                transform: pressedCell === name ? 'scale(0.95)' : 'scale(1)',
                transition: 'transform 0.1s ease'
              }}
            >
              <span
                style={{
                  position: 'relative',
                  width: '84%',
                  aspectRatio: '1 / 1',
                  borderRadius: 20,
                  marginBottom: 14,
                  border: `2px solid ${labelColor === '#0b0b0b' ? '#adb5bd' : 'rgba(255,255,255,0.35)'}`,
                  backgroundColor: labelColor === '#0b0b0b' ? '#f8f9fa' : 'rgba(255,255,255,0.08)',
                  display: 'flex',
                  alignItems: 'flex-start',
                  justifyContent: 'flex-end',
                  padding: '10%'
                }}
              >
                <span
                  style={{
                    fontSize: 'clamp(1.2rem, 3vw, 2rem)',
                    fontWeight: 700,
                    color: labelColor === '#0b0b0b' ? '#495057' : '#ffffff',
                    opacity: 0.85
                  }}
                >
                  {index + 1}
                </span>
              </span>
              <span
                style={{
                  fontSize: 'clamp(1rem, 2.6vw, 1.6rem)',
                  fontWeight: 600,
                  textAlign: 'center'
                }}
              >
                Инструмент
              </span>
            </button>
          )
        })}
      </div>
      {rawMessage ? (
        <div
          style={{
            marginTop: 8,
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


