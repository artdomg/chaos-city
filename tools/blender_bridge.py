import bpy
import json
import socket
import threading
import queue
import traceback

PORT = 9673
_q = queue.Queue()


def run_on_main(code, res):
    try:
        ns = {'bpy': bpy}
        exec(code, ns)
        res['result'] = str(ns.get('RESULT', ''))
        res['status'] = 'success'
    except Exception:
        res['result'] = traceback.format_exc()
        res['status'] = 'error'


def timer():
    while True:
        try:
            code, res, ev = _q.get_nowait()
        except queue.Empty:
            break
        run_on_main(code, res)
        ev.set()
    return 0.05


def server():
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(('127.0.0.1', PORT))
    s.listen(4)
    while True:
        c, _ = s.accept()
        try:
            data = b''
            cmd = None
            while True:
                chunk = c.recv(65536)
                if not chunk:
                    break
                data += chunk
                try:
                    cmd = json.loads(data.decode())
                    break
                except Exception:
                    continue
            if cmd is None:
                cmd = {}
            t = cmd.get('type')
            if t == 'get_scene_info':
                resp = {'status': 'success', 'result': 'blender-bridge ' + bpy.app.version_string}
            elif t == 'execute_code':
                res = {}
                ev = threading.Event()
                _q.put((cmd['params']['code'], res, ev))
                ev.wait(60)
                resp = res
            else:
                resp = {'status': 'error', 'result': 'unknown command'}
            c.sendall(json.dumps(resp).encode())
        except Exception as e:
            try:
                c.sendall(json.dumps({'status': 'error', 'result': str(e)}).encode())
            except Exception:
                pass
        finally:
            c.close()


threading.Thread(target=server, daemon=True).start()
print('BRIDGE READY', PORT)
if bpy.app.background:
    while True:
        try:
            code, res, ev = _q.get(timeout=0.5)
        except queue.Empty:
            continue
        run_on_main(code, res)
        ev.set()
else:
    bpy.app.timers.register(timer, first_interval=0.1)
