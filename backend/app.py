import os
import threading
import time
from typing import Dict, List

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse


SERIAL_PORT = os.getenv("SERIAL_PORT", "/dev/ttyACM0")
SERIAL_BAUDRATE = int(os.getenv("SERIAL_BAUDRATE", "9600"))
NUM_CELLS = int(os.getenv("NUM_CELLS", "12"))


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


class CellState:
    def __init__(self, num_cells: int) -> None:
        # State values: "open" | "closed"
        self.states: Dict[int, str] = {i: "unknown" for i in range(1, num_cells + 1)}
        self._lock = threading.Lock()

    def set_state(self, cell_id: int, state: str) -> bool:
        with self._lock:
            prev = self.states.get(cell_id)
            if prev != state:
                self.states[cell_id] = state
                return True
            return False

    def set_all(self, state: str) -> bool:
        changed = False
        with self._lock:
            for k, v in list(self.states.items()):
                if v != state:
                    self.states[k] = state
                    changed = True
        return changed

    def snapshot(self) -> Dict[int, str]:
        with self._lock:
            return dict(self.states)


cells = CellState(NUM_CELLS)


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


def serial_reader_loop() -> None:
    try:
        import serial  # pyserial
    except Exception:
        # Serial optional during local dev without device
        serial = None  # type: ignore

    ser = None
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
                continue
            try:
                line = raw.decode(errors="ignore").strip()
            except Exception:
                continue

            updates = parse_line(line)
            changed = False
            for upd in updates:
                try:
                    cell_id = int(upd["cell"])
                except Exception:
                    continue
                state = "open" if upd["state"] == "open" else "closed"
                if cells.set_state(cell_id, state):
                    changed = True

            if changed:
                # Fire-and-forget broadcast from thread
                snapshot = cells.snapshot()
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
    return JSONResponse(cells.snapshot())


@app.post("/mock/{cell_id}/{state}")
def mock_update(cell_id: int, state: str) -> JSONResponse:
    state = state.lower()
    if state not in ("open", "closed"):
        return JSONResponse({"error": "state must be open or closed"}, status_code=400)
    changed = cells.set_state(cell_id, state)
    if changed:
        # Broadcast from request context
        import anyio
        anyio.run(manager.broadcast, {"type": "state", "data": cells.snapshot()})
    return JSONResponse({"ok": True, "changed": changed})


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await manager.connect(websocket)
    try:
        # Send initial state
        await websocket.send_json({"type": "state", "data": cells.snapshot()})
        while True:
            # Keep connection alive; we do not expect client messages
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)


