from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import json
import uvicorn

app = FastAPI()

# Store connected clients: { room_id: [websocket1, websocket2, ...] }
rooms = {}

@app.websocket("/ws/{room_id}/{client_id}")
async def websocket_endpoint(websocket: WebSocket, room_id: str, client_id: str):
    await websocket.accept()
    
    # Add this client to the room
    if room_id not in rooms:
        rooms[room_id] = {}
    rooms[room_id][client_id] = websocket
    
    print(f"Client {client_id} joined room {room_id}")
    
    # Tell this client who else is already in the room
    other_clients = [cid for cid in rooms[room_id] if cid != client_id]
    await websocket.send_text(json.dumps({
        "type": "room-info",
        "clients": other_clients
    }))
    
    # Tell everyone else that a new person joined
    for cid, ws in rooms[room_id].items():
        if cid != client_id:
            await ws.send_text(json.dumps({
                "type": "user-joined",
                "clientId": client_id
            }))
    
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            
            # Forward the message to the intended recipient or broadcast
            target_id = message.get("target")
            broadcast = message.get("broadcast", False)

            if broadcast:
                # Send to everyone except the sender
                for cid, ws in rooms[room_id].items():
                    if cid != client_id:
                        await ws.send_text(json.dumps({
                            **message,
                            "from": client_id
                        }))
            elif target_id and target_id in rooms[room_id]:
                await rooms[room_id][target_id].send_text(json.dumps({
                    **message,
                    "from": client_id
                }))
                
    except WebSocketDisconnect:
        del rooms[room_id][client_id]
        print(f"Client {client_id} left room {room_id}")
        
        # Clean up empty rooms
        if len(rooms[room_id]) == 0:
            del rooms[room_id]
            print(f"Room {room_id} deleted (empty)")
        else:
            for cid, ws in rooms[room_id].items():
                await ws.send_text(json.dumps({
                    "type": "user-left",
                    "clientId": client_id
                }))

import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Serve frontend files
app.mount("/animations", StaticFiles(directory=os.path.join(BASE_DIR, "animations")), name="animations")
app.mount("/", StaticFiles(directory=os.path.join(BASE_DIR, "frontend"), html=True), name="frontend")

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("server:app", host="0.0.0.0", port=port)