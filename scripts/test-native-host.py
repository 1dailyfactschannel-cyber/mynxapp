import subprocess
import struct
import json
import sys
import time
import threading

exe = r"C:\Users\Valentin\AppData\Local\Mynx\mynx-native-host.exe"

msg = json.dumps({"type": "status"}).encode("utf-8")
length_prefix = struct.pack("<I", len(msg))
payload = length_prefix + msg

print(f"Sending {len(payload)} bytes: {payload!r}")

stderr_data = []
def read_stderr():
    while True:
        data = proc.stderr.read(1)
        if not data:
            break
        stderr_data.append(data)

proc = subprocess.Popen(
    [exe],
    stdin=subprocess.PIPE,
    stdout=subprocess.PIPE,
    stderr=subprocess.PIPE,
    bufsize=0,
)

t = threading.Thread(target=read_stderr, daemon=True)
t.start()

proc.stdin.write(payload)
proc.stdin.flush()
proc.stdin.close()
print("Stdin closed, waiting for response...")

# Read all stdout with timeout
stdout_chunks = []
def read_stdout():
    while True:
        data = proc.stdout.read(1)
        if not data:
            break
        stdout_chunks.append(data)

t2 = threading.Thread(target=read_stdout, daemon=True)
t2.start()

# Wait up to 5s for process to finish
for i in range(50):
    time.sleep(0.1)
    if proc.poll() is not None:
        print(f"Process exited after {(i+1)*0.1:.1f}s with code {proc.returncode}")
        break
else:
    print("Process still running after 5s, terminating...")
    proc.terminate()
    time.sleep(0.5)

t.join(timeout=1)
t2.join(timeout=1)

stdout_bytes = b"".join(stdout_chunks)
stderr_bytes = b"".join(stderr_data)

print(f"Stdout ({len(stdout_bytes)} bytes): {stdout_bytes!r}")
print(f"Stderr: {stderr_bytes!r}")

if len(stdout_bytes) >= 4:
    length = struct.unpack("<I", stdout_bytes[:4])[0]
    print(f"Response length: {length}")
    if length + 4 <= len(stdout_bytes):
        response = stdout_bytes[4:4+length].decode("utf-8")
        print(f"Response: {response}")
