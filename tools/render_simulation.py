"""Capture real Qt dashboard layouts using only the running simulator's data."""
import os
from pathlib import Path
import sys
import time

os.environ.setdefault('QT_QPA_PLATFORM', 'offscreen')
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from PyQt6.QtWidgets import QApplication
from PyQt6.QtGui import QFontDatabase
from Simulation.main import MainWindow

app = QApplication([])
if not QFontDatabase.families():
    # Windows Qt's offscreen backend does not discover system fonts automatically.
    for name in ('segoeui.ttf', 'segoeuib.ttf', 'seguisym.ttf'):
        QFontDatabase.addApplicationFont(str(Path(os.environ.get('WINDIR', 'C:/Windows')) / 'Fonts' / name))
window = MainWindow()
window.show()
group = window.uic.rackGroupList[0]
group.serialPort.setCurrentIndex(0)
group.runButton.click()
deadline = time.monotonic() + 3
while not group.localButtons[0].isEnabled() and time.monotonic() < deadline:
    app.processEvents()
    time.sleep(.01)
group.localButtons[0].click()
deadline = time.monotonic() + 4
while time.monotonic() < deadline:
    app.processEvents()
    time.sleep(.01)
output = Path('test-results/simulation')
output.mkdir(parents=True, exist_ok=True)
for width, height in ((1920, 1080), (1440, 900), (1280, 720), (1024, 768), (800, 600)):
    window.resize(width, height)
    for _ in range(5):
        app.processEvents()
    window.grab().save(str(output / f'dashboard-{width}x{height}.png'))
    if width == 1024:
        group.isHardLock.grab().save(str(output / 'lock-card.png'))
    print(width, height, 'scroll', window.uic.scrollArea.horizontalScrollBar().maximum(),
          window.uic.scrollArea.verticalScrollBar().maximum())
group.ObstructCheckBox.setChecked(True)
group.simulatorErrorButton.click()
deadline = time.monotonic() + .2
while time.monotonic() < deadline:
    app.processEvents()
    time.sleep(.01)
window.resize(1440, 900)
app.processEvents()
window.grab().save(str(output / 'dashboard-fault.png'))
window.stop_master_controller(0)
while window.rack_group[0].isRunning():
    app.processEvents()
    time.sleep(.01)
app.processEvents()
window.close()
