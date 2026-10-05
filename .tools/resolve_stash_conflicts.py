import json
import re
from pathlib import Path

base = Path('IPCSIM/frontend/src')
pattern = re.compile(r'^<<<<<<< .*?\n(.*?)^=======\n(.*?)^>>>>>>> .*?\n', re.M | re.S)

def resolve(path, choose):
    source = path.read_text(encoding='utf-8')
    number = 0
    def merge(match):
        nonlocal number
        number += 1
        return choose(number, *match.groups())
    result = pattern.sub(merge, source)
    assert not re.search(r'^(<<<<<<<|=======|>>>>>>>)', result, re.M)
    return result

def localize_jsx(source):
    # Only presentation text/attributes; protocol values and user data stay intact.
    source = re.sub(r'>([^<>{}\n]+)<', lambda m: '>{uiText(' + json.dumps(m[1].strip(), ensure_ascii=True) + ')}<' if m[1].strip() else m[0], source)
    source = re.sub(r'\b(title|description|label|aria-label)="([^"\n]+)"', lambda m: m[1] + '={uiText(' + json.dumps(m[2], ensure_ascii=True) + ')}', source)
    return source

def add_copy(source, messages):
    source = source.replace('t as uiText,', 't as sharedText, getLanguage,')
    # Local copy keeps all other staged/untracked translation files unchanged.
    helper = '\n// Copy introduced upstream; keep shared translation resources unchanged during stash resolution.\n'
    helper += 'const mergedCopy: Record<string, [string, string]> = ' + json.dumps(messages, ensure_ascii=True, indent=2) + '\n'
    helper += '''const uiText = (value: string, ...args: any[]) => {
  const pair = mergedCopy[value]
  return pair ? pair[getLanguage() === 'en' ? 1 : 0].replace(/\{(\d+)\}/g, (_, index) => String(args[index] ?? '')) : sharedText(value, ...args)
}
'''
    last_import = list(re.finditer(r'^import .*$', source, re.M))[-1]
    return source[:last_import.end()] + '\n' + helper + source[last_import.end():]

p = base / 'components/RackOperationPanel.tsx'
def rack_merge(i, upstream, local):
    if i == 1:
        return upstream + '  useLanguage();\n'
    if i == 2:
        result = localize_jsx(upstream)
        result = result.replace("checkBusy ? 'Đang kiểm tra…' : 'Kiểm tra lỗi'", "checkBusy ? uiText('Checking faults…') : uiText('Check faults')")
        result = result.replace("device?.device_type || 'Mode unknown'", "device?.device_type || uiText('Mode unknown')")
        result = result.replace("connected ? 'ONLINE' : 'OFFLINE'", "connected ? uiText('ONLINE') : uiText('OFFLINE')")
        result = result.replace("device?.simulation_online ? 'READY' : isSimulation ? 'UNAVAILABLE' : 'N/A'", "device?.simulation_online ? uiText('READY') : isSimulation ? uiText('UNAVAILABLE') : uiText('N/A')")
        result = result.replace('{recoveryError}', '{errorText(recoveryError)}')
        result = result.replace('(mechanicalLocked || fault || current?.phase', '(isSimulation && (mechanicalLocked || fault || current?.phase').replace("=== 'ERROR') && <Alert", "=== 'ERROR')) && <Alert")
        result = result.replace("action === 'RESUME' ? 'Resume operation' : action === 'ABORT' ? 'Abort operation' : 'Run homing'", "action === 'RESUME' ? uiText('Resume operation') : action === 'ABORT' ? uiText('Abort operation') : uiText('Run homing')")
        result = result.replace("{mechanical?.system_state || 'ERROR'}", "{uiText(mechanical?.system_state || 'ERROR')}").replace('{fault?.previous_state}', '{uiText(fault?.previous_state || \'\')}')
        result = result.replace("{fault?.error_code || current?.error || 'Waiting for Simulation snapshot'}", "{fault?.error_code ? `${uiText(fault.error_code)} (${fault.error_code})` : current?.error ? errorText(current.error) : uiText('Waiting for Simulation snapshot')}")
        # The local reset remains available for IPC hardware; Simulation recovery is backend-authoritative.
        reset_start = local.index("      {current?.phase === 'ERROR'")
        result += local[reset_start:].replace("current?.phase === 'ERROR'", "!isSimulation && current?.phase === 'ERROR'", 1)
        return result
    if i == 3:
        declarations = upstream[:upstream.index('              return <Box')]
        return declarations + local[local.index('              return <Box'):]
    if i == 4:
        return local.replace('`${100 / 13}%`', '`${mechanical ? 100 / 7 : 100 / 13}%`')
    if i == 5:
        # One reset handler for both legacy presentations; never reset Simulation locally.
        return "        {!isSimulation && current?.phase === 'ERROR' ? <Button color=\"error\" onClick={resetLocalOperation}>{uiText(\"I checked · reset\")}</Button> : <Button onClick={() => setExecutionDialogOpen(false)}>{current ? uiText('Continue in background') : uiText('Done')}</Button>}\n"
    raise AssertionError(i)
