// localStorage wrapper. Every access is guarded: storage can be blocked or full.
// Values read back are untrusted; see validate.js.
const P = 'sft.';
export const store = {
  get(k, d) { try { const v = localStorage.getItem(P + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(P + k, JSON.stringify(v)); } catch { /* full or blocked */ } },
  del(k) { try { localStorage.removeItem(P + k); } catch { /* ignore */ } }
};
