const Bus = (() => {
  const handlers = {};
  return {
    on(name, fn)   { (handlers[name] ||= []).push(fn); },
    off(name, fn)  { handlers[name] = (handlers[name] || []).filter(f => f !== fn); },
    emit(name, d)  { (handlers[name] || []).forEach(fn => fn(d)); }
  };
})();