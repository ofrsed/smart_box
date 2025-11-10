import threading
import time
from typing import Dict, List, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse


SERIAL_PORT = "/dev/ttyACM0"
SERIAL_BAUDRATE = 9600
READ_INTERVAL = 0.1


app = FastAPI()

# Allow frontend dev server by default
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class ConnectionManager:
    def __init__(self) -> None:
        self._connections: List[WebSocket] = []
        self._lock = threading.Lock()

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        with self._lock:
            self._connections.append(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        with self._lock:
            if websocket in self._connections:
                self._connections.remove(websocket)

    async def broadcast(self, message: Dict) -> None:
        to_remove: List[WebSocket] = []
        with self._lock:
            targets = list(self._connections)
        for ws in targets:
            try:
                await ws.send_json(message)
            except Exception:
                to_remove.append(ws)
        if to_remove:
            with self._lock:
                for ws in to_remove:
                    if ws in self._connections:
                        self._connections.remove(ws)


manager = ConnectionManager()
_state_lock = threading.Lock()
_door_state = "unknown"


def _set_state(new_state: str) -> bool:
    global _door_state
    with _state_lock:
        if _door_state != new_state:
            _door_state = new_state
            return True
    return False


def _get_state() -> str:
    with _state_lock:
        return _door_state


def parse_line(line: str) -> List[Dict[str, str]]:
    line = line.strip()
    results: List[Dict[str, str]] = []

    # Support Russian messages from the Arduino examples
    if line == "Дверца закрыта":
        results.append({"cell": "1", "state": "closed"})
    elif line == "Дверца открыта":
        results.append({"cell": "1", "state": "open"})

    # Support generic protocol: "cell=<n>;state=<open|closed>"
    # or multiple: "cell=1;state=open,cell=2;state=closed"
    try:
        if "cell=" in line and "state=" in line:
            parts = [p.strip() for p in line.split(",") if p.strip()]
            for p in parts:
                kv = {kvp.split("=")[0].strip(): kvp.split("=")[1].strip() for kvp in p.split(";") if "=" in kvp}
                if "cell" in kv and "state" in kv:
                    results.append({"cell": kv["cell"], "state": kv["state"].lower()})
    except Exception:
        # Ignore parse errors
        pass

    return results


def _line_to_state(line: str) -> str:
    normalized = line.strip().lower()
    if normalized in {"дверца открыта", "door open", "open"}:
        return "open"
    if normalized in {"дверца закрыта", "door closed", "closed"}:
        return "closed"

    updates = parse_line(line)
    if updates:
        try:
            state = updates[-1]["state"]
            return "open" if state == "open" else "closed"
        except Exception:
            pass
    return ""


def serial_reader_loop() -> None:
    try:
        import serial  # pyserial
    except Exception:
        # Serial optional during local dev without device
        serial = None  # type: ignore

    ser = None
    last_raw: Optional[str] = None
    if serial is not None:
        try:
            ser = serial.Serial(SERIAL_PORT, SERIAL_BAUDRATE, timeout=1)
            # Give Arduino time to reset on serial open
            time.sleep(2)
        except Exception:
            ser = None

    while True:
        try:
            if ser is None:
                time.sleep(1.0)
                continue

            raw = ser.readline()
            if not raw:
                time.sleep(READ_INTERVAL)
                continue
            try:
                line = raw.decode(errors="ignore").strip()
            except Exception:
                continue
            if not line:
                continue
            if line == last_raw:
                continue
            last_raw = line

            state = _line_to_state(line)
            if not state:
                continue

            changed = _set_state(state)
            if changed:
                # Fire-and-forget broadcast from thread
                snapshot = {"door": _get_state(), "raw": line}
                import anyio

                anyio.from_thread.run(manager.broadcast, {"type": "state", "data": snapshot})
        except Exception:
            time.sleep(0.5)


threading.Thread(target=serial_reader_loop, daemon=True).start()


@app.get("/health")
def health() -> JSONResponse:
    return JSONResponse({"status": "ok"})


@app.get("/state")
def get_state() -> JSONResponse:
    return JSONResponse({"door": _get_state()})


@app.post("/mock/{cell_id}/{state}")
def mock_update(cell_id: int, state: str) -> JSONResponse:
    state = state.lower()
    if state not in ("open", "closed"):
        return JSONResponse({"error": "state must be open or closed"}, status_code=400)
    changed = _set_state(state)
    if changed:
        # Broadcast from request context
        import anyio

        anyio.run(manager.broadcast, {"type": "state", "data": {"door": _get_state(), "raw": f"mock:{state}"}})
    return JSONResponse({"ok": True, "changed": changed})


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await manager.connect(websocket)
    try:
        # Send initial state
        await websocket.send_json({"type": "state", "data": {"door": _get_state()}})
        while True:
            # Keep connection alive; we do not expect client messages
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)