s = resolve(p, rack_merge)
s = s.replace('  const [recoveryError, setRecoveryError] = useState(\'\')', "  const [recoveryError, setRecoveryError] = useState<any>('')")
s = re.sub(r"setRecoveryError\(error\?\.response\?\.data\?\.detail \|\| '[^']+'\)", 'setRecoveryError(error)', s)
s = s.replace("const canOperate = permissions.includes('inventory.add_operation')", "const canOperate = permissions.includes('inventory.add_operation')\n  const canRecover = permissions.includes('cabinet.control')")
s = s.replace('disabled={!canOperate || recoveryBusy}', 'disabled={!canRecover || recoveryBusy}')
s = s.replace('if (!mechanical || !recoveryAction) return', 'if (!mechanical || !recoveryAction || !canRecover || recoveryBusy) return')
s = s.replace('disabled={recoveryBusy} onClick={() => void performRecovery()}', 'disabled={recoveryBusy || !canRecover} onClick={() => void performRecovery()}')
# Consolidate local reset event handler, rather than duplicating its state mutations.
start = s.index("onClick={() => {\n        setQueue([])")
end = s.index('}}>', start)
body = s[start + len('onClick={() => {'):end]
s = s[:start] + 'onClick={resetLocalOperation}' + s[end + 2:]
hook = "  const resetLocalOperation = () => {\n    if (isSimulation) return\n" + body + '\n  }\n\n'
s = s.replace("  const hasPendingOpen =", hook + "  const hasPendingOpen =", 1)
s = localize_jsx(s)
for key in ['Resume interrupted command', 'Verify reference before homing', 'Abort interrupted command', 'Homing moves from the current position. Do not confirm an unverified reference.', 'The same command continues from its saved position.', 'The cabinet stops in place; homing is required before a new command.']:
    s = s.replace("'" + key + "'", "uiText('" + key + "')")
s = s.replace('<DialogTitle>{recoveryAction', "<Box sx={{ position: 'absolute', top: 16, right: 18 }}><LanguageSelector /></Box>\n      <DialogTitle sx={{ pr: 8 }}>{recoveryAction")
s = s.replace('{recoveryError}', '{errorText(recoveryError)}')
s = s.replace("{entry.event}</Typography>", "{uiText(entry.event)}</Typography>")
# Dynamic fault information is presentation only; enum/payload values stay raw.
s = s.replace('Current: {fault?.current_position', "{uiText('Current:')} {fault?.current_position").replace('Target: {fault?.target_position', "{uiText('Target:')} {fault?.target_position")
s = s.replace('Command: {fault.command_id}', "{uiText('Command:')} {fault.command_id}")
s = s.replace('Movement interrupted at Rack {(fault.moving_rack_id - 1) % 6 + 1}', "{uiText('Movement interrupted at Rack {0}', (fault.moving_rack_id - 1) % 6 + 1)}")
copy = {
    'Check faults': ['Kiểm tra lỗi', 'Check faults'], 'Checking faults…': ['Đang kiểm tra…', 'Checking faults…'],
    'Không có lỗi': ['Không có lỗi', 'No faults'],
    'Resume operation': ['Tiếp tục thao tác', 'Resume operation'], 'Abort operation': ['Hủy thao tác', 'Abort operation'], 'Run homing': ['Chạy về gốc', 'Run homing'],
    'Resume interrupted command': ['Tiếp tục lệnh bị gián đoạn', 'Resume interrupted command'],
    'Verify reference before homing': ['Xác minh vị trí gốc trước khi homing', 'Verify reference before homing'],
    'Abort interrupted command': ['Hủy lệnh bị gián đoạn', 'Abort interrupted command'],
    'Confirm inspected obstacles, limit sensors and actual reference position.': ['Xác nhận đã kiểm tra vật cản, cảm biến giới hạn và vị trí gốc thực tế.', 'Confirm inspected obstacles, limit sensors and actual reference position.'],
    'Homing moves from the current position. Do not confirm an unverified reference.': ['Homing di chuyển từ vị trí hiện tại. Chỉ xác nhận sau khi đã kiểm tra vị trí gốc.', 'Homing moves from the current position. Do not confirm an unverified reference.'],
    'The same command continues from its saved position.': ['Lệnh hiện tại tiếp tục từ vị trí đã lưu.', 'The same command continues from its saved position.'],
    'The cabinet stops in place; homing is required before a new command.': ['Tủ dừng tại chỗ; cần homing trước khi gửi lệnh mới.', 'The cabinet stops in place; homing is required before a new command.'],
    'Confirm inspection': ['Xác nhận đã kiểm tra', 'Confirm inspection'], 'Waiting for Simulation snapshot': ['Đang chờ trạng thái Simulation', 'Waiting for Simulation snapshot'],
    'RECOVERING': ['Đang phục hồi', 'Recovering'], 'STOPPED': ['Đã dừng', 'Stopped'], 'COMMUNICATION_LOST': ['Mất liên lạc', 'Communication lost'],
    'OBSTRUCTED': ['Có vật cản', 'Obstructed'], 'REFERENCE_LOST': ['Mất vị trí gốc', 'Reference lost'],
    'Movement interrupted at Rack {0}': ['Di chuyển bị gián đoạn tại rack {0}', 'Movement interrupted at Rack {0}'],
    'Current:': ['Hiện tại:', 'Current:'], 'Target:': ['Đích:', 'Target:'], 'Command:': ['Lệnh:', 'Command:'],
}
p.write_text(add_copy(s, copy), encoding='utf-8')

