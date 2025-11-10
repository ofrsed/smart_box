import React, { useEffect, useRef, useState } from 'react'

type DoorState = 'open' | 'closed' | 'unknown'

const WS_URL = 'ws://localhost:8000/ws'
const API_URL = 'http://localhost:8000'

export function App() {
  const [doorState, setDoorState] = useState<DoorState>('unknown')
  const [rawMessage, setRawMessage] = useState<string | null>(null)
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let isMounted = true
    let socket: WebSocket | null = null

    const connect = () => {
      socket = new WebSocket(WS_URL)

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          if (msg?.type === 'state' && msg?.data) {
            const nextState = (msg.data.door as DoorState) || 'unknown'
            if (isMounted) {
              setDoorState(nextState)
              setRawMessage(msg.data.raw ?? null)
            }
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
    fetch(`${API_URL}/state`)
      .then((r) => r.json())
      .then((data) => {
        const nextState = (data?.door as DoorState) || 'unknown'
        setDoorState(nextState)
        setRawMessage(null)
      })
      .catch(() => {
        setDoorState('unknown')
      })
  }, [])

  const label =
    doorState === 'open'
      ? 'Дверца открыта'
      : doorState === 'closed'
        ? 'Дверца закрыта'
        : 'Состояние неизвестно'

  const background =
    doorState === 'open' ? '#2f9e44' : doorState === 'closed' ? '#c92a2a' : '#495057'

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      margin: 0,
      backgroundColor: '#1c1c1c'
    }}>
      <button
        style={{
          width: '100%',
          height: '100%',
          maxWidth: '100vw',
          maxHeight: '100vh',
          border: 'none',
          borderRadius: 0,
          background: background,
          color: '#fff',
          fontSize: 'clamp(2rem, 6vw, 6rem)',
          fontWeight: 700,
          cursor: 'default',
          outline: 'none'
        }}
      >
        {label}
        {rawMessage ? (
          <div style={{ marginTop: 16, fontSize: 'clamp(1rem, 2.5vw, 2rem)', fontWeight: 400 }}>
            {rawMessage}
          </div>
        ) : null}
      </button>
    </div>
  )
}


