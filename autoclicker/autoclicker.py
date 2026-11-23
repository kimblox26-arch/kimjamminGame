"""
오토 마우스 (Windows 전용, 외부 라이브러리 없음)
- 항상 위에 떠 있는 작은 창 (다른 앱 위에 표시)
- 간격(ms) 설정: 1ms = 초당 최대 1000클릭
- F6: 시작/정지 (다른 앱에 포커스가 있어도 동작)
- F7: 프로그램 종료
- 비상정지: 마우스를 화면 왼쪽 위 모서리(0,0)로 이동
실행: python autoclicker.py
"""
import ctypes, threading, time, tkinter as tk
from ctypes import wintypes

user32 = ctypes.windll.user32
winmm = ctypes.windll.winmm

INPUT_MOUSE = 0
LEFTDOWN, LEFTUP = 0x0002, 0x0004
RIGHTDOWN, RIGHTUP = 0x0008, 0x0010
VK_F6, VK_F7 = 0x75, 0x76

class MOUSEINPUT(ctypes.Structure):
    _fields_ = [("dx", wintypes.LONG), ("dy", wintypes.LONG), ("mouseData", wintypes.DWORD),
                ("dwFlags", wintypes.DWORD), ("time", wintypes.DWORD),
                ("dwExtraInfo", ctypes.POINTER(ctypes.c_ulong))]

class INPUT(ctypes.Structure):
    class _U(ctypes.Union):
        _fields_ = [("mi", MOUSEINPUT)]
    _anonymous_ = ("u",)
    _fields_ = [("type", wintypes.DWORD), ("u", _U)]

def make_click(down, up):
    arr = (INPUT * 2)()
    for i, f in enumerate((down, up)):
        arr[i].type = INPUT_MOUSE
        arr[i].mi.dwFlags = f
    return arr

CLICKS = {"왼쪽": make_click(LEFTDOWN, LEFTUP), "오른쪽": make_click(RIGHTDOWN, RIGHTUP)}

class App:
    def __init__(self):
        self.running = False
        self.count = 0
        self.root = tk.Tk()
        self.root.title("오토 마우스")
        self.root.attributes("-topmost", True)   # 다른 앱 위에 항상 표시
        self.root.attributes("-alpha", 0.9)
        self.root.resizable(False, False)

        tk.Label(self.root, text="간격 (ms)").grid(row=0, column=0, padx=6, pady=4, sticky="w")
        self.interval = tk.StringVar(value="1")
        tk.Entry(self.root, textvariable=self.interval, width=8).grid(row=0, column=1, padx=6)

        tk.Label(self.root, text="버튼").grid(row=1, column=0, padx=6, sticky="w")
        self.button = tk.StringVar(value="왼쪽")
        tk.OptionMenu(self.root, self.button, *CLICKS).grid(row=1, column=1, padx=6, sticky="ew")

        self.btn = tk.Button(self.root, text="시작 (F6)", width=16, command=self.toggle)
        self.btn.grid(row=2, column=0, columnspan=2, pady=4)
        self.status = tk.Label(self.root, text="정지됨 | F7 종료")
        self.status.grid(row=3, column=0, columnspan=2, pady=(0, 6))

        threading.Thread(target=self.hotkeys, daemon=True).start()
        self.update_status()

    def toggle(self):
        if self.running:
            self.running = False
            return
        try:
            ms = max(0.0, float(self.interval.get()))
        except ValueError:
            return
        self.running = True
        threading.Thread(target=self.click_loop, args=(ms / 1000.0, CLICKS[self.button.get()]), daemon=True).start()

    def click_loop(self, interval, inp):
        winmm.timeBeginPeriod(1)  # 윈도우 타이머 정밀도 1ms
        size = ctypes.sizeof(INPUT)
        pt = wintypes.POINT()
        nxt = time.perf_counter()
        try:
            while self.running:
                user32.GetCursorPos(ctypes.byref(pt))
                if pt.x == 0 and pt.y == 0:  # 비상정지
                    self.running = False
                    break
                user32.SendInput(2, inp, size)
                self.count += 1
                nxt += interval
                remain = nxt - time.perf_counter()
                if remain > 0.002:
                    time.sleep(remain - 0.0015)
                while time.perf_counter() < nxt:  # 정밀 대기 (busy-wait)
                    pass
                if time.perf_counter() - nxt > 0.05:  # 너무 밀리면 재동기화
                    nxt = time.perf_counter()
        finally:
            winmm.timeEndPeriod(1)

    def hotkeys(self):
        prev6 = prev7 = False
        while True:
            f6 = bool(user32.GetAsyncKeyState(VK_F6) & 0x8000)
            f7 = bool(user32.GetAsyncKeyState(VK_F7) & 0x8000)
            if f6 and not prev6:
                self.root.after(0, self.toggle)
            if f7 and not prev7:
                self.running = False
                self.root.after(0, self.root.destroy)
                return
            prev6, prev7 = f6, f7
            time.sleep(0.02)

    def update_status(self):
        last = getattr(self, "_last", (0, time.perf_counter()))
        now = time.perf_counter()
        cps = (self.count - last[0]) / max(now - last[1], 1e-6)
        self._last = (self.count, now)
        if self.running:
            self.btn.config(text="정지 (F6)")
            self.status.config(text=f"실행 중 | {cps:.0f} 클릭/초")
        else:
            self.btn.config(text="시작 (F6)")
            self.status.config(text=f"정지됨 | 총 {self.count} | F7 종료")
        self.root.after(500, self.update_status)

if __name__ == "__main__":
    App().root.mainloop()