p = base / 'pages/CabinetDetail.tsx'
def detail_merge(i, upstream, local):
    if i == 1: return local.splitlines()[0] + '\n' + upstream
    if i == 2: return upstream.replace('message: string', 'message: any')
    if i == 3: return localize_jsx(upstream)
    raise AssertionError(i)
s = resolve(p, detail_merge)
p.write_text(s, encoding='utf-8')

p = base / 'pages/Breakdown.tsx'
s = resolve(p, lambda i, upstream, local: localize_jsx(upstream))
s = s.replace('{stat.label}', '{uiText(stat.label)}').replace('label={error}', 'label={errorText(error)}')
s = s.replace("errors.length ? 'Cần kiểm tra' : 'Không báo lỗi'", "errors.length ? uiText('Cần kiểm tra') : uiText('Không báo lỗi')")
s = s.replace("return `Cabinet ${String(c.cabinet_index).padStart(2, '0')} / Rack ${String(r.rack_index).padStart(2, '0')}`", "return `${uiText('Cabinet')} ${String(c.cabinet_index).padStart(2, '0')} / Rack ${String(r.rack_index).padStart(2, '0')}`")
s = s.replace('Có {active} rack báo lỗi trong dữ liệu gần nhất. Kiểm tra vật cản, độ lệch và tải động cơ trước khi tiếp tục thao tác.', '{uiText("Có")} {active} {uiText("rack báo lỗi trong dữ liệu gần nhất. Kiểm tra vật cản, độ lệch và tải động cơ trước khi tiếp tục thao tác.")}')
copy = {
    'Vị trí rack': ['Vị trí rack', 'Rack location'],
    'Chưa tải được vị trí rack. Các bản ghi đang hiển thị ID kỹ thuật; vui lòng làm mới.': ['Chưa tải được vị trí rack. Các bản ghi đang hiển thị ID kỹ thuật; vui lòng làm mới.', 'Could not load rack locations. Records show technical IDs; please refresh.'],
}
p.write_text(add_copy(s, copy), encoding='utf-8')

p = base / 'pages/Cabinets.tsx'
s = resolve(p, lambda i, upstream, local: localize_jsx(upstream))
s = s.replace('{statusLabel}', '{uiText(statusLabel)}').replace('{fault.previous_state}', '{uiText(fault.previous_state)}').replace('{fault.error_code}', '{`${uiText(fault.error_code)} (${fault.error_code})`}')
s = s.replace('`Tủ ${cabinet.id}`', 'uiText("Tủ {0}", cabinet.id)')
copy = {
    'RECOVERING': ['Đang phục hồi', 'Recovering'], 'STOPPED': ['Đã dừng', 'Stopped'], 'COMMUNICATION_LOST': ['Mất liên lạc', 'Communication lost'],
    'OBSTRUCTED': ['Có vật cản', 'Obstructed'], 'REFERENCE_LOST': ['Mất vị trí gốc', 'Reference lost'],
}
p.write_text(add_copy(s, copy), encoding='utf-8')
print('Resolved each conflict hunk in the four files; retained upstream mechanics and local i18n/error state.')
