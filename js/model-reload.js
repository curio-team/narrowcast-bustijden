(() => {
  const status = document.querySelector('#reload-status');
  const events = new EventSource('/__models/events');
  let version;
  events.onmessage = ({ data }) => {
    if (version && version !== data) { location.reload(); return; }
    version = data;
    status.textContent = 'Live reload connected';
  };
  events.onerror = () => { status.textContent = 'Live reload offline · use npm run models'; };
  addEventListener('pagehide', () => events.close());
})();
