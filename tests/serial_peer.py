"""Test-only TCP transport around the actual Simulation controller, not fake telemetry."""
import argparse
from pathlib import Path
import select
import socket
import sys
import time
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from Simulation.virtual_serial.virtual_master_controller import MasterCom


class SocketSerial:
    def __init__(self, conn):
        self.conn = conn
    @property
    def in_waiting(self):
        return 4096 if select.select([self.conn], [], [], 0)[0] else 0
    def read(self, count):
        data = self.conn.recv(count)
        if not data:
            raise ConnectionError('Peer disconnected')
        return data
    def write(self, data):
        self.conn.sendall(data)
        return len(data)
    def close(self):
        self.conn.close()


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--port', type=int, required=True)
    parser.add_argument('--log', required=True)
    parser.add_argument('--group', type=int, default=1)
    args = parser.parse_args()
    with socket.socket() as listener:
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind(('127.0.0.1', args.port))
        listener.listen()
        print('READY', flush=True)
        while True:
            conn, _ = listener.accept()
            controller = MasterCom(args.group - 1, port='')
            original = controller.determine_operationInformation
            def record(frame):
                with open(args.log, 'a', encoding='utf-8') as log:
                    log.write(frame + '\n')
                return original(frame)
            controller.determine_operationInformation = record
            controller.ser = SocketSerial(conn)
            try:
                controller.start()
                while True:
                    controller.poll()
                    # UI queues are not consumed by a GUI in this headless test.
                    for queue in (controller.messages, controller.operation_samples):
                        while not queue.empty():
                            queue.get_nowait()
                    time.sleep(.02)
            except (OSError, ConnectionError):
                pass
            finally:
                controller.execute_stopRunning()
