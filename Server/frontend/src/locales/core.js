import messages from './messages.json' with { type: 'json' };

export const LANGUAGE_KEY = 'smartInventory.language';
let language = 'vi';
try { if (globalThis.localStorage?.getItem(LANGUAGE_KEY) === 'en') language = 'en'; } catch {}
const listeners = new Set();
const failures = [];
/** Inspect this bounded list from the debugger; original payloads are retained by reference. */
export const getErrorDiagnostics = () => failures.slice();
export function recordError(error) {
  failures.push(error);
  if (failures.length > 100) failures.shift();
  return error;
}
export const getLanguage = () => language;
export const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
export function setLanguage(next) {
  if (!['vi', 'en'].includes(next)) return;
  language = next;
  try { globalThis.localStorage?.setItem(LANGUAGE_KEY, next); } catch {}
  if (globalThis.document) document.documentElement.lang = next;
  listeners.forEach(listener => listener());
}
if (globalThis.document) document.documentElement.lang = language;
if (globalThis.addEventListener) globalThis.addEventListener('storage', event => {
  if (event.key === LANGUAGE_KEY) setLanguage(event.newValue === 'en' ? 'en' : 'vi');
});

const entries = Object.entries(messages);
const exact = new Map();
for (const [key, pair] of entries) for (const text of [key, ...pair]) exact.set(text, pair);
const escape = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const patterns = entries.filter(([key]) => /\{\d+\}/.test(key)).map(([key, pair]) => {
  const indices = [...key.matchAll(/\{(\d+)\}/g)].map(match => Number(match[1]));
  const regex = new RegExp('^' + key.split(/\{\d+\}/).map(escape).join('(.+?)') + '$');
  return {regex, indices, pair, key};
});
const interpolate = (text, args) => text.replace(/\{(\d+)\}/g, (_, i) => String(args[i] ?? ''));
/** Translate UI copy only. Never pass user names, notes or business data here. */
export function t(value, ...args) {
  if (typeof value !== 'string') return value;
  const pair = exact.get(value);
  if (pair) return interpolate(pair[language === 'en' ? 1 : 0], args);
  for (const pattern of patterns) {
    const match = value.match(pattern.regex);
    if (match) {
      const values = [];
      pattern.indices.forEach((index, i) => { values[index] = match[i + 1]; });
      // These placeholders carry protocol enums, rather than user/business text.
      const enumArgs = {
        'Rack {0} light turned {1}.': [1],
        'Moving Rack {0} {1}': [1], 'Moving Rack {0} {1} · {2}%': [1],
        'Moving R{0} {1} · {2}%': [1], 'MOVING {0} · {1}%': [0],
        'Gửi lệnh {0} tới {1}? Kiểm tra khu vực rack trước khi xác nhận.': [0],
      };
      for (const index of enumArgs[pattern.key] || []) values[index] = t(values[index]);
      if (pattern.key.includes('because breakdown is active') || pattern.key.includes('has an active breakdown')) {
        values[1] = values[1].split(', ').map(part => exact.has(part) ? t(part) : t('Unknown breakdown')).join(', ');
      }
      if (pattern.key === 'The password is too similar to the {0}.') values[0] = fieldText(values[0]);
      return interpolate(pattern.pair[language === 'en' ? 1 : 0], values);
    }
  }
  return value;
}

/** Retains the original object/string for diagnostics; never edits API responses. */
export function errorText(error) {
  if (!error) return '';
  const original = error;
  const data = original?.response?.data ?? original;
  const code = data?.code ?? data?.error_code ?? data?.detail?.code ?? data?.error?.code ?? original?.code ?? original?.response?.status;
  const detail = data?.detail ?? data?.error ?? data?.message ?? original?.message ?? data;
  if (Array.isArray(detail)) {
    const result = detail.map(item => {
      const field = item.loc?.filter(part => part !== 'body').join('.') || '';
      return (field ? field + ': ' : '') + errorText(item);
    }).join('; ');
    return result + (code !== undefined && code !== null ? ` (${String(code)})` : '');
  }
  const message = typeof detail === 'string' ? detail : detail?.msg ?? detail?.message;
  // Django ValidationError is serialized as a quoted list by the existing API.
  if (message?.startsWith('[') && message.endsWith(']')) {
    const parts = [...message.matchAll(/(['"])(.*?)\1(?=,\s*|\]$)/g)].map(match => match[2]);
    if (parts.length) return parts.map(part => errorText(part)).join('; ') + (code !== undefined && code !== null ? ` (${String(code)})` : '');
  }
  const messageKnown = message && (exact.has(message) || patterns.some(pattern => pattern.regex.test(message)));
  const codeKnown = code !== undefined && exact.has(String(code));
  const translated = messageKnown ? t(message) : codeKnown ? t(String(code)) : '';
  const known = messageKnown || codeKnown;
  if (!known && !failures.includes(original)) recordError(original);
  const result = known ? translated : t('Unknown system error');
  return result + (code !== undefined && code !== null ? ` (${String(code)})` : '');
}
export function statusText(value) {
  if (!value) return value;
  const result = t(String(value));
  return result === String(value) && !exact.has(String(value)) ? `${t('Unknown status')} (${value})` : result;
}
export function fieldText(field) {
  const key = 'field.' + field;
  return messages[key] ? t(key) : String(field);
}

// Native form validation keeps its constraints; only the browser-facing copy changes.
const validationFields = new Set();
function validationKey(input) {
  const state = input.validity;
  if (state.valueMissing) return 'Required field';
  if (state.typeMismatch) return input.type === 'email' ? 'Invalid email' : 'Invalid URL';
  if (state.rangeOverflow || state.rangeUnderflow || state.stepMismatch) return 'Value out of range';
  if (state.tooShort) return 'Value too short';
  if (state.tooLong) return 'Value too long';
  if (state.patternMismatch) return 'Value does not match format';
  if (state.customError) {
    if (exact.has(input.validationMessage)) return input.validationMessage;
    recordError(input.validationMessage);
  }
  return 'Invalid value';
}
if (globalThis.document) {
  document.addEventListener('invalid', event => {
    const input = event.target;
    if (!input?.setCustomValidity) return;
    input.setCustomValidity(t(validationKey(input)));
    validationFields.add(input);
  }, true);
  const clearLocalizedValidation = event => {
    if (validationFields.has(event.target)) {
      event.target.setCustomValidity('');
      validationFields.delete(event.target);
    }
  };
  document.addEventListener('input', clearLocalizedValidation, true);
  document.addEventListener('change', clearLocalizedValidation, true);
  subscribe(() => {
    for (const input of validationFields) {
      if (!input.isConnected) validationFields.delete(input);
      else input.setCustomValidity(t(input.validationMessage));
    }
  });
}
