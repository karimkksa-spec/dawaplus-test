import React, { useEffect, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';
import { requestLocation } from './location-request.mjs';

export default function LocationNotice({ onPoint }) {
  const [open, setOpen] = useState(() => sessionStorage.getItem('dawa-location-dismissed') !== '1');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const dialog = useRef(null);

  useEffect(() => {
    if (!open) return;
    const element = dialog.current;
    element.showModal();
    return () => element.close();
  }, [open]);

  function dismiss() {
    sessionStorage.setItem('dawa-location-dismissed', '1');
    setOpen(false);
  }

  async function locate() {
    setBusy(true);
    setMessage('');
    try {
      const result = await requestLocation();
      if (!dialog.current?.open) return;
      if (result.point) {
        onPoint(result.point);
        dismiss();
      } else {
        setMessage(result.error);
      }
    } catch {
      setMessage('تعذّر تحديد موقعك. يمكنك المتابعة واختياره عند الطلب.');
    } finally {
      setBusy(false);
    }
  }

  if (!open) return null;
  return (
    <dialog ref={dialog} className="location-prompt" aria-labelledby="location-title"
      aria-describedby="location-description" onCancel={event => { event.preventDefault(); dismiss(); }}>
      <span className="location-prompt-icon"><MapPin size={28} aria-hidden="true" /></span>
      <h2 id="location-title">تحديد موقع التوصيل</h2>
      <p id="location-description">هل تسمح لدواء بلس باستخدام موقعك لتحديد نقطة التوصيل؟</p>
      {message && <p className="location-feedback" role="status">{message}</p>}
      <div className="location-prompt-actions">
        <button type="button" className="primary" onClick={locate} disabled={busy}>
          {busy ? 'جارٍ تحديد موقعك…' : 'موافق، حدّد موقعي'}
        </button>
        <button type="button" className="soft" onClick={dismiss}>المتابعة دون تحديد الموقع</button>
      </div>
    </dialog>
  );
}
