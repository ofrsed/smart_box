import json
import threading
import time
from typing import Dict, List, Optional
import os

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
import cv2


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
CELL_NAMES = [
    "Дверь_1",
    "Дверь_2",
    "Дверь_3",
    "Дверь_4",
    "Дверь_5",
    "Дверь_6",
    "Дверь_7",
    "Дверь_8",
    "Дверь_9",
    "Дверь_10",
    "Дверь_11",
    "Дверь_12",
]


class CellState:
    __slots__ = ("name", "door", "cycle", "awaiting_close")

    def __init__(self, name: str) -> None:
        self.name = name
        self.door: str = "unknown"  # "open" | "closed" | "unknown"
        self.cycle: str = "unknown"  # "taken" | "returned" | "unknown"
        self.awaiting_close: bool = False

    def apply(self, new_state: str) -> bool:
        changed = False
        if new_state == "open":
            if self.door != "open":
                changed = True
            self.door = "open"
            self.awaiting_close = True
        elif new_state == "closed":
            if self.awaiting_close:
                next_cycle = "taken" if self.cycle in ("returned", "unknown") else "returned"
                if next_cycle != self.cycle:
                    changed = True
                self.cycle = next_cycle
                self.awaiting_close = False
            if self.door != "closed":
                changed = True
            self.door = "closed"
        else:
            # For unknown values
            if self.door != "unknown":
                changed = True
            self.door = "unknown"
        return changed

    def to_dict(self) -> Dict[str, str]:
        return {"door": self.door, "cycle": self.cycle}


_state_lock = threading.Lock()
_cells: Dict[str, CellState] = {name: CellState(name) for name in CELL_NAMES}


def _set_cell_state(cell: str, new_state: str) -> bool:
    if cell not in _cells:
        return False
    with _state_lock:
        return _cells[cell].apply(new_state)


def _set_bulk_states(updates: Dict[str, str]) -> bool:
    changed = False
    with _state_lock:
        for cell, new_state in updates.items():
            if cell in _cells and _cells[cell].apply(new_state):
                changed = True
    return changed


def _snapshot() -> Dict[str, Dict[str, str]]:
    with _state_lock:
        return {name: state.to_dict() for name, state in _cells.items()}


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


def _line_to_updates(line: str) -> Dict[str, str]:
    try:
        parsed = json.loads(line)
        if isinstance(parsed, dict):
            result: Dict[str, str] = {}
            for key, value in parsed.items():
                state_val = str(value).strip()
                if state_val == "1":
                    result[key] = "closed"
                elif state_val == "0":
                    result[key] = "open"
            return result
    except json.JSONDecodeError:
        pass

    # Fallback to legacy formats
    updates = parse_line(line)
    result: Dict[str, str] = {}
    for upd in updates:
        cell = upd.get("cell")
        state = upd.get("state")
        if cell and state:
            door_name = cell if cell.startswith("Дверь_") else f"Дверь_{cell}"
            result[door_name] = "open" if state == "open" else "closed"
    return result


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

            updates = _line_to_updates(line)
            if not updates:
                continue

            changed = _set_bulk_states(updates)
            if changed:
                snapshot = _snapshot()
                import anyio

                anyio.from_thread.run(
                    manager.broadcast,
                    {"type": "state", "data": {"cells": snapshot, "raw": line}},
                )
        except Exception:
            time.sleep(0.5)


threading.Thread(target=serial_reader_loop, daemon=True).start()


@app.get("/health")
def health() -> JSONResponse:
    return JSONResponse({"status": "ok"})


@app.get("/state")
def get_state() -> JSONResponse:
    return JSONResponse({"cells": _snapshot()})


@app.post("/mock/{cell_id}/{state}")
def mock_update(cell_id: int, state: str) -> JSONResponse:
    state = state.lower()
    if state not in ("open", "closed"):
        return JSONResponse({"error": "state must be open or closed"}, status_code=400)
    cell_name = CELL_NAMES[cell_id - 1] if 1 <= cell_id <= len(CELL_NAMES) else None
    if not cell_name:
        return JSONResponse({"error": "cell_id out of range"}, status_code=400)
    changed = _set_cell_state(cell_name, state)
    if changed:
        # Broadcast from request context
        import anyio

        anyio.run(
            manager.broadcast,
            {
                "type": "state",
                "data": {"cells": _snapshot(), "raw": f"mock:{cell_name}:{state}"},
            },
        )
    return JSONResponse({"ok": True, "changed": changed})


@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    await manager.connect(websocket)
    try:
        # Send initial state
        await websocket.send_json({"type": "state", "data": {"cells": _snapshot()}})
        while True:
            # Keep connection alive; we do not expect client messages
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)



# Simple MJPEG stream from RTSP for browser viewing on the login page
def _mjpeg_generator(rtsp_url: str):
    cap = cv2.VideoCapture(rtsp_url)
    if not cap.isOpened():
        # Stop immediately if cannot open
        return
    try:
        while True:
            ret, frame = cap.read()
            if not ret:
                time.sleep(0.2)
                continue
            ok, buffer = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 80])
            if not ok:
                continue
            jpg = buffer.tobytes()
            yield (
                b"--frame\r\n"
                b"Content-Type: image/jpeg\r\n\r\n" + jpg + b"\r\n"
            )
    finally:
        cap.release()


@app.get("/video_feed")
def video_feed(url: Optional[str] = None) -> StreamingResponse:
    """
    MJPEG stream that proxies the RTSP camera for browser playback.
    Optional query param ?url=rtsp://user:pass@host:554/stream1
    Otherwise uses env CAMERA_RTSP_URL or a local default.
    """
    rtsp_url = url or os.getenv("CAMERA_RTSP_URL") or "rtsp://admin:admin123@192.168.1.2:554/stream1"
    return StreamingResponse(
        _mjpeg_generator(rtsp_url),
        media_type="multipart/x-mixed-replace; boundary=frame",
    )

