// Tab-látható-állapot pollozó segédfüggvény.
// useEffect-ből hívva: a return-elt cleanup-pal egyben leállítható.
//
// - Induláskor (ha látható a tab) azonnal egyszer fut + indítja az interval-t
// - Tab háttérbe lép → clearInterval (nincs felesleges fetch)
// - Tab előtérbe visszatér → azonnali run + új interval
// - Cleanup-pal teljesen leáll, listener is leveszi
//
// Példa:
//   useEffect(() => startVisiblePolling(poll, 10_000), []);

interface Options {
  /** Mountkor azonnal fusson-e egyszer. Default: true. */
  runImmediately?: boolean;
  /** Tab előtérbe visszatértekor azonnal fusson-e egyszer. Default: true. */
  runOnVisible?: boolean;
}

export function startVisiblePolling(
  fn: () => void | Promise<void>,
  intervalMs: number,
  options: Options = {}
): () => void {
  const { runImmediately = true, runOnVisible = true } = options;
  let id: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  const safeRun = () => { if (!stopped) { try { fn(); } catch { /* silent */ } } };
  const start = () => { if (!id && !stopped) id = setInterval(safeRun, intervalMs); };
  const stop  = () => { if (id) { clearInterval(id); id = null; } };
  const onVis = () => {
    if (document.hidden) stop();
    else { if (runOnVisible) safeRun(); start(); }
  };

  if (runImmediately) safeRun();
  if (!document.hidden) start();
  document.addEventListener('visibilitychange', onVis);

  return () => {
    stopped = true;
    stop();
    document.removeEventListener('visibilitychange', onVis);
  };
}
