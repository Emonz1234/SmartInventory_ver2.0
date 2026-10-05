import React, { useEffect, useRef, useState } from 'react';
import { useLanguage, t, errorText } from './i18n';
import { ConfirmButton } from './ui.jsx';

export default function RackCommands({ rack, api, allowed }) {
  const language = useLanguage();
  const text = (vi, en) => language === 'en' ? en : vi;
  const [operations, setOperations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [commandId, setCommandId] = useState(null);
  const inFlight = useRef(false);
  useEffect(() => {
    let active = true;
    setLoading(true);
    const load = async () => {
      try {
        const rows = await api(`operations?source_type=${rack.source_type}&device_id=${encodeURIComponent(rack.ipc_id)}`);
        if (active) { setOperations(rows); setLoading(false); }
      } catch (failure) { if (active) { setError(failure); setLoading(true); } }
    };
    void load();
    const timer = setInterval(load, 2000);
    return () => { active = false; clearInterval(timer); };
  }, [api, rack.ipc_id, rack.source_type]);
  const pending = operations.find(op => !['confirmed', 'failed', 'cancelled'].includes(op.state));
  const current = operations.find(op => op.id === commandId) || pending;
  const reason = !allowed ? text('Không có quyền điều khiển.', 'Control permission required.')
    : !rack.online ? text('IPC đang offline.', 'IPC is offline.')
    : !rack.synchronized ? text('IPC chưa đồng bộ dữ liệu.', 'IPC is not synchronized.')
    : !rack.serial_connected ? text('Serial chưa kết nối với Simulation/thiết bị.', 'Serial is disconnected from Simulation/device.')
    : rack.configuration_status === 'pending_simulator' ? t('Simulator does not support this cabinet group yet')
    : loading ? text('Đang kiểm tra lệnh chờ…', 'Checking pending commands…')
    : pending ? text('Xử lý và xác nhận kết quả lệnh đang chờ trước khi gửi lệnh mới.', 'Resolve and confirm the pending command before sending another.') : '';
  async function send(command) {
    if (inFlight.current || reason) return;
    inFlight.current = true; setSending(true); setError(null);
    try {
      const request_key = crypto.randomUUID();
      const result = await api(`racks/${rack.id}/commands`, 'POST', {command, request_key});
      setCommandId(result.id);
      setOperations(rows => [{...result, execution_state:'awaiting_device', rack_id:rack.id, kind:command}, ...rows]);
    } catch (failure) { setError(failure); }
    finally { inFlight.current = false; setSending(false); }
  }
  return <>
    <div className="actions">{['OPEN', 'CLOSE', 'VENTILATE'].map(command => <ConfirmButton key={command}
      message={t('Gửi lệnh {0} tới {1}? Kiểm tra khu vực rack trước khi xác nhận.', t(command), rack.name)}
      disabled={sending || !!reason} onClick={() => void send(command)}>{t(command)}</ConfirmButton>)}</div>
    {reason && <p role="status">{reason}</p>}
    {sending && <p role="status">{text('Đang gửi yêu cầu…', 'Sending request…')}</p>}
    {error && <p role="alert" className="error">{errorText(error)}</p>}
    {current && <p role={['uncertain', 'expired', 'failed'].includes(current.state) || current.execution_state === 'fault' ? 'alert' : 'status'}>
      {text('Lệnh', 'Command')} {current.id}: {current.execution_state === 'completed'
        ? text('Thiết bị đã xác nhận hoàn thành. Ghi nhận kết quả vận hành bên dưới để giải phóng lệnh.', 'Device confirmed completion. Record the outcome below to resolve the command.')
        : current.execution_state === 'timeout' ? text('Hết thời gian chờ phản hồi; chưa biết kết quả thực tế.', 'Response timeout; the physical outcome is unknown.')
        : current.execution_state === 'fault' ? text('Thiết bị báo lỗi; cần kiểm tra.', 'Device reported a fault; inspection required.')
        : ['uncertain', 'expired', 'failed'].includes(current.state) ? text('Lệnh không được xác nhận; cần kiểm tra trước khi thử lại.', 'Command not confirmed; inspect before retrying.')
        : text('Đang chờ phản hồi thực tế từ thiết bị.', 'Waiting for actual device feedback.')}
      {current.error && <> {errorText(current.error)}</>}
    </p>}
  </>;
}
